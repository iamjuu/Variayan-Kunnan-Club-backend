import { Category } from '../models/Category.js';
import { CompetitionItem } from '../models/CompetitionItem.js';
import { nextSequence } from '../models/Counter.js';
import { Registration } from '../models/Registration.js';
import { CONSENT_VERSION, getSettings } from '../models/Setting.js';
import { isValidAadhaar, protectAadhaar } from '../utils/aadhaar.js';
import { keyedHash } from '../utils/crypto.js';
import { badRequest, conflict, forbidden } from '../utils/httpError.js';
import { registrationPayloadSchema } from '../validation/registration.js';
import {
  duplicateMemberProblems,
  eventLimitProblems,
  normaliseName,
  personEventProblems,
  teamSizeProblems,
} from './eligibility.js';
import { deletePrivateFiles, storePrivateFile } from './fileStorage.js';

function parsePayload(rawData) {
  let parsed;
  try {
    parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    throw badRequest('Registration data is not valid JSON.');
  }
  return registrationPayloadSchema.parse(parsed);
}

function snapshot(event) {
  return {
    eventId: event._id,
    displayEventId: event.displayEventId,
    name: event.name,
    gender: event.gender,
    ageDivision: event.ageDivision,
    isRelay: event.isRelay,
  };
}

export function individualIdentityKey(categoryId, participant) {
  return keyedHash(`individual:${categoryId}:${normaliseName(participant.fullName)}:${participant.contactNumber}`);
}

export function teamIdentityKey(categoryId, team) {
  return keyedHash(`team:${categoryId}:${normaliseName(team.teamName)}:${team.contactNumber}`);
}

async function generateRegistrationId(mode) {
  const year = new Date().getFullYear();
  const prefix = mode === 'individual' ? 'I' : 'G';
  const seq = await nextSequence(`registration-${year}-${prefix}`);
  return `VKC-${year}-${prefix}-${String(seq).padStart(5, '0')}`;
}

async function loadEvents(payload) {
  const category = await Category.findOne({ _id: payload.categoryId, isActive: true });
  if (!category) throw badRequest('Selected category is not available.');

  const events = await CompetitionItem.find({ _id: { $in: payload.selectedEventIds } });
  const byId = new Map(events.map((e) => [String(e._id), e]));
  const ordered = payload.selectedEventIds.map((id) => byId.get(id));
  const problems = [];
  ordered.forEach((event, i) => {
    if (!event || !event.isActive || event.archivedAt) {
      problems.push(`Competition item ${i + 1} is no longer available. Please reselect your items.`);
    } else if (String(event.categoryId) !== String(category._id)) {
      problems.push(`"${event.name}" does not belong to ${category.name}.`);
    } else if (event.participationMode !== payload.mode) {
      problems.push(`"${event.name}" is not a ${payload.mode} competition item.`);
    }
  });
  if (problems.length) throw badRequest(problems[0], problems);
  return { category, events: ordered };
}

function referenceDate(settings) {
  return settings.ageReferenceDate ?? new Date();
}

async function validateIndividual(payload, events, settings, files) {
  const { participant } = payload;
  const problems = [];
  if (!files.participantPhoto) problems.push('A passport size photo is required.');

  const refDate = referenceDate(settings);
  for (const event of events) problems.push(...personEventProblems(participant, event, refDate, 'The participant'));

  const identityKey = individualIdentityKey(payload.categoryId, participant);
  const previous = await Registration.find({ mode: 'individual', identityKey }).select('events');
  const previousEvents = previous.flatMap((r) => r.events);
  const previousIds = new Set(previousEvents.map((e) => String(e.eventId)));
  const repeated = events.filter((e) => previousIds.has(String(e._id)));
  if (repeated.length) {
    throw conflict(`This participant is already registered for: ${repeated.map((e) => e.name).join(', ')}.`);
  }
  problems.push(...eventLimitProblems(events, settings, previousEvents));

  let aadhaar = {};
  if (participant.aadhaarNumber) {
    if (!settings.collectAadhaar) throw badRequest('Aadhaar collection is not enabled for this event.');
    if (!isValidAadhaar(participant.aadhaarNumber)) problems.push('The Aadhaar number entered is not valid.');
    else aadhaar = protectAadhaar(participant.aadhaarNumber);
  }
  if (files.aadhaarDocument && !settings.collectAadhaar) {
    throw badRequest('Aadhaar document upload is not enabled for this event.');
  }
  if (problems.length) throw badRequest(problems[0], problems);
  return { identityKey, aadhaar };
}

