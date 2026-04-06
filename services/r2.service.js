const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

function getClient() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY.');
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getPublicBaseUrl() {
  return process.env.R2_PUBLIC_URL || process.env.R2_ENDPOINT;
}

function sanitizeExt(name = '', mimetype = '') {
  const byName = String(name).split('.').pop();
  if (byName && byName !== name) return byName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mt = String(mimetype).toLowerCase();
  if (mt.includes('jpeg')) return 'jpg';
  if (mt.includes('png')) return 'png';
  if (mt.includes('gif')) return 'gif';
  if (mt.includes('webp')) return 'webp';
  if (mt.includes('pdf')) return 'pdf';
  if (mt.includes('mp4')) return 'mp4';
  if (mt.includes('mpeg')) return 'mp3';
  return 'bin';
}

async function uploadBuffer({ buffer, filename, mimetype, folder = 'uploads' }) {
  if (!buffer) throw new Error('No file buffer provided');
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET is missing');
  const client = getClient();

  const ext = sanitizeExt(filename, mimetype);
  const uid = crypto.randomBytes(12).toString('hex');
  const safeFolder = String(folder).replace(/[^a-zA-Z0-9/_-]/g, '');
  const key = `${safeFolder}/${Date.now()}-${uid}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype || 'application/octet-stream',
    })
  );

  const base = getPublicBaseUrl().replace(/\/$/, '');
  return {
    key,
    bucket,
    url: `${base}/${bucket}/${key}`,
  };
}

module.exports = { uploadBuffer };
