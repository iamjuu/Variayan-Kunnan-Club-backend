import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { issueCsrfToken, verifyCsrf } from '../middleware/csrf.js';
import { registrationLimiter } from '../middleware/rateLimits.js';
import { registrationUpload } from '../middleware/upload.js';
import { Category } from '../models/Category.js';
import { CompetitionItem } from '../models/CompetitionItem.js';
import { GALLERY_ALBUMS, GalleryImage } from '../models/GalleryImage.js';
import { CONSENT_VERSION, getSettings } from '../models/Setting.js';
import { readGalleryFile } from '../services/galleryStorage.js';
import { createRegistration, publicSummary } from '../services/registrationService.js';
import { notFound } from '../utils/httpError.js';
import { objectId } from '../validation/common.js';

export const publicRouter = Router();

publicRouter.get('/csrf-token', issueCsrfToken);

publicRouter.get('/settings/public', async (_req, res) => {
  const s = await getSettings();
  res.json({
    registrationOpen: s.registrationOpen,
    individualEventLimit: s.individualEventLimit,
    relayAllowance: s.relayAllowance,
    relayAllowanceConfirmed: s.relayAllowanceConfirmed,
    collectAadhaar: s.collectAadhaar,
    ageReferenceDate: s.ageReferenceDate,
    consentVersion: CONSENT_VERSION,
    maxPhotoMB: env.maxPhotoBytes / 1048576,
    maxDocumentMB: env.maxDocumentBytes / 1048576,
  });
});

const galleryQuery = z.object({
  album: z.preprocess((v) => (v === '' ? undefined : v), z.enum(GALLERY_ALBUMS).optional()),
  featured: z.enum(['1', 'true']).optional(),
  hero: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(36),
});

publicRouter.get('/gallery', async (req, res) => {
  const { album, featured, hero, limit } = galleryQuery.parse(req.query);
  const query = { isPublished: true };
  if (album) query.album = album;
  if (featured) query.featured = true;
  if (hero) query.hero = true;
  const items = await GalleryImage.find(query).sort({ hero: -1, featured: -1, sortOrder: 1, createdAt: -1 }).limit(album ? limit : limit * 2);
  const unique = album
    ? items
    : items.filter((item, _, list) => {
        const key = item.image?.storedName;
        if (!key) return true;
        return list.find((other) => other.image?.storedName === key) === item;
      });
  res.json(unique.slice(0, limit).map((i) => i.toJSON()));
});

publicRouter.get('/gallery/:id/image', async (req, res) => {
  const id = objectId.parse(req.params.id);
  const item = await GalleryImage.findById(id);
  if (!item || !item.isPublished) throw notFound('Photo not found');
  const buffer = await readGalleryFile(item.image);
  res.set({
    'Content-Type': item.image.mimeType,
    'Content-Length': buffer.length,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
});

const PUBLIC_FILTER = { isActive: true, archivedAt: null };

publicRouter.get('/categories', async (_req, res) => {
  const [categories, counts] = await Promise.all([
    Category.find({ isActive: true }).sort({ name: 1 }).lean(),
    CompetitionItem.aggregate([
      { $match: PUBLIC_FILTER },
      { $group: { _id: { categoryId: '$categoryId', mode: '$participationMode' }, count: { $sum: 1 } } },
    ]),
  ]);
  res.json(
    categories.map((c) => {
      const countFor = (mode) => counts.find((x) => String(x._id.categoryId) === String(c._id) && x._id.mode === mode)?.count ?? 0;
      return { _id: c._id, name: c.name, slug: c.slug, activeEvents: { individual: countFor('individual'), group: countFor('group') } };
    }),
  );
});

const competitionQuery = z.object({ categoryId: objectId, mode: z.enum(['individual', 'group']) });

publicRouter.get('/competitions', async (req, res) => {
  const { categoryId, mode } = competitionQuery.parse(req.query);
  const items = await CompetitionItem.find({ ...PUBLIC_FILTER, categoryId, participationMode: mode })
    .select('legacyEventId eventCode name description gender ageDivision minAge maxAge minParticipants maxParticipants isRelay rules startsFrom endsAt categoryId participationMode isActive archivedAt')
    .sort({ name: 1, ageDivision: 1 });
  res.json(items.map((i) => i.toJSON()));
});

publicRouter.post('/registrations', registrationLimiter, verifyCsrf, registrationUpload, async (req, res) => {
  const { registration, duplicate } = await createRegistration(req.body?.data, req.uploadedFiles ?? {});
  res.status(duplicate ? 200 : 201).json({ duplicate, registration: publicSummary(registration) });
});
