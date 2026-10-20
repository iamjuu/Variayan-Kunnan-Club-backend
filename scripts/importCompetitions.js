#!/usr/bin/env node
/**
 * Imports Keralotsavam competition items.
 *   npm run import:competitions -- [--dir <path>] [--dry-run] [--update]
 */
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { SERVER_ROOT } from '../src/config/env.js';
import { importCompetitionItems } from '../src/services/competitionImport.js';
import { seedCategories } from '../src/services/seed.js';
import { printImportReport } from './lib/report.js';

const argv = process.argv.slice(2);
const dirIndex = argv.indexOf('--dir');
const dir = dirIndex >= 0 ? path.resolve(argv[dirIndex + 1]) : path.join(SERVER_ROOT, 'data', 'keralotsavam');

async function main() {
  await connectDatabase();
  await seedCategories();
  console.log(`Importing from ${dir}`);
  const report = await importCompetitionItems({ dir, dryRun: argv.includes('--dry-run'), update: argv.includes('--update'), log: console.log });
  printImportReport(report);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(`✖ Import failed: ${error.message}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
