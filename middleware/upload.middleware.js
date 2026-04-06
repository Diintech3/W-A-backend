const multer = require('multer');
const path = require('path');

const memory = multer.memoryStorage();

const csvUpload = multer({
  storage: memory,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

const imageUpload = multer({
  storage: memory,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const mediaUpload = multer({
  storage: memory,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype) ||
      /^video\/(mp4|quicktime|webm)$/.test(file.mimetype) ||
      /^audio\/(mpeg|mp3|aac|ogg)$/.test(file.mimetype) ||
      file.mimetype === 'application/pdf'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported media format'));
    }
  },
});

module.exports = { csvUpload, imageUpload, mediaUpload };
