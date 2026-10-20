import { Category } from '../models/Category.js';
import { CompetitionItem } from '../models/CompetitionItem.js';
import { Registration } from '../models/Registration.js';
import { buildRegistrationFilter } from './registrationQuery.js';

export const MODE_LABEL = { individual: 'Individual', group: 'Group' };
export const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other', any: 'Open' };

/**
 * Loads everything an export needs straight from MongoDB. Rows are flattened to one row per
 * participant-event / team-event (and member-event) relationship. When an event filter is
 * applied, only that event's relationship rows are emitted.
 */
export async function loadExportData(filters) {
  const query = buildRegistrationFilter(filters);
  const itemQuery = {};
  if (filters.categoryId) itemQuery.categoryId = filters.categoryId;
  if (filters.mode) itemQuery.participationMode = filters.mode;
  if (filters.eventId) itemQuery._id = filters.eventId;
  const [registrations, categories, competitionItems] = await Promise.all([
    Registration.find(query).sort({ createdAt: 1, registrationId: 1 }).lean(),
    Category.find().lean(),
    CompetitionItem.find(itemQuery).sort({ categoryId: 1, participationMode: 1, name: 1 }).lean(),
  ]);
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
  const eventFilter = filters.eventId ? String(filters.eventId) : null;
  const eventsOf = (r) => r.events.filter((e) => !eventFilter || String(e.eventId) === eventFilter);

  const individualRows = [];
  const groupRows = [];
  const memberRows = [];
  for (const r of registrations) {
    const category = categoryName.get(String(r.categoryId)) ?? '';
    for (const event of eventsOf(r)) {
      if (r.mode === 'individual') {
        individualRows.push({
          registrationId: r.registrationId,
          participantName: r.participant.fullName,
          contactNumber: r.participant.contactNumber,
          gender: GENDER_LABEL[r.participant.gender] ?? r.participant.gender,
          category,
          eventId: event.displayEventId,
          eventName: event.name,
          registeredAt: r.createdAt,
        });
      } else {
        groupRows.push({
          registrationId: r.registrationId,
          teamName: r.team.teamName,
          leaderName: r.team.teamLeaderName,
          contactNumber: r.team.contactNumber,
          category,
          eventId: event.displayEventId,
          eventName: event.name,
          memberCount: r.team.members.length,
          registeredAt: r.createdAt,
        });
        for (const member of r.team.members) {
          memberRows.push({
            registrationId: r.registrationId,
            teamName: r.team.teamName,
            memberName: member.fullName,
            gender: GENDER_LABEL[member.gender] ?? member.gender,
            memberNumber: member.memberNumber,
            eventId: event.displayEventId,
            eventName: event.name,
          });
        }
      }
    }
  }

  const items = competitionItems.map((item) => ({
    _id: String(item._id),
    eventId: item.legacyEventId !== undefined && item.legacyEventId !== null ? String(item.legacyEventId) : item.eventCode,
    name: item.name,
    category: categoryName.get(String(item.categoryId)) ?? '',
    mode: MODE_LABEL[item.participationMode],
    gender: GENDER_LABEL[item.gender] ?? item.gender,
    ageDivision: item.ageDivision,
    minParticipants: item.minParticipants,
    maxParticipants: item.maxParticipants,
    status: item.archivedAt ? 'Archived' : item.isActive ? 'Active' : 'Inactive',
  }));

  return {
    registrations,
    categoryName,
    individualRows,
    groupRows,
    memberRows,
    competitionItems: items,
    eventsOf,
    totals: {
      registrations: registrations.length,
      individual: registrations.filter((r) => r.mode === 'individual').length,
      group: registrations.filter((r) => r.mode === 'group').length,
      groupMembers: registrations.reduce((n, r) => n + (r.team?.members.length ?? 0), 0),
      eventEntries: individualRows.length + groupRows.length,
    },
  };
}

export async function describeFilters(filters) {
  const parts = [];
  if (filters.mode) parts.push(['Participation', MODE_LABEL[filters.mode]]);
  if (filters.categoryId) {
    const category = await Category.findById(filters.categoryId).lean();
    parts.push(['Category', category?.name ?? filters.categoryId]);
  }
  if (filters.eventId) {
    const event = await CompetitionItem.findById(filters.eventId).lean();
    const id = event ? (event.legacyEventId ?? event.eventCode) : filters.eventId;
    parts.push(['Competition', event ? `${id} – ${event.name}` : filters.eventId]);
  }
  if (filters.from) parts.push(['From', filters.from]);
  if (filters.to) parts.push(['To', filters.to]);
  if (filters.q) parts.push(['Search', filters.q]);
  return parts;
}

export function reportTitle(filters, filterParts) {
  const mode = filters.mode ? `${MODE_LABEL[filters.mode]} ` : 'All ';
  const category = filterParts.find(([k]) => k === 'Category')?.[1];
  const event = filterParts.find(([k]) => k === 'Competition')?.[1];
  let title = `${mode}${category ? `${category} ` : ''}Registrations`;
  if (event) title = `Event-wise Registrations – ${event}`;
  const extra = filters.from || filters.to || filters.q;
  return extra ? `${title} (Filtered)` : title;
}
