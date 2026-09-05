const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
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
  return (process.env.R2_PUBLIC_URL || 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev').replace(/\/$/, '');
}

function getR2KeyFromUrl(url) {
  const bucket = process.env.R2_BUCKET || 'yovoai';
  const bucketPart = `/${bucket}/`;
  const index = url.indexOf(bucketPart);
  if (index !== -1) {
    return url.slice(index + bucketPart.length);
  }
  const pIndex = url.indexOf('/photoshare/');
  if (pIndex !== -1) {
    return url.slice(pIndex + 1);
  }
  return '';
}

async function getPresignedUrl(key) {
  if (!key) return null;
  try {
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('R2_BUCKET is missing');
    const client = getClient();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    // Temporary URL valid for 3600 seconds (1 hour)
    return await getSignedUrl(client, command, { expiresIn: 3600 });
  } catch (err) {
    console.error('[R2 Service] Failed to generate presigned URL for key:', key, err);
    return null;
  }
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

  const base = getPublicBaseUrl();
  const url = `${base}/${key}`;

  return {
    key,
    bucket,
    url,
  };
}

module.exports = { uploadBuffer, getPresignedUrl, getR2KeyFromUrl };
