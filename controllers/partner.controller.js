const User = require('../models/User');
const Template = require('../models/Template');
const { refreshTemplateStatus } = require('../services/whatsapp.service');

exports.partnerSyncClient = async (req, res) => {
  try {
    const { name, email, phone, businessName } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPhone = phone ? String(phone).trim() : '';

    // Step 1: Duplicate check using email
    let client = await User.findOne({ email: cleanEmail });

    if (client) {
      // Update details if client exists
      client.name = name || client.name;
      client.phone = cleanPhone || client.phone;
      client.businessName = businessName || client.businessName;
      // If it doesn't have parentAdmin, link to current partner Admin
      if (!client.parentAdmin) {
        client.parentAdmin = req.partnerAdmin._id;
      }
      await client.save();

      return res.status(200).json({
        success: true,
        message: 'Client synced and updated successfully',
        data: {
          clientId: client._id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          businessName: client.businessName,
          whatsappConfigured: !!client.whatsappPhoneNumberId,
          status: client.status
        }
      });
    }

    // Create a new client
    client = new User({
      name: name || cleanEmail.split('@')[0],
      email: cleanEmail,
      phone: cleanPhone,
      businessName: businessName || '',
      role: 'client',
      parentAdmin: req.partnerAdmin._id,
      status: 'pending',
      isVerified: true,
      // Provide a random password since clients log in from Magnifi AI directly
      password: require('crypto').randomBytes(16).toString('hex')
    });

    await client.save();

    return res.status(201).json({
      success: true,
      message: 'Client created and synced successfully',
      data: {
        clientId: client._id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        businessName: client.businessName,
        whatsappConfigured: false,
        status: client.status
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.partnerRequestTemplate = async (req, res) => {
  try {
    const { clientEmail, templateName, category, language, bodyText, headerText, footerText, variables } = req.body;

    if (!clientEmail || !templateName || !bodyText) {
      return res.status(400).json({ success: false, message: 'clientEmail, templateName, and bodyText are required' });
    }

    const cleanEmail = String(clientEmail).toLowerCase().trim();

    // Verify client belongs to this partner admin
    const client = await User.findOne({
      email: cleanEmail,
      role: 'client',
      parentAdmin: req.partnerAdmin._id
    });

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found or not managed by your integration key' });
    }

    // Clean template name (Meta rules: lowercase, underscore, alphanumeric)
    const cleanName = String(templateName).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    // Check if template already exists for this client
    let template = await Template.findOne({
      assignedTo: client._id,
      whatsappTemplateName: cleanName
    });

    if (template) {
      // If template exists, we can update it if it's in DRAFT / REQUESTED status, or return warning
      if (template.metaStatus !== 'DRAFT' && template.metaStatus !== 'PENDING_ADMIN_APPROVAL') {
        return res.status(400).json({
          success: false,
          message: `Template already exists and is in ${template.metaStatus} status. Cannot modify.`
        });
      }

      template.bodyPreview = bodyText;
      template.headerText = headerText || '';
      template.footerText = footerText || '';
      template.category = category || 'MARKETING';
      template.languageCode = language || 'en';
      template.sampleParams = (variables || []).map((v, i) => ({
        key: String(i + 1),
        value: v.value || v.key || ''
      }));
      template.metaStatus = 'PENDING_ADMIN_APPROVAL';
      await template.save();

      return res.status(200).json({
        success: true,
        message: 'Template verification request updated successfully',
        data: {
          templateId: template._id,
          name: template.name,
          whatsappTemplateName: template.whatsappTemplateName,
          status: template.metaStatus
        }
      });
    }

    // Create a new template in PENDING_ADMIN_APPROVAL status
    template = new Template({
      userId: req.partnerAdmin._id, // Admin is owner
      assignedTo: client._id,
      createdByAdmin: req.partnerAdmin._id,
      name: templateName.trim(),
      whatsappTemplateName: cleanName,
      languageCode: language || 'en',
      category: category || 'MARKETING',
      bodyPreview: bodyText,
      headerText: headerText || '',
      footerText: footerText || '',
      sampleParams: (variables || []).map((v, i) => ({
        key: String(i + 1),
        value: v.value || v.key || ''
      })),
      metaStatus: 'PENDING_ADMIN_APPROVAL'
    });

    await template.save();

    return res.status(201).json({
      success: true,
      message: 'Template verification request submitted successfully',
      data: {
        templateId: template._id,
        name: template.name,
        whatsappTemplateName: template.whatsappTemplateName,
        status: template.metaStatus
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.partnerGetTemplateStatus = async (req, res) => {
  try {
    const { clientEmail, templateName } = req.query;

    if (!clientEmail || !templateName) {
      return res.status(400).json({ success: false, message: 'clientEmail and templateName are required' });
    }

    const cleanEmail = String(clientEmail).toLowerCase().trim();
    const cleanName = String(templateName).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    // Verify client belongs to this partner admin
    const client = await User.findOne({
      email: cleanEmail,
      role: 'client',
      parentAdmin: req.partnerAdmin._id
    });

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found or not managed by your integration key' });
    }

    const template = await Template.findOne({
      assignedTo: client._id,
      whatsappTemplateName: cleanName
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found for this client' });
    }

    // If template is pending meta approval, let's refresh status from Meta
    if (template.metaStatus === 'PENDING') {
      try {
        const result = await refreshTemplateStatus(req.partnerAdmin._id, template.whatsappTemplateName);
        if (result.found && result.status !== template.metaStatus) {
          template.metaStatus = result.status;
          await template.save();
        }
      } catch (err) {
        console.error('Failed to refresh template status in partner request:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        templateName: template.name,
        whatsappTemplateName: template.whatsappTemplateName,
        clientEmail: client.email,
        status: template.metaStatus,
        metaStatus: template.metaStatus,
        lastUpdated: template.updatedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.partnerGetClientStatus = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, message: 'email query parameter is required' });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    const client = await User.findOne({
      email: cleanEmail,
      role: 'client',
      parentAdmin: req.partnerAdmin._id
    });

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found or not managed by your integration key' });
    }

    return res.status(200).json({
      success: true,
      data: {
        email: client.email,
        status: client.status,
        whatsappConfigured: !!client.whatsappPhoneNumberId
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
