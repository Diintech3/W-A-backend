const Contact = require('../models/Contact');
const ContactGroup = require('../models/ContactGroup');
const { success, fail } = require('../utils/apiResponse');
const { normalizePhone, parseCsvBuffer } = require('../utils/csvParser');

exports.createContact = async (req, res) => {
  try {
    const { name, phone, email, tags, group, optedOut } = req.body;
    const norm = normalizePhone(phone);
    if (!name || !norm) return fail(res, 'Valid name and phone are required');

    const contact = await Contact.create({
      userId: req.user._id,
      name,
      phone: norm,
      email: email || '',
      tags: Array.isArray(tags) ? tags : [],
      group: Array.isArray(group) ? group : [],
      optedOut: Boolean(optedOut),
    });

    return success(res, { contact }, 'Contact added', 201);
  } catch (e) {
    if (e.code === 11000) return fail(res, 'Contact with this phone already exists');
    return fail(res, e.message || 'Failed to add contact', 500);
  }
};

exports.importContacts = async (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, 'CSV file required');

    let rows;
    try {
      rows = await parseCsvBuffer(req.file.buffer);
    } catch {
      return fail(res, 'Invalid CSV file');
    }

    const created = [];
    const skipped = [];

    for (const row of rows) {
      const phoneRaw = row.phone || row.Phone || row.mobile || row.Mobile || row.number;
      const nameRaw = row.name || row.Name || row.fullname || 'Unknown';
      const emailRaw = row.email || row.Email || '';
      const norm = normalizePhone(phoneRaw);
      if (!norm) {
        skipped.push({ row, reason: 'Invalid phone' });
        continue;
      }
      try {
        const c = await Contact.create({
          userId: req.user._id,
          name: String(nameRaw).trim() || 'Unknown',
          phone: norm,
          email: String(emailRaw).trim(),
          tags: [],
          group: [],
          optedOut: false,
        });
        created.push(c);
      } catch (err) {
        if (err.code === 11000) skipped.push({ phone: norm, reason: 'Duplicate' });
        else skipped.push({ phone: norm, reason: err.message });
      }
    }

    return success(
      res,
      { imported: created.length, skipped: skipped.length, details: skipped.slice(0, 50) },
      `Imported ${created.length} contacts`
    );
  } catch (e) {
    return fail(res, e.message || 'Import failed', 500);
  }
};

exports.listContacts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = (req.query.search || '').trim();
    const filter = { userId: req.user._id };
    if (search) {
      filter.$or = [
        { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { phone: new RegExp(search.replace(/\D/g, ''), 'i') },
        { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      ];
    }

    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .populate('group', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Contact.countDocuments(filter),
    ]);

    return success(res, { contacts, pagination: { page, limit, total } }, 'Contacts');
  } catch (e) {
    return fail(res, e.message || 'Failed to list contacts', 500);
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const c = await Contact.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!c) return fail(res, 'Contact not found', 404);
    return success(res, null, 'Contact deleted');
  } catch (e) {
    return fail(res, e.message || 'Failed to delete', 500);
  }
};

exports.updateContact = async (req, res) => {
  try {
    const { name, email, tags, group, optedOut, phone } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (tags !== undefined) update.tags = tags;
    if (group !== undefined) update.group = group;
    if (optedOut !== undefined) update.optedOut = optedOut;
    if (phone !== undefined) {
      const norm = normalizePhone(phone);
      if (!norm) return fail(res, 'Invalid phone');
      update.phone = norm;
    }

    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { new: true }
    ).populate('group', 'name');

    if (!contact) return fail(res, 'Contact not found', 404);
    return success(res, { contact }, 'Contact updated');
  } catch (e) {
    if (e.code === 11000) return fail(res, 'Duplicate phone');
    return fail(res, e.message || 'Update failed', 500);
  }
};

exports.createGroup = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return fail(res, 'Group name required');
    const group = await ContactGroup.create({
      userId: req.user._id,
      name,
      description: description || '',
    });
    return success(res, { group }, 'Group created', 201);
  } catch (e) {
    return fail(res, e.message || 'Failed to create group', 500);
  }
};

exports.listGroups = async (req, res) => {
  try {
    const groups = await ContactGroup.find({ userId: req.user._id }).sort({ name: 1 });
    return success(res, { groups }, 'Groups');
  } catch (e) {
    return fail(res, e.message || 'Failed to list groups', 500);
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    const group = await ContactGroup.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!group) return fail(res, 'Group not found', 404);
    return success(res, null, 'Group deleted');
  } catch (e) {
    return fail(res, e.message || 'Failed to delete group', 500);
  }
};
