import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const GALLERY_TYPES = new Set(Object.keys(EXT));

function galleryDir() {
  return env.galleryDir;
}

async function ensureDir() {
  await fs.mkdir(galleryDir(), { recursive: true });
}

function resolveStoredPath(storedName) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(storedName)) throw new Error('Invalid gallery file name');
  return path.join(galleryDir(), storedName);
}

export async function storeGalleryFile(buffer, mimeType) {
  await ensureDir();
  const storedName = `${crypto.randomUUID()}${EXT[mimeType] ?? '.jpg'}`;
  await fs.writeFile(resolveStoredPath(storedName), buffer, { mode: 0o644 });
  return { storedName, mimeType, size: buffer.length };
}

export async function readGalleryFile(fileRef) {
  return fs.readFile(resolveStoredPath(fileRef.storedName));
}

export async function deleteGalleryFile(fileRef) {
  if (!fileRef?.storedName) return;
  try {
    await fs.unlink(resolveStoredPath(fileRef.storedName));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
