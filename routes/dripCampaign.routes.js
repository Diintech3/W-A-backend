const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const clientScope = require('../middleware/clientScope.middleware');
const dripCtrl = require('../controllers/dripCampaign.controller');

// List and Create
router.get('/', protect, clientScope, dripCtrl.listDripCampaigns);
router.post('/manual', protect, clientScope, dripCtrl.createManualCampaign);
router.post('/ai-generate', protect, clientScope, dripCtrl.generateAiCampaign);

// Detail and Step Editing
router.get('/:id', protect, clientScope, dripCtrl.getDripCampaign);
router.put('/:id', protect, clientScope, dripCtrl.updateDripCampaign);
router.post('/:id/duplicate', protect, clientScope, dripCtrl.duplicateCampaign);
router.put('/:id/step/:stepId', protect, clientScope, dripCtrl.updateStep);
router.put('/:id/steps/:stepId', protect, clientScope, dripCtrl.updateStep);

// Lifecycle Controls
router.post('/:id/activate', protect, clientScope, dripCtrl.activateCampaign);
router.post('/:id/start', protect, clientScope, dripCtrl.activateCampaign);
router.post('/:id/pause', protect, clientScope, dripCtrl.pauseCampaign);
router.post('/:id/resume', protect, clientScope, dripCtrl.resumeCampaign);
router.post('/:id/stop', protect, clientScope, dripCtrl.stopCampaign);
router.post('/:id/dispatch-due', protect, clientScope, dripCtrl.dispatchDueSteps);
router.post('/:id/retry-failed', protect, clientScope, dripCtrl.retryFailedEnrollments);
router.delete('/:id', protect, clientScope, dripCtrl.deleteDripCampaign);

// Testing, Simulation & Inbox Enrollment
router.post('/:id/test-step/:stepId', protect, clientScope, dripCtrl.testSendStep);
router.post('/:id/enroll-contact', protect, clientScope, dripCtrl.enrollSingleContact);
router.post('/:id/enrollments/:enrollmentId/dispatch-now', protect, clientScope, dripCtrl.dispatchEnrollmentNow);

// Analytics & Enrollments
router.get('/:id/analytics', protect, clientScope, dripCtrl.getCampaignAnalytics);
router.get('/:id/enrollments', protect, clientScope, dripCtrl.listEnrollments);
router.patch('/:id/enrollments/:enrollmentId', protect, clientScope, dripCtrl.toggleEnrollmentStatus);

module.exports = router;
