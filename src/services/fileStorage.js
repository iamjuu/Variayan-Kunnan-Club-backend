import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { decryptBuffer, encryptBuffer } from '../utils/crypto.js';

const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'application/pdf', test: (b) => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** Detects the real file type from magic bytes; the client-supplied mimetype is not trusted. */
export function sniffMimeType(buffer) {
  return SIGNATURES.find((s) => s.test(buffer))?.mime ?? null;
}

async function ensureDir() {
  await fs.mkdir(env.storageDir, { recursive: true });
}

function resolveStoredPath(storedName) {
  if (!/^[a-f0-9-]{36}\.bin$/.test(storedName)) throw new Error('Invalid stored file name');
  return path.join(env.storageDir, storedName);
}

export async function storePrivateFile(buffer, mimeType) {
  await ensureDir();
  const storedName = `${crypto.randomUUID()}.bin`;
  await fs.writeFile(resolveStoredPath(storedName), encryptBuffer(buffer), { mode: 0o600 });
  return { storedName, mimeType, size: buffer.length, encrypted: true };
}

export async function readPrivateFile(fileRef) {
  const data = await fs.readFile(resolveStoredPath(fileRef.storedName));
  return fileRef.encrypted ? decryptBuffer(data) : data;
}

export async function deletePrivateFiles(fileRefs) {
  await Promise.all(
    fileRefs.filter(Boolean).map(async (ref) => {
      try {
        await fs.unlink(resolveStoredPath(ref.storedName));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }),
  );
}

export function collectRegistrationFiles(registration) {
  return [
    registration.participant?.photo,
    registration.participant?.aadhaarDocument,
    ...(registration.team?.members ?? []).map((m) => m.photo),
  ].filter(Boolean);
}
