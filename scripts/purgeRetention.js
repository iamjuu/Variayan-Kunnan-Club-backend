#!/usr/bin/env node
/**
 * Deletes registrations (and their private files) older than the retention period configured
 * in Settings. Does nothing when no retention period is set. Run with --dry-run to preview.
 * Schedule this (e.g. daily via cron / Task Scheduler) once a retention period is agreed.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { Registration } from '../src/models/Registration.js';
import { getSettings } from '../src/models/Setting.js';
import { collectRegistrationFiles, deletePrivateFiles } from '../src/services/fileStorage.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await connectDatabase();
  const settings = await getSettings();
  if (!settings.retentionDays) {
    console.log('No retention period configured in Settings – nothing to purge.');
    return disconnectDatabase();
  }
  const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000);
  const expired = await Registration.find({ createdAt: { $lt: cutoff } });
  console.log(`${expired.length} registration(s) older than ${settings.retentionDays} days (before ${cutoff.toISOString()}).`);
  if (!dryRun) {
    for (const registration of expired) {
      const files = collectRegistrationFiles(registration);
      await registration.deleteOne();
      await deletePrivateFiles(files);
    }
    console.log(`Deleted ${expired.length} registration(s) and their files.`);
  }
  return disconnectDatabase();
}

main().catch(async (error) => {
  console.error(`✖ Purge failed: ${error.message}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
