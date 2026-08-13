const crypto = require('crypto');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const Message = require('../models/Message');
const AIAgent = require('../models/AIAgent');
const { success, fail } = require('../utils/apiResponse');

exports.getStats = async (req, res) => {
  try {
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const totalClients = await User.countDocuments({ role: 'client' });
    const totalCampaigns = await Campaign.countDocuments({});
    const totalMessages = await Message.countDocuments({});

    return success(res, {
      totalAdmins,
      totalClients,
      totalCampaigns,
      totalMessages,
    }, 'Super Admin stats loaded');
  } catch (e) {
    return fail(res, e.message || 'Failed to load stats', 500);
  }
};

exports.listAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('-password').sort({ createdAt: -1 });
    
    // Attach count of clients for each admin
    const adminsWithClientCounts = await Promise.all(
      admins.map(async (admin) => {
        const clientCount = await User.countDocuments({ parentAdmin: admin._id, role: 'client' });
        return {
          ...admin.toObject(),
          clientCount,
        };
      })
    );

    return success(res, { admins: adminsWithClientCounts }, 'Admins listed');
  } catch (e) {
    return fail(res, e.message || 'Failed to list admins', 500);
  }
};

exports.listAllClients = async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' })
      .select('-password -refreshToken')
      .populate('parentAdmin', 'name email businessName')
      .sort({ createdAt: -1 });

    const clientsWithAgents = await Promise.all(
      clients.map(async (c) => {
        const agent = await AIAgent.findOne({ userId: c._id });
        return {
          ...c.toObject(),
          aiAgentId: agent ? agent.externalAgentId : '',
        };
      })
    );

    return success(res, { clients: clientsWithAgents }, 'All clients listed');
  } catch (e) {
    return fail(res, e.message || 'Failed to list clients', 500);
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, businessName, phone, plan, isVerified, status, aiAgentId, whatsappPhoneNumberId, whatsappAccessToken } = req.body;

    const client = await User.findOne({ _id: id, role: 'client' });
    if (!client) return fail(res, 'Client not found', 404);

    if (name !== undefined) client.name = name;
    if (businessName !== undefined) client.businessName = businessName;
    if (phone !== undefined) client.phone = phone;
    if (plan !== undefined) client.plan = plan;
    if (isVerified !== undefined) client.isVerified = Boolean(isVerified);
    if (status !== undefined) client.status = status;
    if (whatsappPhoneNumberId !== undefined) client.whatsappPhoneNumberId = whatsappPhoneNumberId;
    if (whatsappAccessToken !== undefined && whatsappAccessToken !== '') {
      client.whatsappAccessToken = whatsappAccessToken;
    }

    await client.save();

    if (aiAgentId !== undefined) {
      const agentIdStr = String(aiAgentId).trim();
      if (agentIdStr === '') {
        await AIAgent.findOneAndDelete({ userId: id });
      } else {
        await AIAgent.findOneAndUpdate(
          { userId: id },
          { userId: id, externalAgentId: agentIdStr },
          { upsert: true, new: true }
        );
      }
    }

    const updatedClient = await User.findById(id).select('-password -refreshToken').populate('parentAdmin', 'name email businessName');
    const agent = await AIAgent.findOne({ userId: id });
    const resClient = {
      ...updatedClient.toObject(),
      aiAgentId: agent ? agent.externalAgentId : '',
    };

    return success(res, { client: resClient }, 'Client updated successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to update client', 500);
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await User.findOneAndDelete({ _id: id, role: 'client' });
    if (!client) return fail(res, 'Client not found', 404);

    return success(res, null, 'Client deleted successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to delete client', 500);
  }
};

exports.createAdmin = async (req, res) => {
  try {
    const { name, email, password, businessName, phone, plan, maxClients, maxMessages } = req.body;
    if (!name || !email || !password) {
      return fail(res, 'Name, email and password are required', 400);
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return fail(res, 'User with this email already exists', 400);
    }

    const admin = await User.create({
      name,
      email,
      password,
      businessName: businessName || '',
      phone: phone || '',
      plan: plan || 'pro',
      role: 'admin',
      status: 'active',
      isVerified: true,
      parentAdmin: req.user._id,
      adminLimits: {
        maxClients: Number(maxClients) || 50,
        maxMessages: Number(maxMessages) || 500000,
      },
    });

    const adminObj = admin.toObject();
    delete adminObj.password;
    return success(res, { admin: adminObj }, 'Admin created successfully', 201);
  } catch (e) {
    return fail(res, e.message || 'Failed to create admin', 500);
  }
};

exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, businessName, phone, plan, isVerified, maxClients, maxMessages } = req.body;

    const admin = await User.findOne({ _id: id, role: 'admin' });
    if (!admin) return fail(res, 'Admin not found', 404);

    if (name !== undefined) admin.name = name;
    if (businessName !== undefined) admin.businessName = businessName;
    if (phone !== undefined) admin.phone = phone;
    if (plan !== undefined) admin.plan = plan;
    if (isVerified !== undefined) admin.isVerified = Boolean(isVerified);
    if (maxClients !== undefined || maxMessages !== undefined) {
      admin.adminLimits = {
        maxClients: maxClients !== undefined ? Number(maxClients) : admin.adminLimits.maxClients,
        maxMessages: maxMessages !== undefined ? Number(maxMessages) : admin.adminLimits.maxMessages,
      };
    }

    await admin.save();
    return success(res, { admin }, 'Admin updated successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to update admin', 500);
  }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await User.findOneAndDelete({ _id: id, role: 'admin' });
    if (!admin) return fail(res, 'Admin not found', 404);

    // Unlink any clients belonging to this admin
    await User.updateMany({ parentAdmin: id }, { $set: { parentAdmin: null } });

    return success(res, null, 'Admin deleted successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to delete admin', 500);
  }
};

exports.generateApiSharing = async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await User.findOne({ _id: id, role: 'admin' });
    if (!admin) return fail(res, 'Admin not found', 404);

    const apiSharingKey = 'wa_share_' + crypto.randomBytes(24).toString('hex');
    const accessToken = 'wa_token_' + crypto.randomBytes(32).toString('hex');
    const referenceKey = 'wa_ref_' + crypto.randomBytes(16).toString('hex');

    admin.apiSharing = {
      isEnabled: true,
      apiSharingKey,
      accessToken,
      referenceKey,
      generatedAt: new Date(),
    };

    await admin.save();

    return success(res, {
      adminId: admin.email,
      apiSharingKey,
      accessToken,
      referenceKey,
      baseUrl: process.env.CLIENT_URL || 'http://localhost:5173',
    }, 'API Sharing credentials generated successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to generate API Sharing credentials', 500);
  }
};

exports.revokeApiSharing = async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await User.findOne({ _id: id, role: 'admin' });
    if (!admin) return fail(res, 'Admin not found', 404);

    admin.apiSharing = {
      isEnabled: false,
      apiSharingKey: '',
      accessToken: '',
      referenceKey: '',
      generatedAt: null,
    };

    await admin.save();
    return success(res, null, 'API Sharing credentials revoked successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to revoke API Sharing credentials', 500);
  }
};

exports.generateClientApiSharing = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await User.findOne({ _id: id, role: 'client' });
    if (!client) return fail(res, 'Client not found', 404);

    const apiSharingKey = 'wa_share_' + crypto.randomBytes(24).toString('hex');
    const accessToken = 'wa_token_' + crypto.randomBytes(32).toString('hex');
    const referenceKey = 'wa_ref_' + crypto.randomBytes(16).toString('hex');

    client.apiSharing = {
      isEnabled: true,
      apiSharingKey,
      accessToken,
      referenceKey,
      generatedAt: new Date(),
    };

    await client.save();

    return success(res, {
      clientId: client.email,
      apiSharingKey,
      accessToken,
      referenceKey,
      baseUrl: process.env.CLIENT_URL || 'http://localhost:5173',
    }, 'Client API Sharing credentials generated successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to generate Client API Sharing credentials', 500);
  }
};

exports.revokeClientApiSharing = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await User.findOne({ _id: id, role: 'client' });
    if (!client) return fail(res, 'Client not found', 404);

    client.apiSharing = {
      isEnabled: false,
      apiSharingKey: '',
      accessToken: '',
      referenceKey: '',
      generatedAt: null,
    };

    await client.save();
    return success(res, null, 'Client API Sharing access revoked successfully');
  } catch (e) {
    return fail(res, e.message || 'Failed to revoke Client API Sharing credentials', 500);
  }
};
