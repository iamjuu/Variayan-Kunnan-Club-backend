import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function required(name, fallbackForDev) {
  const value = process.env[name];
  if (value) return value;
  if (!isProduction && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable: ${name}`);
}

function hexKey(name, fallbackForDev) {
  const value = required(name, fallbackForDev);
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 64 character hex string (32 bytes)`);
  }
  return Buffer.from(value, 'hex');
}

const DEV_KEY = '0'.repeat(63) + '1';

export const env = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 5000),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/vkc_keralotsavam'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-jwt-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  encryptionKey: hexKey('DATA_ENCRYPTION_KEY', DEV_KEY),
  hashPepper: required('AADHAAR_HASH_PEPPER', 'dev-only-insecure-pepper'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  trustProxy: process.env.TRUST_PROXY === 'true',
  storageDir: path.resolve(SERVER_ROOT, process.env.PRIVATE_STORAGE_DIR || 'storage/private'),
  galleryDir: path.resolve(SERVER_ROOT, process.env.GALLERY_STORAGE_DIR || 'storage/gallery'),
  serveClient: process.env.SERVE_CLIENT === 'true',
  clientDist: path.resolve(SERVER_ROOT, '..', 'client', 'dist'),
  maxPhotoBytes: Number(process.env.MAX_PHOTO_MB || 2) * 1024 * 1024,
  maxDocumentBytes: Number(process.env.MAX_DOCUMENT_MB || 5) * 1024 * 1024,
  maxGalleryBytes: Number(process.env.MAX_GALLERY_MB || 8) * 1024 * 1024,
};

if (isProduction) {
  if (env.jwtSecret.length < 32 || env.jwtSecret.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must be a strong random value (>= 32 chars) in production');
  }
  if (env.encryptionKey.equals(Buffer.from(DEV_KEY, 'hex'))) {
    throw new Error('DATA_ENCRYPTION_KEY must be set to a random key in production');
  }
}
