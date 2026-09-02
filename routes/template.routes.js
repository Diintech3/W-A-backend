const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const clientScope = require('../middleware/clientScope.middleware');
const t = require('../controllers/template.controller');

// ─── Admin-only middleware ────────────────────────────────────────────────────
function adminOnly(req, res, next) {
  if (req.user.role === 'client') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}

// ─── Meta Graph API routes (admin only) ──────────────────────────────────────
router.get('/meta/list', protect, adminOnly, clientScope, t.metaList);
router.post('/meta/verify', protect, clientScope, t.metaVerify); // client bhi use kar sakta hai verify ke liye
router.post('/meta/sync', protect, adminOnly, clientScope, t.metaSync);

// ─── Admin: client-specific template management ───────────────────────────────
router.get('/admin/clients/:clientId', protect, adminOnly, t.adminListClientTemplates);
router.post('/admin/clients/:clientId/create-on-meta', protect, adminOnly, t.adminCreateTemplateOnMeta);
router.post('/admin/clients/:clientId/assign', protect, adminOnly, t.adminAssignTemplate);
router.post('/admin/clients/:clientId/refresh-all', protect, adminOnly, t.adminRefreshAllStatus);
router.patch('/admin/:templateId', protect, adminOnly, t.adminUpdateTemplate);
router.delete('/admin/:templateId', protect, adminOnly, t.adminDeleteTemplate);
router.post('/admin/:templateId/refresh-status', protect, adminOnly, t.adminRefreshStatus);
router.post('/admin/:templateId/approve-and-submit', protect, adminOnly, t.adminApproveAndSubmit);
router.post('/admin/:templateId/direct-approve', protect, adminOnly, t.adminDirectApprove);

// ─── Client: apni assigned templates ─────────────────────────────────────────
router.get('/', protect, clientScope, t.listTemplates);
router.get('/:id', protect, clientScope, t.getTemplate);

// Client create/edit/delete/submit
const { mediaUpload } = require('../middleware/upload.middleware');
router.post('/upload-media', protect, mediaUpload.single('file'), t.uploadTemplateMedia);
router.post('/', protect, clientScope, t.createTemplate);
router.patch('/:id', protect, clientScope, t.updateTemplate);
router.post('/:id/submit-to-admin', protect, clientScope, t.submitToAdmin);
router.delete('/:id', protect, clientScope, t.deleteTemplate);

module.exports = router;
