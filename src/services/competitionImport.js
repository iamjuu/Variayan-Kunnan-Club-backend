import fs from 'node:fs/promises';
import path from 'node:path';
import { Category } from '../models/Category.js';
import { CompetitionItem } from '../models/CompetitionItem.js';
import { nextSequence } from '../models/Counter.js';

export const LEGACY_SOURCE = 'keralotsavam';

const TRUE_VALUES = new Set([true, 1, '1', 'true', 'yes', 'y', 'active']);
const MALE = new Set(['male', 'm', 'boy', 'boys', 'men', 'man', 'gents']);
const FEMALE = new Set(['female', 'f', 'girl', 'girls', 'women', 'woman', 'ladies']);
const OPEN = new Set(['', 'any', 'all', 'both', 'mixed', 'common', 'open', 'general', 'male & female', 'male and female', 'male/female']);

const pick = (obj, ...keys) => keys.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null && v !== '');

function toId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object' && value.$oid) return value.$oid;
  if (typeof value === 'object') return undefined;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return value;
}

const toBool = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : TRUE_VALUES.has(typeof v === 'string' ? v.trim().toLowerCase() : v));

function toInt(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(typeof v === 'object' && v.$date ? v.$date : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function labelOf(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return String(pick(v, 'name', 'title', 'label', 'value') ?? '');
  return String(v).trim();
}

export function normaliseGender(raw) {
  const value = labelOf(raw).toLowerCase();
  if (MALE.has(value)) return { gender: 'male', recognised: true };
  if (FEMALE.has(value)) return { gender: 'female', recognised: true };
  if (OPEN.has(value)) return { gender: 'any', recognised: true };
  return { gender: 'any', recognised: false };
}

function isEventRecord(node) {
  return node && typeof node === 'object' && !Array.isArray(node) && typeof node.event_name === 'string';
}

function categoryContext(node, parent) {
  const name = pick(node, 'category_name', 'sub_category_name', 'name', 'title');
  const id = toId(pick(node, 'id', '_id', 'category_id', 'sub_category_id'));
  if (!name && id === undefined) return parent;
  return {
    id: id ?? parent?.id,
    name: typeof name === 'string' ? name : parent?.name,
    parentId: toId(pick(node, 'parent_id', 'main_category_id')) ?? parent?.id,
  };
}

/** Walks any JSON shape and collects every object with an `event_name`, remembering the enclosing category. */
export function collectEventRecords(json) {
  const found = [];
  const emptyCategories = [];
  const walk = (node, ctx) => {
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, ctx));
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (isEventRecord(node)) {
      found.push({ record: node, ctx });
      return;
    }
    const nextCtx = categoryContext(node, ctx);
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value) && value.length === 0 && /event/i.test(key)) {
        emptyCategories.push(nextCtx?.name ?? nextCtx?.id ?? '(unnamed)');
      }
      if (value && typeof value === 'object') walk(value, nextCtx);
    }
  };
  walk(json, undefined);
  return { found, emptyCategories };
}

/** Maps a raw Keralotsavam event using the agreed field mapping. */
export function mapEventRecord(record, ctx, categorySlug) {
  const warnings = [];
  const legacyEventId = toId(pick(record, 'id', 'event_id', '_id'));
  const isGroupEvent = toBool(record.is_group_event, false);
  const genderInfo = normaliseGender(record.gender);
  if (!genderInfo.recognised) warnings.push(`unrecognised gender "${labelOf(record.gender)}" treated as open`);

  let minParticipants = toInt(record.min_allowed_participants);
  let maxParticipants = toInt(record.max_allowed_participants);
  if (minParticipants === undefined || minParticipants < 1) {
    if (isGroupEvent) warnings.push('missing min_allowed_participants');
    minParticipants = 1;
  }
  if (maxParticipants === undefined || maxParticipants < 1) {
    if (isGroupEvent) warnings.push('missing max_allowed_participants');
    maxParticipants = isGroupEvent ? Math.max(minParticipants, 1) : 1;
  }
  if (maxParticipants < minParticipants) {
    warnings.push(`max (${maxParticipants}) < min (${minParticipants}); max raised to min`);
    maxParticipants = minParticipants;
  }

  const levels = record.event_levels ?? record.eventLevels;
  const name = String(record.event_name).trim();
  const doc = {
    name,
    participationMode: isGroupEvent ? 'group' : 'individual',
    isGroupEvent,
    gender: genderInfo.gender,
    ageDivision: labelOf(record.sub_gender),
    minParticipants,
    maxParticipants,
    isActive: toBool(record.is_active, true),
    startsFrom: toDate(record.event_starts_from),
    endsAt: toDate(record.event_ends_at),
    eventLevels: levels === undefined || levels === null ? [] : Array.isArray(levels) ? levels : [levels],
    description: typeof record.description === 'string' ? record.description.trim() : '',
    rules: typeof record.rules === 'string' ? record.rules.trim() : '',
    isRelay: /relay/i.test(name),
    legacy: {
      source: LEGACY_SOURCE,
      categoryId: toId(pick(record, 'category_id', 'main_category_id')) ?? ctx?.parentId ?? ctx?.id,
      subCategoryId: toId(pick(record, 'sub_category_id', 'subcategory_id')) ?? ctx?.id,
      subCategoryName: labelOf(pick(record, 'sub_category_name', 'category_name')) || ctx?.name || '',
      gender: record.gender ?? null,
      subGender: record.sub_gender ?? null,
      isGroupEvent: record.is_group_event ?? null,
      raw: record,
    },
  };
  if (legacyEventId !== undefined) doc.legacyEventId = legacyEventId;
  return { doc, warnings, categorySlug };
}

