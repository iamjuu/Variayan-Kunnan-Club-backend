import { z } from 'zod';
import { MAX_GROUP_MEMBERS } from '../middleware/upload.js';
import {
  dateOfBirth,
  gender,
  indianMobile,
  objectId,
  optionalEmptyToUndefined,
  personName,
  teamName,
} from './common.js';

const participantSchema = z.object({
  fullName: personName,
  contactNumber: indianMobile,
  gender,
  dateOfBirth: optionalEmptyToUndefined(dateOfBirth),
  aadhaarNumber: optionalEmptyToUndefined(z.string().trim().regex(/^[\d\s]{12,14}$/, 'Aadhaar must be 12 digits')),
});

const memberSchema = z.object({
  fullName: personName,
  gender,
  dateOfBirth: optionalEmptyToUndefined(dateOfBirth),
  contactNumber: optionalEmptyToUndefined(indianMobile),
});

const teamSchema = z.object({
  teamName,
  teamLeaderName: personName,
  contactNumber: indianMobile,
  members: z
    .array(memberSchema)
    .min(1, 'Add at least one team member')
    .max(MAX_GROUP_MEMBERS, `A team can have at most ${MAX_GROUP_MEMBERS} members`),
});

export const registrationPayloadSchema = z
  .object({
    submissionKey: z.string().uuid('Invalid submission key'),
    mode: z.enum(['individual', 'group']),
    categoryId: objectId,
    selectedEventIds: z
      .array(objectId)
      .min(1, 'Select at least one competition item')
      .max(25, 'Too many competition items selected')
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate competition items selected'),
    consent: z.literal(true, { message: 'You must accept the privacy consent to register' }),
    participant: participantSchema.optional(),
    team: teamSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'individual' && !value.participant) {
      ctx.addIssue({ code: 'custom', path: ['participant'], message: 'Participant details are required' });
    }
    if (value.mode === 'group' && !value.team) {
      ctx.addIssue({ code: 'custom', path: ['team'], message: 'Team details are required' });
    }
  });
