import fs from 'node:fs/promises';
import path from 'node:path';
import { SERVER_ROOT } from '../config/env.js';
import { GalleryImage } from '../models/GalleryImage.js';
import { sniffMimeType } from './fileStorage.js';
import { storeGalleryFile } from './galleryStorage.js';

const DEFAULT_DIR = path.join(SERVER_ROOT, 'data', 'gallery');

export async function importGalleryPhotos({ dir = DEFAULT_DIR, log = () => {} } = {}) {
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('No gallery manifest found — skipping photo import');
      return { imported: 0, skipped: 0 };
    }
    throw error;
  }

  let imported = 0;
  let skipped = 0;
  for (const entry of manifest) {
    const exists = await GalleryImage.findOne({ title: entry.title, album: entry.album });
    if (exists) {
      skipped += 1;
      continue;
    }
    const buffer = await fs.readFile(path.join(dir, entry.file));
    const mimeType = sniffMimeType(buffer);
    if (!mimeType || mimeType === 'application/pdf') {
      throw new Error(`Gallery file ${entry.file} is not a JPG, PNG or WebP image`);
    }
    const stored = await storeGalleryFile(buffer, mimeType);
    const doc = await GalleryImage.create({
      title: entry.title ?? '',
      caption: entry.caption ?? '',
      album: entry.album ?? 'club',
      featured: Boolean(entry.featured),
      hero: Boolean(entry.hero),
      isPublished: entry.isPublished !== false,
      sortOrder: Number(entry.sortOrder ?? 0),
      image: stored,
    });
    if (doc.hero) {
      await GalleryImage.updateMany({ hero: true, _id: { $ne: doc._id } }, { $set: { hero: false } });
    }
    imported += 1;
    log(`✔ Gallery photo: ${entry.title}`);
  }
  return { imported, skipped };
}
