import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/vkc_keralotsavam_test';
process.env.PRIVATE_STORAGE_DIR = path.join(os.tmpdir(), 'vkc-test-storage');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'keralotsavam');

// 1x1 PNG and a minimal JPEG header – enough for magic-byte validation.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
export const NOT_AN_IMAGE = Buffer.from('MZ fake executable content');

export async function setup() {
  const { ensurePdfFonts } = await import('../scripts/fetchFonts.js');
  await ensurePdfFonts({ log: () => {} });
  const { default: request } = await import('supertest');
  const mongoose = (await import('mongoose')).default;
  const { connectDatabase } = await import('../src/config/db.js');
  const { createApp } = await import('../src/app.js');
  await connectDatabase();
  await mongoose.connection.dropDatabase();
  const app = createApp();

  const agent = () => {
    const a = request.agent(app);
    a.csrf = async () => (await a.get('/api/csrf-token')).body.csrfToken;
    return a;
  };
  return { app, agent, mongoose };
}

/** Builds a multipart registration request. */
export function submit(agent, token, data, files = {}) {
  const req = agent.post('/api/registrations').set('x-csrf-token', token).field('data', JSON.stringify(data));
  for (const [field, buffer] of Object.entries(files)) {
    req.attach(field, buffer, { filename: `${field}.${buffer[0] === 0x89 ? 'png' : 'jpg'}`, contentType: buffer[0] === 0x89 ? 'image/png' : 'image/jpeg' });
  }
  return req;
}
