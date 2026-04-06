const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const template = require('../controllers/template.controller');

router.post('/', protect, template.createTemplate);
router.get('/', protect, template.listTemplates);
router.get('/:id', protect, template.getTemplate);
router.patch('/:id', protect, template.updateTemplate);
router.delete('/:id', protect, template.deleteTemplate);

module.exports = router;
