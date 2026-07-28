const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/auth.middleware');
const adminCtrl = require('../controllers/admin.controller');

// All routes require authentication and admin or superadmin role
router.use(protect, authorizeRoles('admin', 'superadmin'));

router.get('/stats', adminCtrl.getStats);
router.get('/clients', adminCtrl.listClients);
router.post('/clients', adminCtrl.createClient);
router.put('/clients/:id', adminCtrl.updateClient);
router.delete('/clients/:id', adminCtrl.deleteClient);
router.post('/clients/:id/api-sharing', adminCtrl.generateClientApiSharing);
router.delete('/clients/:id/api-sharing', adminCtrl.revokeClientApiSharing);

module.exports = router;
