import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAdmin, requirePasswordCurrent } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { exportLimiter } from '../middleware/rateLimits.js';
import { galleryUpload } from '../middleware/upload.js';
import { Category } from '../models/Category.js';
import { CompetitionItem } from '../models/CompetitionItem.js';
import { nextSequence } from '../models/Counter.js';
import { ExportLog } from '../models/ExportLog.js';
import { GALLERY_ALBUMS, GalleryImage } from '../models/GalleryImage.js';
import { Registration } from '../models/Registration.js';
import { getSettings } from '../models/Setting.js';
import { deleteGalleryFile, readGalleryFile, storeGalleryFile } from '../services/galleryStorage.js';
import { describeFilters, loadExportData, reportTitle } from '../services/exportData.js';
import { buildExcel } from '../services/exportExcel.js';
import { buildPdf } from '../services/exportPdf.js';
import { collectRegistrationFiles, deletePrivateFiles, readPrivateFile } from '../services/fileStorage.js';
import { buildRegistrationFilter, paginationSchema, registrationFilterSchema } from '../services/registrationQuery.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { competitionListQuery, competitionSchema, statusActionSchema } from '../validation/competition.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin, requirePasswordCurrent, verifyCsrf);
adminRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------- dashboard ------------------------------ */

adminRouter.get('/dashboard', async (_req, res) => {
  const [categories, byMode, byCategory, activeEvents, galleryPhotos, recent, topEvents] = await Promise.all([
    Category.find().lean(),
    Registration.aggregate([{ $group: { _id: '$mode', count: { $sum: 1 } } }]),
    Registration.aggregate([{ $group: { _id: '$categoryId', count: { $sum: 1 } } }]),
    CompetitionItem.countDocuments({ isActive: true, archivedAt: null }),
    GalleryImage.countDocuments(),
    Registration.find().sort({ createdAt: -1 }).limit(8).populate('categoryId', 'name slug').lean(),
    Registration.aggregate([
      { $unwind: '$events' },
      { $group: { _id: '$events.eventId', name: { $first: '$events.name' }, displayEventId: { $first: '$events.displayEventId' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);
  const slugOf = new Map(categories.map((c) => [String(c._id), c.slug]));
  const modeCount = (m) => byMode.find((x) => x._id === m)?.count ?? 0;
  const categoryCount = (slug) => byCategory.filter((x) => slugOf.get(String(x._id)) === slug).reduce((n, x) => n + x.count, 0);
  res.json({
    stats: {
      totalRegistrations: modeCount('individual') + modeCount('group'),
      individualRegistrations: modeCount('individual'),
      groupRegistrations: modeCount('group'),
      artsRegistrations: categoryCount('arts'),
      sportsRegistrations: categoryCount('sports'),
      totalActiveEvents: activeEvents,
      galleryPhotos,
    },
    recentRegistrations: recent.map(listItem),
    topEvents,
  });
});

/* ----------------------------- registrations ---------------------------- */

function listItem(r) {
  return {
    _id: r._id,
    registrationId: r.registrationId,
    mode: r.mode,
    category: r.categoryId?.name ? { _id: r.categoryId._id, name: r.categoryId.name, slug: r.categoryId.slug } : null,
    participant: r.participant ? { fullName: r.participant.fullName, contactNumber: r.participant.contactNumber, gender: r.participant.gender } : null,
    team: r.team
      ? { teamName: r.team.teamName, teamLeaderName: r.team.teamLeaderName, contactNumber: r.team.contactNumber, memberCount: r.team.members.length }
      : null,
    events: r.events.map((e) => ({ eventId: e.eventId, displayEventId: e.displayEventId, name: e.name })),
    createdAt: r.createdAt,
  };
}

adminRouter.get('/registrations', async (req, res) => {
  const filters = registrationFilterSchema.parse(req.query);
  const { page, limit } = paginationSchema.parse(req.query);
  const query = buildRegistrationFilter(filters);
  const [items, total] = await Promise.all([
    Registration.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('categoryId', 'name slug')
      .lean(),
    Registration.countDocuments(query),
  ]);
  res.json({ items: items.map(listItem), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

const exportQuerySchema = registrationFilterSchema.extend({
  format: z.enum(['xlsx', 'pdf']),
  view: z.enum(['registrations', 'events']).default('registrations'),
});

adminRouter.get('/registrations/export', exportLimiter, async (req, res) => {
  const { format, view, ...filters } = exportQuerySchema.parse(req.query);
  const data = await loadExportData(filters);
  const filterParts = await describeFilters(filters);
  const title = view === 'events' && !filters.eventId ? reportTitle(filters, filterParts).replace('Registrations', 'Registrations (Event-wise)') : reportTitle(filters, filterParts);
  const generatedBy = req.admin.email;

  await ExportLog.create({
    adminId: req.admin._id,
    adminEmail: req.admin.email,
    format,
    filters: { ...filters, view },
    recordCount: data.totals.registrations,
    ipAddress: req.ip,
  });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const baseName = `vkc-registrations-${filters.mode ?? 'all'}-${stamp}`;
  if (format === 'xlsx') {
    const buffer = await buildExcel(data, { filterParts, title, generatedBy });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
    });
    return res.send(Buffer.from(buffer));
  }
  const buffer = await buildPdf(data, { title, filterParts, generatedBy, view });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${baseName}.pdf"` });
  return res.send(buffer);
});

async function findRegistration(id) {
  const query = mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { registrationId: String(id) };
  const registration = await Registration.findOne(query).populate('categoryId', 'name slug');
  if (!registration) throw notFound('Registration not found');
  return registration;
}

adminRouter.get('/registrations/:id', async (req, res) => {
  const r = (await findRegistration(req.params.id)).toJSON();
  const strip = (file) => (file ? { mimeType: file.mimeType, size: file.size } : null);
  if (r.participant) {
    r.participant.photo = strip(r.participant.photo);
    r.participant.aadhaarDocument = strip(r.participant.aadhaarDocument);
  }
  if (r.team) r.team.members = r.team.members.map((m) => ({ ...m, photo: strip(m.photo) }));
  r.category = r.categoryId;
  delete r.categoryId;
  res.json(r);
});

adminRouter.get('/registrations/:id/files/:kind', async (req, res) => {
  const registration = await findRegistration(req.params.id);
  const { kind } = req.params;
  let fileRef;
  if (kind === 'photo') fileRef = registration.participant?.photo;
  else if (kind === 'aadhaar') fileRef = registration.participant?.aadhaarDocument;
  else if (/^member-\d{1,2}$/.test(kind)) {
    const number = Number(kind.split('-')[1]);
    fileRef = registration.team?.members.find((m) => m.memberNumber === number)?.photo;
  }
  if (!fileRef) throw notFound('File not found');
  const buffer = await readPrivateFile(fileRef);
  res.set({
    'Content-Type': fileRef.mimeType,
    'Content-Disposition': kind === 'aadhaar' ? 'attachment; filename="aadhaar-document"' : 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.send(buffer);
});

adminRouter.delete('/registrations/:id', async (req, res) => {
  const registration = await findRegistration(req.params.id);
  const files = collectRegistrationFiles(registration);
  await registration.deleteOne();
  await deletePrivateFiles(files);
  res.json({ ok: true });
});

/* ------------------------------ competitions ---------------------------- */

adminRouter.get('/categories', async (_req, res) => {
  res.json(await Category.find().sort({ name: 1 }).lean());
});

adminRouter.get('/competitions', async (req, res) => {
  const { categoryId, mode, status, q } = competitionListQuery.parse(req.query);
  const query = {};
  if (categoryId) query.categoryId = categoryId;
  if (mode) query.participationMode = mode;
  if (status === 'active') Object.assign(query, { isActive: true, archivedAt: null });
  else if (status === 'inactive') Object.assign(query, { isActive: false, archivedAt: null });
  else if (status === 'archived') query.archivedAt = { $ne: null };
  else if (status !== 'all') query.archivedAt = null;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    query.$or = [{ name: pattern }, { eventCode: pattern }, { ageDivision: pattern }, ...(/^\d+$/.test(q) ? [{ legacyEventId: Number(q) }] : [])];
  }
  const items = await CompetitionItem.find(query).populate('categoryId', 'name slug').sort({ name: 1, ageDivision: 1 });
  const counts = await Registration.aggregate([
    { $match: { selectedEventIds: { $in: items.map((i) => i._id) } } },
    { $unwind: '$selectedEventIds' },
    { $group: { _id: '$selectedEventIds', count: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json(items.map((i) => ({ ...i.toJSON(), registrationCount: countOf.get(String(i._id)) ?? 0 })));
});

function toItemFields(input) {
  const { status, ...rest } = input;
  return {
    ...rest,
    isGroupEvent: input.participationMode === 'group',
    isActive: status === 'active',
  };
}

adminRouter.post('/competitions', async (req, res) => {
  const input = competitionSchema.parse(req.body);
  if (!(await Category.exists({ _id: input.categoryId }))) throw badRequest('Category not found');
  const eventCode = `VK-${String(await nextSequence('event-code')).padStart(4, '0')}`;
  const item = await CompetitionItem.create({ ...toItemFields(input), eventCode });
  res.status(201).json(item.toJSON());
});

adminRouter.put('/competitions/:id', async (req, res) => {
  const input = competitionSchema.parse(req.body);
  const item = await CompetitionItem.findById(req.params.id);
  if (!item) throw notFound('Competition item not found');
  if (item.archivedAt) throw conflict('Restore this archived item before editing it.');
  const used = await Registration.exists({ selectedEventIds: item._id });
  if (used && (String(item.categoryId) !== input.categoryId || item.participationMode !== input.participationMode)) {
    throw conflict('Category and participation mode cannot be changed after registrations exist for this item.');
  }
  item.set(toItemFields(input));
  await item.save();
  res.json(item.toJSON());
});

adminRouter.patch('/competitions/:id/status', async (req, res) => {
  const { action } = statusActionSchema.parse(req.body);
  const item = await CompetitionItem.findById(req.params.id);
  if (!item) throw notFound('Competition item not found');
  if (action === 'activate') {
    if (item.archivedAt) throw conflict('Restore this archived item before activating it.');
    item.isActive = true;
  } else if (action === 'deactivate') {
    item.isActive = false;
  } else if (action === 'archive') {
    item.isActive = false;
    item.archivedAt = new Date();
  } else {
    item.archivedAt = null;
    item.isActive = false;
  }
  await item.save();
  res.json(item.toJSON());
});

adminRouter.delete('/competitions/:id', async (req, res) => {
  const item = await CompetitionItem.findById(req.params.id);
  if (!item) throw notFound('Competition item not found');
  const count = await Registration.countDocuments({ selectedEventIds: item._id });
  if (count > 0) throw conflict(`This item has ${count} registration(s) and cannot be deleted. Archive it instead.`);
  if (item.legacyEventId !== undefined) throw conflict('Imported Keralotsavam items cannot be deleted. Archive them instead.');
  await item.deleteOne();
  res.json({ ok: true });
});

/* -------------------------------- settings ------------------------------ */

const settingsSchema = z.object({
  registrationOpen: z.boolean(),
  individualEventLimit: z.coerce.number().int().min(1).max(50),
  relayAllowance: z.coerce.number().int().min(0).max(10),
  relayAllowanceConfirmed: z.boolean(),
  ageReferenceDate: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  collectAadhaar: z.boolean(),
  retentionDays: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(30).max(3650).nullable()),
});

adminRouter.get('/settings', async (_req, res) => {
  res.json((await getSettings()).toJSON());
});

adminRouter.put('/settings', async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const settings = await getSettings();
  settings.set({
    ...input,
    ageReferenceDate: input.ageReferenceDate ? new Date(`${input.ageReferenceDate}T00:00:00.000Z`) : null,
    updatedBy: req.admin._id,
  });
  await settings.save();
  res.json(settings.toJSON());
});

adminRouter.get('/export-logs', async (_req, res) => {
  res.json(await ExportLog.find().sort({ createdAt: -1 }).limit(50).lean());
});

/* --------------------------------- gallery ------------------------------ */

const galleryMetaSchema = z.object({
  title: z.string().trim().max(140).default(''),
  caption: z.string().trim().max(400).default(''),
  album: z.enum(GALLERY_ALBUMS).default('club'),
  featured: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
  hero: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
  isPublished: z.preprocess((v) => v === undefined || v === true || v === 'true' || v === '1', z.boolean()).default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

function adminGalleryItem(doc) {
  const json = doc.toJSON();
  json.imageUrl = `/api/admin/gallery/${json._id}/image`;
  return json;
}

async function exclusiveHero(keepId) {
  await GalleryImage.updateMany({ hero: true, _id: { $ne: keepId } }, { $set: { hero: false } });
}

adminRouter.get('/gallery', async (req, res) => {
  const album = req.query.album && GALLERY_ALBUMS.includes(req.query.album) ? req.query.album : undefined;
  const query = album ? { album } : {};
  const items = await GalleryImage.find(query).sort({ hero: -1, featured: -1, sortOrder: 1, createdAt: -1 });
  res.json(items.map(adminGalleryItem));
});

adminRouter.get('/gallery/:id/image', async (req, res) => {
  const item = await GalleryImage.findById(req.params.id);
  if (!item) throw notFound('Photo not found');
  const buffer = await readGalleryFile(item.image);
  res.set({
    'Content-Type': item.image.mimeType,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
});

adminRouter.post('/gallery', galleryUpload, async (req, res) => {
  const files = req.galleryFiles ?? [];
  if (!files.length) throw badRequest('Choose at least one photo to upload.');
  const meta = galleryMetaSchema.parse(req.body ?? {});
  const created = [];
  try {
    for (const [index, file] of files.entries()) {
      const stored = await storeGalleryFile(file.buffer, file.mimeType);
      const title = meta.title || file.originalName?.replace(/\.[^.]+$/, '') || '';
      const doc = await GalleryImage.create({
        ...meta,
        hero: Boolean(meta.hero) && index === 0,
        title,
        image: stored,
        uploadedBy: req.admin._id,
      });
      created.push(doc);
    }
    if (meta.hero && created[0]) await exclusiveHero(created[0]._id);
  } catch (error) {
    await Promise.all(created.map((d) => deleteGalleryFile(d.image)));
    await Promise.all(created.map((d) => d.deleteOne()));
    throw error;
  }
  res.status(201).json(created.map(adminGalleryItem));
});

adminRouter.put('/gallery/:id', async (req, res) => {
  const meta = galleryMetaSchema.parse(req.body ?? {});
  const item = await GalleryImage.findById(req.params.id);
  if (!item) throw notFound('Photo not found');
  item.set(meta);
  await item.save();
  if (item.hero) await exclusiveHero(item._id);
  res.json(adminGalleryItem(item));
});

adminRouter.patch('/gallery/:id/image', galleryUpload, async (req, res) => {
  const file = req.galleryFiles?.[0];
  if (!file) throw badRequest('Choose a replacement photo.');
  const item = await GalleryImage.findById(req.params.id);
  if (!item) throw notFound('Photo not found');
  const previous = item.image;
  item.image = await storeGalleryFile(file.buffer, file.mimeType);
  await item.save();
  await deleteGalleryFile(previous);
  res.json(adminGalleryItem(item));
});

adminRouter.delete('/gallery/:id', async (req, res) => {
  const item = await GalleryImage.findById(req.params.id);
  if (!item) throw notFound('Photo not found');
  await deleteGalleryFile(item.image);
  await item.deleteOne();
  res.json({ ok: true });
});
