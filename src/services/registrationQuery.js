import mongoose from 'mongoose';
import { z } from 'zod';
import { objectId } from '../validation/common.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blankToUndefined = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const registrationFilterSchema = z.object({
  mode: blankToUndefined(z.enum(['individual', 'group'])),
  categoryId: blankToUndefined(objectId),
  eventId: blankToUndefined(objectId),
  from: blankToUndefined(day),
  to: blankToUndefined(day),
  q: blankToUndefined(z.string().trim().max(100)),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Dates are interpreted as whole days in India Standard Time. */
function istDayStart(value) {
  return new Date(`${value}T00:00:00.000+05:30`);
}

export function buildRegistrationFilter(filters) {
  const query = {};
  if (filters.mode) query.mode = filters.mode;
  if (filters.categoryId) query.categoryId = new mongoose.Types.ObjectId(filters.categoryId);
  if (filters.eventId) query.selectedEventIds = new mongoose.Types.ObjectId(filters.eventId);
  if (filters.from || filters.to) {
    query.createdAt = {};
    if (filters.from) query.createdAt.$gte = istDayStart(filters.from);
    if (filters.to) query.createdAt.$lt = new Date(istDayStart(filters.to).getTime() + 24 * 60 * 60 * 1000);
  }
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    const digits = filters.q.replace(/\D/g, '');
    query.$or = [
      { registrationId: pattern },
      { 'participant.fullName': pattern },
      { 'team.teamName': pattern },
      { 'team.teamLeaderName': pattern },
      { 'team.members.fullName': pattern },
      ...(digits.length >= 4
        ? [{ 'participant.contactNumber': new RegExp(digits) }, { 'team.contactNumber': new RegExp(digits) }]
        : []),
    ];
  }
  return query;
}
