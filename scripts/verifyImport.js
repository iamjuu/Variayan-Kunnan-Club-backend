#!/usr/bin/env node
/**
 * Verifies imported competition items against the source JSON files:
 * counts per category/mode/status, missing or extra legacy ids, and broken category links.
 */
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { SERVER_ROOT } from '../src/config/env.js';
import { Category } from '../src/models/Category.js';
import { CompetitionItem } from '../src/models/CompetitionItem.js';
import { collectEventRecords, LEGACY_SOURCE, mapEventRecord, readDatasetDirectory } from '../src/services/competitionImport.js';

const dir = path.join(SERVER_ROOT, 'data', 'keralotsavam');

async function main() {
  await connectDatabase();
  const { files } = await readDatasetDirectory(dir);
  const sourceIds = new Map();
  let sourceRecords = 0;
  for (const { fileName, json, categorySlug } of files) {
    for (const { record, ctx } of collectEventRecords(json).found) {
      sourceRecords += 1;
      const { doc } = mapEventRecord(record, ctx, categorySlug);
      if (doc.legacyEventId !== undefined) sourceIds.set(String(doc.legacyEventId), { fileName, name: doc.name, categorySlug });
    }
  }

  const categories = await Category.find().lean();
  const slugOf = new Map(categories.map((c) => [String(c._id), c.slug]));
  const imported = await CompetitionItem.find({ 'legacy.source': LEGACY_SOURCE }).lean();
  const all = await CompetitionItem.find().lean();

  console.log(`Source files: ${files.length}, event records: ${sourceRecords}, unique legacy ids: ${sourceIds.size}`);
  console.log(`Database: ${all.length} competition items (${imported.length} imported, ${all.length - imported.length} admin-created)\n`);

  const table = {};
  for (const item of all) {
    const key = `${slugOf.get(String(item.categoryId)) ?? 'BROKEN'} / ${item.participationMode}`;
    table[key] ??= { active: 0, inactive: 0, archived: 0 };
    table[key][item.archivedAt ? 'archived' : item.isActive ? 'active' : 'inactive'] += 1;
  }
  console.table(table);

  const dbIds = new Set(imported.map((i) => String(i.legacyEventId)));
  const missing = [...sourceIds.entries()].filter(([id]) => !dbIds.has(id));
  const broken = all.filter((i) => !slugOf.has(String(i.categoryId)));
  const wrongCategory = imported.filter((i) => {
    const src = sourceIds.get(String(i.legacyEventId));
    return src && src.categorySlug !== slugOf.get(String(i.categoryId));
  });

  let ok = true;
  if (missing.length) {
    ok = false;
    console.log(`✖ ${missing.length} source event(s) not in the database:`);
    missing.slice(0, 30).forEach(([id, s]) => console.log(`   ${id} ${s.name} (${s.fileName})`));
  }
  if (broken.length) {
    ok = false;
    console.log(`✖ ${broken.length} item(s) reference a missing category`);
  }
  if (wrongCategory.length) console.log(`⚠ ${wrongCategory.length} item(s) are now in a different category than their source file (admin edit?)`);
  console.log(ok ? '\n✔ Import verified: every source event is present and linked to a valid category.' : '\n✖ Verification found problems.');
  await disconnectDatabase();
  process.exit(ok ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`✖ Verification failed: ${error.message}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