async function validateGroup(payload, events, settings, files) {
  const { team } = payload;
  const problems = [];
  const refDate = referenceDate(settings);

  team.members.forEach((member, index) => {
    if (!files[`memberPhoto_${index}`]) problems.push(`A passport size photo is required for member ${index + 1}.`);
    for (const event of events) {
      problems.push(...personEventProblems(member, event, refDate, `Member ${index + 1} (${member.fullName})`));
    }
  });
  problems.push(...teamSizeProblems(team.members.length, events));
  problems.push(...duplicateMemberProblems(team.members));

  const identityKey = teamIdentityKey(payload.categoryId, team);
  const previous = await Registration.find({ mode: 'group', identityKey }).select('events');
  const previousIds = new Set(previous.flatMap((r) => r.events.map((e) => String(e.eventId))));
  const repeated = events.filter((e) => previousIds.has(String(e._id)));
  if (repeated.length) {
    throw conflict(`This team is already registered for: ${repeated.map((e) => e.name).join(', ')}.`);
  }
  if (problems.length) throw badRequest(problems[0], problems);
  return { identityKey };
}

export async function findBySubmissionKey(submissionKey) {
  return Registration.findOne({ submissionKey }).populate('categoryId', 'name slug');
}

export async function createRegistration(rawData, files) {
  const payload = parsePayload(rawData);

  const existing = await findBySubmissionKey(payload.submissionKey);
  if (existing) return { registration: existing, duplicate: true };

  const settings = await getSettings();
  if (!settings.registrationOpen) throw forbidden('Registrations are currently closed.');

  const { category, events } = await loadEvents(payload);
  const checks =
    payload.mode === 'individual'
      ? await validateIndividual(payload, events, settings, files)
      : await validateGroup(payload, events, settings, files);

  const stored = [];
  try {
    const store = async (file) => {
      const ref = await storePrivateFile(file.buffer, file.mimeType);
      stored.push(ref);
      return ref;
    };

    const doc = {
      registrationId: await generateRegistrationId(payload.mode),
      mode: payload.mode,
      categoryId: category._id,
      selectedEventIds: events.map((e) => e._id),
      events: events.map(snapshot),
      identityKey: checks.identityKey,
      submissionKey: payload.submissionKey,
      consentAcceptedAt: new Date(),
      consentVersion: CONSENT_VERSION,
    };

    if (payload.mode === 'individual') {
      const { aadhaarNumber: _omit, ...participant } = payload.participant;
      doc.participant = {
        ...participant,
        dateOfBirth: participant.dateOfBirth ?? null,
        ...checks.aadhaar,
        photo: await store(files.participantPhoto),
        aadhaarDocument: files.aadhaarDocument ? await store(files.aadhaarDocument) : null,
      };
    } else {
      const members = [];
      for (const [index, member] of payload.team.members.entries()) {
        members.push({
          memberNumber: index + 1,
          fullName: member.fullName,
          gender: member.gender,
          dateOfBirth: member.dateOfBirth ?? null,
          contactNumber: member.contactNumber ?? null,
          photo: await store(files[`memberPhoto_${index}`]),
        });
      }
      doc.team = {
        teamName: payload.team.teamName,
        teamLeaderName: payload.team.teamLeaderName,
        contactNumber: payload.team.contactNumber,
        members,
      };
    }

    const registration = await Registration.create(doc);
    await registration.populate('categoryId', 'name slug');
    return { registration, duplicate: false };
  } catch (error) {
    await deletePrivateFiles(stored);
    if (error?.code === 11000 && error?.keyPattern?.submissionKey) {
      const racing = await findBySubmissionKey(payload.submissionKey);
      if (racing) return { registration: racing, duplicate: true };
    }
    throw error;
  }
}

/** Public-safe summary returned to the registrant (no file references or hashes). */
export function publicSummary(registration) {
  const r = registration.toJSON();
  return {
    registrationId: r.registrationId,
    mode: r.mode,
    category: r.categoryId?.name ?? null,
    events: r.events.map((e) => ({ displayEventId: e.displayEventId, name: e.name })),
    participantName: r.participant?.fullName ?? null,
    teamName: r.team?.teamName ?? null,
    teamLeaderName: r.team?.teamLeaderName ?? null,
    memberCount: r.team?.members?.length ?? null,
    createdAt: r.createdAt,
  };
}
