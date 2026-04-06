const csv = require('csv-parser');
const { Readable } = require('stream');

function normalizePhone(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
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