export function categorySlugForFile(fileName, manifest) {
  const override = manifest?.files?.[fileName];
  if (override === 'arts' || override === 'sports') return override;
  return /\bart/i.test(fileName.replace(/[_-]/g, ' ')) ? 'arts' : 'sports';
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`manifest.json is not valid JSON: ${error.message}`);
  }
}

export async function readDatasetDirectory(dir) {
  const manifest = await readManifest(dir);
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return { files: [], manifest };
    throw error;
  }
  const files = [];
  for (const fileName of entries.filter((f) => f.toLowerCase().endsWith('.json') && f !== 'manifest.json').sort()) {
    const text = await fs.readFile(path.join(dir, fileName), 'utf8');
    let json;
    try {
      json = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`${fileName} is not valid JSON: ${error.message}`);
    }
    files.push({ fileName, json, categorySlug: categorySlugForFile(fileName, manifest) });
  }
  return { files, manifest };
}

function dedupeKey(doc, categoryId) {
  if (doc.legacyEventId !== undefined) return `id:${doc.legacyEventId}`;
  return `name:${String(categoryId)}|${doc.participationMode}|${doc.gender}|${doc.ageDivision}|${doc.name.toLowerCase()}`;
}

/**
 * Imports competition items from the dataset directory. Existing items (same legacy id) are left
 * untouched unless `update` is set, so admin edits survive re-imports.
 */
export async function importCompetitionItems({ dir, dryRun = false, update = false, log = () => {} }) {
  const { files } = await readDatasetDirectory(dir);
  const categories = new Map((await Category.find()).map((c) => [c.slug, c]));
  const report = { files: [], created: 0, updated: 0, skippedExisting: 0, duplicatesInSource: 0, warnings: [], dryRun };
  const seen = new Set();

  for (const { fileName, json, categorySlug } of files) {
    const category = categories.get(categorySlug);
    if (!category) throw new Error(`Category "${categorySlug}" missing – run the seed script first.`);
    const { found, emptyCategories } = collectEventRecords(json);
    const fileReport = { fileName, category: category.name, records: found.length, created: 0, updated: 0, skipped: 0, emptyCategories };

    for (const { record, ctx } of found) {
      const { doc, warnings } = mapEventRecord(record, ctx, categorySlug);
      const label = `${fileName} › ${doc.legacyEventId ?? '(no id)'} ${doc.name}`;
      warnings.forEach((w) => report.warnings.push(`${label}: ${w}`));

      const key = dedupeKey(doc, category._id);
      if (seen.has(key)) {
        report.duplicatesInSource += 1;
        fileReport.skipped += 1;
        continue;
      }
      seen.add(key);

      const filter =
        doc.legacyEventId !== undefined
          ? { legacyEventId: doc.legacyEventId, 'legacy.source': LEGACY_SOURCE }
          : { 'legacy.source': LEGACY_SOURCE, categoryId: category._id, name: doc.name, participationMode: doc.participationMode, gender: doc.gender, ageDivision: doc.ageDivision };
      const existing = await CompetitionItem.findOne(filter);

      if (existing && !update) {
        report.skippedExisting += 1;
        fileReport.skipped += 1;
        continue;
      }
      if (dryRun) {
        if (existing) fileReport.updated += 1;
        else fileReport.created += 1;
        continue;
      }
      if (existing) {
        existing.set({ ...doc, categoryId: category._id });
        await existing.save();
        fileReport.updated += 1;
      } else {
        const eventCode = doc.legacyEventId !== undefined ? `KL-${doc.legacyEventId}` : `VK-${String(await nextSequence('event-code')).padStart(4, '0')}`;
        await CompetitionItem.create({ ...doc, categoryId: category._id, eventCode });
        fileReport.created += 1;
      }
    }
    report.created += fileReport.created;
    report.updated += fileReport.updated;
    report.files.push(fileReport);
    log(`  ${fileName} → ${category.name}: ${found.length} records, ${fileReport.created} created, ${fileReport.updated} updated, ${fileReport.skipped} skipped`);
  }
  return report;
}
