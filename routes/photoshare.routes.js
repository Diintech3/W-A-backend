const express = require('express');
const router = express.Router();
const photoshareController = require('../controllers/photoshare.controller');
const { protect } = require('../middleware/auth.middleware');
const { imageUpload } = require('../middleware/upload.middleware');

// CLIENT PANEL PROTECTED ROUTES
router.post('/folders', protect, photoshareController.createFolder);
router.get('/folders', protect, photoshareController.listFolders);
router.get('/folders/:id', protect, photoshareController.getFolderDetails);
router.patch('/folders/:id', protect, photoshareController.updateFolder);
router.delete('/folders/:id', protect, photoshareController.deleteFolder);
router.get('/folders/:id/photos', protect, photoshareController.getFolderPhotos);

// PUBLIC GUEST GALLERY ROUTES (Protected by global x-api-key check only, no login token required)
router.get('/public/folders/:linkCode', photoshareController.getPublicFolderDetails);
router.get('/public/folders/:linkCode/photos', photoshareController.getPublicFolderPhotos);
router.post('/public/folders/:linkCode/selfie-search', imageUpload.single('file'), photoshareController.searchPhotosBySelfie);

module.exports = router;
