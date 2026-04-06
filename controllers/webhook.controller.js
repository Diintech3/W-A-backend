const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const BotFlow = require('../models/BotFlow');
const whatsapp = require('../services/whatsapp.service');
const { emitToUser } = require('../services/socket.service');

exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'myverifytoken123';

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

function findNode(flow, nodeId) {
  return flow.nodes.find((n) => n.id === nodeId);
}

async function sendNodeResponse(userId, customerPhone, node, convId) {
  if (!node) return;
  const phone = String(customerPhone).replace(/\D/g, '');
  let replyText = '';
  let apiRes = null;

  try {
    if (node.type === 'message' || node.type === 'condition') {
      const text = node.content || '';
      if (!text) return;
      apiRes = await whatsapp.sendTextMessage(userId, phone, text);
      replyText = text;
    } else if (node.type === 'menu') {
      const body = node.content || 'Choose an option:';
      const opts = node.options || [];
      const buttons = opts.map((o) => ({ title: o.label }));
      if (buttons.length) {
        apiRes = await whatsapp.sendInteractiveMessage(userId, phone, buttons, body);
      } else {
        apiRes = await whatsapp.sendTextMessage(userId, phone, body);
      }
      replyText = body;
    }
  } catch (err) {
    const reason = err.response?.data?.error?.message || err.message || 'Bot send failed';
    await Message.create({
      userId,
      conversationId: convId || null,
      direction: 'outbound',
      from: 'bot',
      to: phone,
      body: node.content || '',
      type: 'text',
      status: 'failed',
      errorReason: reason,
    });
    return;
  }

  if (replyText) {
    await Message.create({
      userId,
      conversationId: convId || null,
      direction: 'outbound',
      from: 'bot',
      to: phone,
      body: replyText,
      type: 'text',
      status: 'sent',
      whatsappMessageId: apiRes?.messages?.[0]?.id || '',
    });
  }
}

async function processBot(userId, conv, textBody) {
  let flow;
  try {
    flow = await BotFlow.findOne({ userId });
  } catch {
    return;
  }
  if (!flow?.nodes?.length) return;

  const incoming = (textBody || '').trim().toLowerCase();
  const trigger = (flow.triggerKeyword || 'hi').toLowerCase();
  const convId = conv._id;

  if (conv.botContext?.awaitingMenu && conv.botContext.currentNodeId) {
    const current = findNode(flow, conv.botContext.currentNodeId);
    if (current?.type === 'menu' && current.options?.length) {
      const match = current.options.find(
        (o) =>
          String(o.value).toLowerCase() === incoming ||
          String(o.label).toLowerCase() === incoming
      );
      if (match) {
        const nextId = match.nextNodeId || '';
        if (nextId) {
          const next = findNode(flow, nextId);
          if (next) {
            await sendNodeResponse(userId, conv.customerPhone, next, convId);
            conv.botContext.currentNodeId = next.id;
            conv.botContext.awaitingMenu = next.type === 'menu';
            conv.botContext.flowId = flow._id;
            await conv.save();
            if (next.nextNodeId) {
              const chain = findNode(flow, next.nextNodeId);
              if (chain) {
                await sendNodeResponse(userId, conv.customerPhone, chain, convId);
                conv.botContext.currentNodeId = chain.id;
                conv.botContext.awaitingMenu = chain.type === 'menu';
                await conv.save();
              }
            }
          }
        } else {
          conv.botContext.awaitingMenu = false;
          conv.botContext.currentNodeId = '';
          await conv.save();
        }
        return;
      }
    }
  }

  const triggered =
    incoming === trigger ||
    incoming.startsWith(`${trigger} `) ||
    incoming === 'hello' ||
    incoming === 'start';

  if (!triggered) return;

  const start = flow.nodes[0];
  if (!start) return;

  await sendNodeResponse(userId, conv.customerPhone, start, convId);
  conv.botContext = {
    flowId: flow._id,
    currentNodeId: start.id,
    awaitingMenu: start.type === 'menu',
  };
  await conv.save();

  if (start.type !== 'menu' && start.nextNodeId) {
    const n2 = findNode(flow, start.nextNodeId);
    if (n2) {
      await sendNodeResponse(userId, conv.customerPhone, n2, convId);
      conv.botContext.currentNodeId = n2.id;
      conv.botContext.awaitingMenu = n2.type === 'menu';
      await conv.save();
    }
  }
}

async function handleInboundMessage(user, value) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId || phoneNumberId !== user.whatsappPhoneNumberId) return;

  const messages = value.messages || [];
  for (const m of messages) {
    const from = m.from;
    const name = value.contacts?.[0]?.profile?.name || '';
    let textBody = '';
    if (m.type === 'text') textBody = m.text?.body || '';
    else if (m.type === 'interactive' && m.interactive?.button_reply) {
      textBody =
        m.interactive.button_reply.title ||
        m.interactive.button_reply.id ||
        '';
    } else textBody = `[${m.type}]`;

    let conv = await Conversation.findOne({ userId: user._id, customerPhone: from });
    if (!conv) {
      conv = await Conversation.create({
        userId: user._id,
        customerPhone: from,
        customerName: name,
        lastMessage: textBody,
        lastMessageAt: new Date(),
        unreadCount: 1,
      });
    } else {
      conv.customerName = name || conv.customerName;
      conv.lastMessage = textBody;
      conv.lastMessageAt = new Date();
      conv.unreadCount = (conv.unreadCount || 0) + 1;
      await conv.save();
    }

    const inbound = await Message.create({
      userId: user._id,
      conversationId: conv._id,
      direction: 'inbound',
      from,
      to: user.whatsappPhoneNumberId,
      body: textBody,
      type: m.type || 'text',
      status: 'delivered',
      whatsappMessageId: m.id || '',
    });

    emitToUser(String(user._id), 'inbox:newMessage', {
      conversationId: String(conv._id),
      message: inbound,
    });
    emitToUser(String(user._id), 'inbox:update', { conversationId: String(conv._id) });

    if (m.id) {
      try {
        await whatsapp.markMessageRead(user._id, m.id);
      } catch {
        /* ignore */
      }
    }

    if ((m.type === 'text' || m.type === 'interactive') && textBody && !textBody.startsWith('[')) {
      await processBot(user._id, conv, textBody);
    }
  }
}

async function handleStatusUpdate(user, value) {
  const statuses = value.statuses || [];
  for (const s of statuses) {
    const id = s.id;
    const status = s.status;
    if (!id) continue;
    const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    const st = map[status];
    if (!st) continue;

    await Message.findOneAndUpdate(
      { userId: user._id, whatsappMessageId: id },
      { status: st }
    );
  }
}

exports.receiveWebhook = async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const user = await User.findOne({ whatsappPhoneNumberId: phoneNumberId }).select(
          '+whatsappAccessToken'
        );
        if (!user) continue;

        if (value.messages) await handleInboundMessage(user, value);
        if (value.statuses) await handleStatusUpdate(user, value);
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    return res.sendStatus(500);
  }
};
