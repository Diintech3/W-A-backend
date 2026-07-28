const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/auth.middleware');
const superadminCtrl = require('../controllers/superadmin.controller');

// All routes require authentication and superadmin role
router.use(protect, authorizeRoles('superadmin'));

router.get('/stats', superadminCtrl.getStats);
router.get('/admins', superadminCtrl.listAdmins);
router.post('/admins', superadminCtrl.createAdmin);
router.put('/admins/:id', superadminCtrl.updateAdmin);
router.delete('/admins/:id', superadminCtrl.deleteAdmin);
router.post('/admins/:id/api-sharing', superadminCtrl.generateApiSharing);
router.delete('/admins/:id/api-sharing', superadminCtrl.revokeApiSharing);
router.get('/clients', superadminCtrl.listAllClients);
router.put('/clients/:id', superadminCtrl.updateClient);
router.delete('/clients/:id', superadminCtrl.deleteClient);
router.post('/clients/:id/api-sharing', superadminCtrl.generateClientApiSharing);
router.delete('/clients/:id/api-sharing', superadminCtrl.revokeClientApiSharing);

module.exports = router;
