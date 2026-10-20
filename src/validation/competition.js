import { z } from 'zod';
import { objectId } from './common.js';

const optionalAge = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce.number().int().min(0).max(120).nullable(),
);

export const competitionSchema = z
  .object({
    name: z.string().trim().min(2, 'Event name is required').max(200),
    categoryId: objectId,
    participationMode: z.enum(['individual', 'group']),
    description: z.string().trim().max(2000).default(''),
    gender: z.enum(['male', 'female', 'any']),
    ageDivision: z.string().trim().max(100).default(''),
    minAge: optionalAge.default(null),
    maxAge: optionalAge.default(null),
    minParticipants: z.coerce.number().int().min(1).max(100),
    maxParticipants: z.coerce.number().int().min(1).max(100),
    isRelay: z.boolean().default(false),
    rules: z.string().trim().max(5000).default(''),
    status: z.enum(['active', 'inactive']).default('active'),
  })
  .superRefine((v, ctx) => {
    if (v.participationMode === 'individual' && (v.minParticipants !== 1 || v.maxParticipants !== 1)) {
      ctx.addIssue({ code: 'custom', path: ['maxParticipants'], message: 'Individual items must have exactly 1 participant' });
    }
    if (v.maxParticipants < v.minParticipants) {
      ctx.addIssue({ code: 'custom', path: ['maxParticipants'], message: 'Maximum must be greater than or equal to minimum' });
    }
    if (v.minAge !== null && v.maxAge !== null && v.maxAge < v.minAge) {
      ctx.addIssue({ code: 'custom', path: ['maxAge'], message: 'Maximum age must be greater than or equal to minimum age' });
    }
  });

export const statusActionSchema = z.object({ action: z.enum(['activate', 'deactivate', 'archive', 'restore']) });

export const competitionListQuery = z.object({
  categoryId: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  mode: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['individual', 'group']).optional()),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['active', 'inactive', 'archived', 'all']).optional()),
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(100).optional()),
});
