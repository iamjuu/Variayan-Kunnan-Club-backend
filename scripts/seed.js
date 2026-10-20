#!/usr/bin/env node
/**
 * Seeds categories, default settings and (outside production) the local development admin,
 * then imports competition items from data/keralotsavam/*.json.
 *
 *   npm run seed                 # seed + import
 *   npm run seed -- --skip-import
 *   npm run seed -- --update     # refresh previously imported items from the JSON files
 */
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env, SERVER_ROOT } from '../src/config/env.js';
import { importCompetitionItems } from '../src/services/competitionImport.js';
import { importGalleryPhotos } from '../src/services/galleryImport.js';
import { DEV_ADMIN, seedBase, seedDevelopmentAdmin } from '../src/services/seed.js';
import { ensurePdfFonts } from './fetchFonts.js';
import { printImportReport } from './lib/report.js';

const args = new Set(process.argv.slice(2));

async function main() {
  await connectDatabase();
  console.log(`Connected to ${env.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);

  const { categories } = await seedBase();
  console.log(`✔ Categories: ${categories.map((c) => c.name).join(', ')}`);
  console.log('✔ Default settings ensured');

  if (env.isProduction) {
    console.log('ℹ Production mode: development admin NOT created. Use an admin account with a strong password.');
  } else {
    const { created } = await seedDevelopmentAdmin();
    console.log(
      created
        ? `✔ Development admin created: ${DEV_ADMIN.email} (local development only – change the password after first login)`
        : `✔ Development admin already exists: ${DEV_ADMIN.email}`,
    );
  }

  console.log('\nEnsuring PDF fonts');
  await ensurePdfFonts({ log: console.log });

  if (!args.has('--skip-import')) {
    const dir = path.join(SERVER_ROOT, 'data', 'keralotsavam');
    console.log(`\nImporting competition items from ${dir}`);
    const report = await importCompetitionItems({ dir, update: args.has('--update'), log: console.log });
    printImportReport(report);
  }

  if (!args.has('--skip-gallery')) {
    console.log('\nImporting starter gallery photos');
    const gallery = await importGalleryPhotos({ log: console.log });
    console.log(`✔ Gallery: imported ${gallery.imported}, skipped ${gallery.skipped}`);
  }
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(`✖ Seed failed: ${error.message}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
