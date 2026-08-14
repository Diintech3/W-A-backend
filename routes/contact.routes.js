const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const clientScope = require('../middleware/clientScope.middleware');
const { csvUpload } = require('../middleware/upload.middleware');
const contact = require('../controllers/contact.controller');

router.post('/import', protect, csvUpload.single('file'), contact.importContacts);
router.post('/groups', protect, clientScope, contact.createGroup);
router.get('/groups', protect, clientScope, contact.listGroups);
router.delete('/groups/:id', protect, contact.deleteGroup);

router.post('/', protect, clientScope, contact.createContact);
router.get('/', protect, clientScope, contact.listContacts);
router.patch('/:id', protect, contact.updateContact);
router.delete('/:id', protect, contact.deleteContact);

module.exports = router;
