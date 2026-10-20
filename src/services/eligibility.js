const GENDER_LABEL = { male: 'male', female: 'female', any: 'all genders' };

export function ageOn(dateOfBirth, referenceDate) {
  const dob = new Date(dateOfBirth);
  const ref = new Date(referenceDate);
  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    ref.getUTCMonth() < dob.getUTCMonth() ||
    (ref.getUTCMonth() === dob.getUTCMonth() && ref.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function hasAgeRule(event) {
  return Number.isFinite(event.minAge) || Number.isFinite(event.maxAge);
}

/** Returns a list of human-readable problems for one person entering one event. */
export function personEventProblems(person, event, referenceDate, label = person.fullName) {
  const problems = [];
  if (event.gender && event.gender !== 'any' && person.gender !== event.gender) {
    problems.push(`${label} is not eligible for "${event.name}" (open to ${GENDER_LABEL[event.gender]} participants only).`);
  }
  if (hasAgeRule(event)) {
    if (!person.dateOfBirth) {
      problems.push(`Date of birth of ${label} is required for "${event.name}" (age-restricted).`);
    } else {
      const age = ageOn(person.dateOfBirth, referenceDate);
      if (Number.isFinite(event.minAge) && age < event.minAge) {
        problems.push(`${label} must be at least ${event.minAge} years old for "${event.name}".`);
      }
      if (Number.isFinite(event.maxAge) && age > event.maxAge) {
        problems.push(`${label} must be at most ${event.maxAge} years old for "${event.name}".`);
      }
    }
  }
  return problems;
}

/**
 * Individual event limit. When the admin has confirmed the relay allowance, relay items are
 * counted separately against `relayAllowance`; otherwise they count towards the normal limit.
 */
export function eventLimitProblems(events, settings, alreadyRegistered = []) {
  const all = [...alreadyRegistered, ...events];
  const limit = settings.individualEventLimit;
  if (settings.relayAllowanceConfirmed && settings.relayAllowance > 0) {
    const relay = all.filter((e) => e.isRelay).length;
    const regular = all.length - relay;
    const problems = [];
    if (regular > limit) problems.push(`A participant may enter at most ${limit} competition items (excluding relay).`);
    if (relay > settings.relayAllowance) {
      problems.push(`A participant may enter at most ${settings.relayAllowance} relay item(s).`);
    }
    return problems;
  }
  return all.length > limit ? [`A participant may enter at most ${limit} competition items.`] : [];
}

export function teamSizeProblems(memberCount, events) {
  return events
    .filter((e) => memberCount < e.minParticipants || memberCount > e.maxParticipants)
    .map((e) =>
      e.minParticipants === e.maxParticipants
        ? `"${e.name}" requires exactly ${e.minParticipants} members (you added ${memberCount}).`
        : `"${e.name}" requires ${e.minParticipants}–${e.maxParticipants} members (you added ${memberCount}).`,
    );
}

export function normaliseName(name) {
  return String(name).toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

export function duplicateMemberProblems(members) {
  const problems = [];
  const seenIdentity = new Map();
  const seenPhone = new Map();
  members.forEach((member, index) => {
    const dob = member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().slice(0, 10) : '';
    const key = `${normaliseName(member.fullName)}|${dob}`;
    if (seenIdentity.has(key)) {
      problems.push(`Member ${index + 1} (${member.fullName}) duplicates member ${seenIdentity.get(key) + 1}.`);
    } else {
      seenIdentity.set(key, index);
    }
    if (member.contactNumber) {
      if (seenPhone.has(member.contactNumber)) {
        problems.push(`Member ${index + 1} uses the same contact number as member ${seenPhone.get(member.contactNumber) + 1}.`);
      } else {
        seenPhone.set(member.contactNumber, index);
      }
    }
  });
  return problems;
}
