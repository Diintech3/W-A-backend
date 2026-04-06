const BotFlow = require('../models/BotFlow');
const { success, fail } = require('../utils/apiResponse');

exports.saveFlow = async (req, res) => {
  try {
    const { triggerKeyword, nodes } = req.body;
    const kw = (triggerKeyword || 'hi').toLowerCase().trim();
    const nodeList = Array.isArray(nodes) ? nodes : [];

    const flow = await BotFlow.findOneAndUpdate(
      { userId: req.user._id },
      { userId: req.user._id, triggerKeyword: kw, nodes: nodeList },
      { upsert: true, new: true }
    );

    return success(res, { flow }, 'Bot flow saved');
  } catch (e) {
    return fail(res, e.message || 'Failed to save flow', 500);
  }
};

exports.getFlow = async (req, res) => {
  try {
    let flow = await BotFlow.findOne({ userId: req.user._id });
    if (!flow) {
      flow = await BotFlow.create({
        userId: req.user._id,
        triggerKeyword: 'hi',
        nodes: [
          {
            id: 'welcome',
            type: 'message',
            content: 'Hello! Thanks for messaging us. How can we help?',
            options: [],
            nextNodeId: '',
          },
        ],
      });
    }
    return success(res, { flow }, 'Bot flow');
  } catch (e) {
    return fail(res, e.message || 'Failed to load flow', 500);
  }
};
