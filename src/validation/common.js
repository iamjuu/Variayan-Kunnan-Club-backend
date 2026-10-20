import mongoose from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .trim()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), 'Invalid identifier');

export const personName = z
  .string()
  .trim()
  .min(2, 'Name must have at least 2 characters')
  .max(100, 'Name is too long')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u, 'Name may contain only letters, spaces, dots, hyphens and apostrophes')
  .transform((v) => v.replace(/\s+/g, ' '));

export const teamName = z
  .string()
  .trim()
  .min(2, 'Team name must have at least 2 characters')
  .max(100, 'Team name is too long')
  .regex(/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.'&()-]*$/u, 'Team name contains unsupported characters')
  .transform((v) => v.replace(/\s+/g, ' '));

/** Indian mobile numbers: 10 digits starting with 6-9; optional +91 / 0 prefix is stripped. */
export const indianMobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10 digit Indian mobile number');

export const gender = z.enum(['male', 'female', 'other'], { message: 'Select a gender' });

export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

export const dateOfBirth = isoDate.refine((d) => {
  const now = new Date();
  const oldest = new Date(Date.UTC(now.getUTCFullYear() - 100, 0, 1));
  return d <= now && d >= oldest;
}, 'Enter a valid date of birth');

export const optionalEmptyToUndefined = (schema) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
