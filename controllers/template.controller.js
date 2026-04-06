const Template = require('../models/Template');
const { success, fail } = require('../utils/apiResponse');

exports.createTemplate = async (req, res) => {
  try {
    const { name, whatsappTemplateName, languageCode, bodyPreview, sampleParams } = req.body;
    if (!name || !whatsappTemplateName) {
      return fail(res, 'Name and WhatsApp template name are required');
    }
    const template = await Template.create({
      userId: req.user._id,
      name,
      whatsappTemplateName,
      languageCode: languageCode || 'en',
      bodyPreview: bodyPreview || '',
      sampleParams: Array.isArray(sampleParams) ? sampleParams : [],
    });
    return success(res, { template }, 'Template saved', 201);
  } catch (e) {
    return fail(res, e.message || 'Failed to save template', 500);
  }
};

exports.listTemplates = async (req, res) => {
  try {
    const templates = await Template.find({ userId: req.user._id }).sort({ createdAt: -1 });
    return success(res, { templates }, 'Templates');
  } catch (e) {
    return fail(res, e.message || 'Failed to list templates', 500);
  }
};

exports.getTemplate = async (req, res) => {
  try {
    const template = await Template.findOne({ _id: req.params.id, userId: req.user._id });
    if (!template) return fail(res, 'Template not found', 404);
    return success(res, { template }, 'Template');
  } catch (e) {
    return fail(res, e.message || 'Failed to load template', 500);
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const allowed = ['name', 'whatsappTemplateName', 'languageCode', 'bodyPreview', 'sampleParams'];
    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }
    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { new: true }
    );
    if (!template) return fail(res, 'Template not found', 404);
    return success(res, { template }, 'Template updated');
  } catch (e) {
    return fail(res, e.message || 'Update failed', 500);
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const t = await Template.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!t) return fail(res, 'Template not found', 404);
    return success(res, null, 'Template deleted');
  } catch (e) {
    return fail(res, e.message || 'Delete failed', 500);
  }
};
