import crypto from 'node:crypto';
import { env } from '../config/env.js';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAGIC = Buffer.from('VKC1');

/** AES-256-GCM. Layout: MAGIC | IV | TAG | CIPHERTEXT */
export function encryptBuffer(plain) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', env.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBuffer(payload) {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unrecognised encrypted payload');
  const iv = payload.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = payload.subarray(MAGIC.length + IV_LENGTH, MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', env.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function keyedHash(value) {
  return crypto.createHmac('sha256', env.hashPepper).update(value).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
