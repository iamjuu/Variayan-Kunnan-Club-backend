#!/usr/bin/env node
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { importGalleryPhotos } from '../src/services/galleryImport.js';

async function main() {
  await connectDatabase();
  console.log(`Connected to ${env.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  const report = await importGalleryPhotos({ log: console.log });
  console.log(`Imported ${report.imported}, skipped ${report.skipped} already in the gallery.`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(`✖ Gallery import failed: ${error.message}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
