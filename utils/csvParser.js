const csv = require('csv-parser');
const { Readable } = require('stream');

function normalizePhone(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;

  // Auto-prepend '91' for 10-digit Indian mobile numbers starting with 6,7,8,9
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = '91' + digits;
  }
  // If 11 digits starting with 0 followed by 6-9
  else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    digits = '91' + digits.slice(1);
  }

  return digits;
}

function isValidPhone(phone) {
  return normalizePhone(phone) !== null;
}

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const stream = Readable.from(buffer.toString('utf8'));
    stream
      .pipe(csv({ skipEmptyLines: true, trim: true }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

module.exports = { normalizePhone, isValidPhone, parseCsvBuffer };
