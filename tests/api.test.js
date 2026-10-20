import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { FIXTURE_DIR, JPEG, NOT_AN_IMAGE, PNG, setup, submit } from './helpers.js';

let ctx;
let models;
let categories;
let events;
let admin;
let adminToken;

const key = () => crypto.randomUUID();
const byName = (name, gender) => events.find((e) => e.name === name && (!gender || e.gender === gender));

before(async () => {
  ctx = await setup();
  const { seedBase, seedDevelopmentAdmin } = await import('../src/services/seed.js');
  const { importCompetitionItems } = await import('../src/services/competitionImport.js');
  models = {
    CompetitionItem: (await import('../src/models/CompetitionItem.js')).CompetitionItem,
    Registration: (await import('../src/models/Registration.js')).Registration,
    ExportLog: (await import('../src/models/ExportLog.js')).ExportLog,
    Setting: (await import('../src/models/Setting.js')).Setting,
  };
  await seedBase();
  await seedDevelopmentAdmin();
  await importCompetitionItems({ dir: FIXTURE_DIR });

  admin = ctx.agent();
  adminToken = await admin.csrf();
  const login = await admin.post('/api/auth/login').set('x-csrf-token', adminToken).send({ email: 'a@gmail.com', password: '12345' });
  assert.equal(login.status, 200);
});

after(async () => {
  await ctx.mongoose.connection.dropDatabase();
  await ctx.mongoose.disconnect();
});

describe('competition import', () => {
  test('imports every fixture record once and preserves mapped fields', async () => {
    const all = await models.CompetitionItem.find().lean();
    assert.equal(all.length, 12, 'unique fixture events');
    const sprint = all.find((e) => e.legacyEventId === 9001);
    assert.equal(sprint.name, 'TEST 100m Sprint');
    assert.equal(sprint.gender, 'male');
    assert.equal(sprint.ageDivision, 'Junior');
    assert.equal(sprint.participationMode, 'individual');
    assert.deepEqual(sprint.eventLevels, ['Panchayat', 'Block', 'District']);
    assert.equal(sprint.legacy.subCategoryId, 31);
    assert.equal(sprint.legacy.raw.event_name, 'TEST 100m Sprint');
    assert.ok(sprint.startsFrom instanceof Date);

    const thiruvathira = all.find((e) => e.legacyEventId === 9102);
    assert.equal(thiruvathira.participationMode, 'group');
    assert.equal(thiruvathira.minParticipants, 3);
    assert.equal(thiruvathira.maxParticipants, 5);
    assert.equal(thiruvathira.legacy.subCategoryName, 'TEST Dance');

    const football = all.find((e) => e.legacyEventId === 9201);
    assert.equal(football.isGroupEvent, true);
    assert.equal(football.maxParticipants, 4);

    assert.equal(all.find((e) => e.legacyEventId === 9007).isActive, false);
    assert.equal(all.find((e) => e.legacyEventId === 9006).isRelay, true);
  });

  test('re-running the import creates no duplicates', async () => {
    const { importCompetitionItems } = await import('../src/services/competitionImport.js');
    const report = await importCompetitionItems({ dir: FIXTURE_DIR });
    assert.equal(report.created, 0);
    assert.equal(await models.CompetitionItem.countDocuments(), 12);
    const arts = report.files.find((f) => f.fileName === 'Arts Categories.json');
    assert.deepEqual(arts.emptyCategories, ['TEST Empty Category']);
  });
});

describe('public API', () => {
  test('lists the two main categories with active event counts', async () => {
    const res = await ctx.agent().get('/api/categories');
    assert.equal(res.status, 200);
    categories = Object.fromEntries(res.body.map((c) => [c.slug, c]));
    assert.deepEqual(Object.keys(categories).sort(), ['arts', 'sports']);
    assert.equal(categories.sports.activeEvents.individual, 6);
    assert.equal(categories.sports.activeEvents.group, 1);
    assert.equal(categories.arts.activeEvents.group, 2);
  });

  test('competitions are filtered by mode and hide inactive items', async () => {
    const a = ctx.agent();
    const ind = await a.get(`/api/competitions?categoryId=${categories.sports._id}&mode=individual`);
    assert.equal(ind.status, 200);
    assert.ok(ind.body.every((e) => e.participationMode === 'individual' && e.status === 'active'));
    assert.ok(!ind.body.some((e) => e.name.includes('Discontinued')));
    assert.ok(!('legacy' in ind.body[0]) || !ind.body[0].legacy?.raw);
    const sportsGroup = await a.get(`/api/competitions?categoryId=${categories.sports._id}&mode=group`);
    const artsInd = await a.get(`/api/competitions?categoryId=${categories.arts._id}&mode=individual`);
    const artsGroup = await a.get(`/api/competitions?categoryId=${categories.arts._id}&mode=group`);
    events = [...ind.body, ...sportsGroup.body, ...artsInd.body, ...artsGroup.body];
    const bad = await a.get('/api/competitions?categoryId=nope&mode=individual');
    assert.equal(bad.status, 400);
  });
});

function individual(overrides = {}) {
  return {
    submissionKey: key(),
    mode: 'individual',
    categoryId: categories.sports._id,
    selectedEventIds: [byName('TEST 100m Sprint', 'male')._id],
    consent: true,
    participant: { fullName: 'Arjun Kumar', contactNumber: '9876543210', gender: 'male', dateOfBirth: '2004-05-01' },
    ...overrides,
  };
}

describe('individual registration', () => {
  test('rejects requests without a CSRF token', async () => {
    const a = ctx.agent();
    const res = await a.post('/api/registrations').field('data', JSON.stringify(individual())).attach('participantPhoto', PNG, 'p.png');
    assert.equal(res.status, 403);
  });

  test('registers a participant and returns a registration ID', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const res = await submit(a, token, individual({ participant: { fullName: 'Arjun Kumar', contactNumber: '+91 98765 43210', gender: 'male', dateOfBirth: '2004-05-01' } }), { participantPhoto: PNG });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.registration.registrationId, /^VKC-\d{4}-I-\d{5}$/);
    assert.equal(res.body.registration.events[0].displayEventId, '9001');
    const saved = await models.Registration.findOne({ registrationId: res.body.registration.registrationId }).lean();
    assert.equal(saved.participant.contactNumber, '9876543210');
    assert.equal(saved.participant.photo.encrypted, true);
  });

  test('a repeated submission with the same key is idempotent', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const data = individual({ participant: { fullName: 'Meera Nair', contactNumber: '9123456780', gender: 'female' }, selectedEventIds: [byName('TEST 100m Sprint', 'female')._id] });
    const first = await submit(a, token, data, { participantPhoto: JPEG });
    const second = await submit(a, token, data, { participantPhoto: JPEG });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.registration.registrationId, first.body.registration.registrationId);
  });

  test('blocks registering the same participant for the same event twice', async () => {
    const a = ctx.agent();
    const res = await submit(a, await a.csrf(), individual(), { participantPhoto: PNG });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /already registered/);
  });

  test('enforces gender eligibility', async () => {
    const a = ctx.agent();
    const res = await submit(a, await a.csrf(), individual({ participant: { fullName: 'Anu', contactNumber: '9000000001', gender: 'female' } }), { participantPhoto: PNG });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /not eligible/);
  });

  test('validates phone numbers, photos and file types', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const badPhone = await submit(a, token, individual({ participant: { fullName: 'Rahul', contactNumber: '12345', gender: 'male' } }), { participantPhoto: PNG });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.body.message, /mobile/);
    const noPhoto = await submit(a, token, individual({ participant: { fullName: 'Rahul', contactNumber: '9000000002', gender: 'male' } }));
    assert.equal(noPhoto.status, 400);
    assert.match(noPhoto.body.message, /photo/);
    const fakeImage = await a
      .post('/api/registrations')
      .set('x-csrf-token', token)
      .field('data', JSON.stringify(individual({ participant: { fullName: 'Rahul', contactNumber: '9000000002', gender: 'male' } })))
      .attach('participantPhoto', NOT_AN_IMAGE, { filename: 'photo.png', contentType: 'image/png' });
    assert.equal(fakeImage.status, 400);
    assert.match(fakeImage.body.message, /JPG or PNG/);
    const noConsent = await submit(a, token, { ...individual(), consent: false }, { participantPhoto: PNG });
    assert.equal(noConsent.status, 400);
  });

  test('rejects mismatched mode or category', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const wrongMode = await submit(a, token, individual({ selectedEventIds: [byName('TEST Football')._id], participant: { fullName: 'Vishnu', contactNumber: '9000000003', gender: 'male' } }), { participantPhoto: PNG });
    assert.equal(wrongMode.status, 400);
    const wrongCategory = await submit(a, token, individual({ categoryId: categories.arts._id, participant: { fullName: 'Vishnu', contactNumber: '9000000003', gender: 'male' } }), { participantPhoto: PNG });
    assert.equal(wrongCategory.status, 400);
  });

  test('enforces the event limit and the admin-confirmed relay allowance', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const four = ['TEST Long Jump', 'TEST Shot Put', 'TEST 400m Run', 'TEST 4x100m Relay'].map((n) => byName(n)._id);
    const person = { fullName: 'Kiran Das', contactNumber: '9000000004', gender: 'male' };
    const overLimit = await submit(a, token, individual({ selectedEventIds: four, participant: person }), { participantPhoto: PNG });
    assert.equal(overLimit.status, 400);
    assert.match(overLimit.body.message, /at most 3/);

    await models.Setting.updateOne({ key: 'app' }, { relayAllowanceConfirmed: true, relayAllowance: 1 });
    const withRelay = await submit(a, token, individual({ selectedEventIds: four, participant: person }), { participantPhoto: PNG });
    assert.equal(withRelay.status, 201, JSON.stringify(withRelay.body));

    const another = await submit(a, token, individual({ selectedEventIds: [byName('TEST 100m Sprint', 'male')._id], participant: person }), { participantPhoto: PNG });
    assert.equal(another.status, 400, 'limit counts earlier registrations of the same person');
    await models.Setting.updateOne({ key: 'app' }, { relayAllowanceConfirmed: false });
  });

  test('enforces age limits only when configured', async () => {
    const sprint = byName('TEST 100m Sprint', 'female');
    await models.CompetitionItem.updateOne({ _id: sprint._id }, { minAge: 15, maxAge: 18 });
    await models.Setting.updateOne({ key: 'app' }, { ageReferenceDate: new Date('2026-12-31T00:00:00Z') });
    const a = ctx.agent();
    const token = await a.csrf();
    const base = { selectedEventIds: [sprint._id] };
    const noDob = await submit(a, token, individual({ ...base, participant: { fullName: 'Diya', contactNumber: '9000000005', gender: 'female' } }), { participantPhoto: PNG });
    assert.match(noDob.body.message, /Date of birth/);
    const tooOld = await submit(a, token, individual({ ...base, participant: { fullName: 'Diya', contactNumber: '9000000005', gender: 'female', dateOfBirth: '2000-01-01' } }), { participantPhoto: PNG });
    assert.match(tooOld.body.message, /at most 18/);
    const ok = await submit(a, token, individual({ ...base, participant: { fullName: 'Diya', contactNumber: '9000000005', gender: 'female', dateOfBirth: '2010-06-01' } }), { participantPhoto: PNG });
    assert.equal(ok.status, 201);
    await models.CompetitionItem.updateOne({ _id: sprint._id }, { minAge: null, maxAge: null });
  });

  test('never stores the plaintext Aadhaar number', async () => {
    await models.Setting.updateOne({ key: 'app' }, { collectAadhaar: true });
    const a = ctx.agent();
    const token = await a.csrf();
    const invalid = await submit(a, token, individual({ selectedEventIds: [byName('TEST Elocution')._id], categoryId: categories.arts._id, participant: { fullName: 'Lekha', contactNumber: '9000000006', gender: 'female', aadhaarNumber: '123412341234' } }), { participantPhoto: PNG });
    assert.equal(invalid.status, 400);
    const aadhaar = '234123412346';
    const res = await submit(a, token, individual({ selectedEventIds: [byName('TEST Elocution')._id], categoryId: categories.arts._id, participant: { fullName: 'Lekha', contactNumber: '9000000006', gender: 'female', aadhaarNumber: aadhaar } }), { participantPhoto: PNG });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const raw = await ctx.mongoose.connection.db.collection('registrations').findOne({ registrationId: res.body.registration.registrationId });
    assert.ok(!JSON.stringify(raw).includes(aadhaar));
    assert.equal(raw.participant.aadhaarLast4, '2346');
    await models.Setting.updateOne({ key: 'app' }, { collectAadhaar: false });
  });
});

function group(overrides = {}) {
  return {
    submissionKey: key(),
    mode: 'group',
    categoryId: categories.arts._id,
    selectedEventIds: [byName('TEST Thiruvathira തിരുവാതിര')._id],
    consent: true,
    team: {
      teamName: 'Variayan Stars',
      teamLeaderName: 'Lakshmi Menon',
      contactNumber: '9447000001',
      members: [
        { fullName: 'Lakshmi Menon', gender: 'female', dateOfBirth: '2001-01-01' },
        { fullName: 'Sneha P', gender: 'female' },
        { fullName: 'Fathima K', gender: 'female', contactNumber: '9447000002' },
      ],
    },
    ...overrides,
  };
}
const photos = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`memberPhoto_${i}`, PNG]));

describe('group registration', () => {
  test('registers a team with member photos', async () => {
    const a = ctx.agent();
    const res = await submit(a, await a.csrf(), group(), photos(3));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.registration.registrationId, /^VKC-\d{4}-G-\d{5}$/);
    assert.equal(res.body.registration.memberCount, 3);
  });

  test('enforces min/max participants per selected event', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const small = group({ team: { ...group().team, teamName: 'Small Team', members: group().team.members.slice(0, 2) } });
    const res = await submit(a, token, small, photos(2));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /requires 3–5 members/);
    const both = group({ selectedEventIds: [byName('TEST Thiruvathira തിരുവാതിര')._id, byName('TEST Drama')._id], team: { ...group().team, teamName: 'Both Team' } });
    const tooMany = await submit(a, token, { ...both, team: { ...both.team, members: [...both.team.members, { fullName: 'Ammu', gender: 'female' }, { fullName: 'Devi', gender: 'female' }] } }, photos(5));
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.message, /Drama/);
  });

  test('checks gender for every member and prevents duplicate members', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const mixed = group({ team: { ...group().team, teamName: 'Mixed', members: [...group().team.members.slice(0, 2), { fullName: 'Rahul', gender: 'male' }] } });
    const genderRes = await submit(a, token, mixed, photos(3));
    assert.equal(genderRes.status, 400);
    assert.match(genderRes.body.message, /Member 3 .* not eligible/);
    const dup = group({ team: { ...group().team, teamName: 'Dup', members: [...group().team.members.slice(0, 2), { fullName: 'sneha  p', gender: 'female' }] } });
    const dupRes = await submit(a, token, dup, photos(3));
    assert.equal(dupRes.status, 400);
    assert.match(dupRes.body.message, /duplicates member 2/);
  });

  test('requires a photo for every member', async () => {
    const a = ctx.agent();
    const res = await submit(a, await a.csrf(), group({ team: { ...group().team, teamName: 'No Photos' } }), photos(2));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /member 3/);
  });
});

describe('admin authentication', () => {
  test('protects admin endpoints', async () => {
    const res = await ctx.agent().get('/api/admin/dashboard');
    assert.equal(res.status, 401);
  });

  test('rejects wrong credentials and sets an HttpOnly cookie on success', async () => {
    const a = ctx.agent();
    const token = await a.csrf();
    const wrong = await a.post('/api/auth/login').set('x-csrf-token', token).send({ email: 'a@gmail.com', password: 'wrong' });
    assert.equal(wrong.status, 401);
    const ok = await a.post('/api/auth/login').set('x-csrf-token', token).send({ email: 'a@gmail.com', password: '12345' });
    assert.equal(ok.status, 200);
    const cookie = ok.headers['set-cookie'].find((c) => c.startsWith('vkc_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(ok.body.admin.mustChangePassword, true);
    assert.ok(!JSON.stringify(ok.body).includes('passwordHash'));
    const me = await a.get('/api/auth/me');
    assert.equal(me.body.admin.email, 'a@gmail.com');
    await a.post('/api/auth/logout').set('x-csrf-token', token);
    assert.equal((await a.get('/api/auth/me')).status, 401);
  });

  test('requires a strong new password', async () => {
    const weak = await admin.post('/api/auth/change-password').set('x-csrf-token', adminToken).send({ currentPassword: '12345', newPassword: 'password' });
    assert.equal(weak.status, 400);
  });
});

describe('admin competition management', () => {
  let created;
  test('adds, edits and lists competition items', async () => {
    const res = await admin.post('/api/admin/competitions').set('x-csrf-token', adminToken).send({
      name: 'TEST Chenda Melam', categoryId: categories.arts._id, participationMode: 'group', gender: 'any',
      minParticipants: 2, maxParticipants: 8, description: 'Percussion ensemble', rules: '', ageDivision: '', status: 'active',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created = res.body;
    assert.match(created.eventCode, /^VK-\d{4}$/);
    const bad = await admin.post('/api/admin/competitions').set('x-csrf-token', adminToken).send({ ...res.body, participationMode: 'individual', maxParticipants: 3, _id: undefined });
    assert.equal(bad.status, 400);
    const edit = await admin.put(`/api/admin/competitions/${created._id}`).set('x-csrf-token', adminToken).send({
      name: 'TEST Chenda Melam', categoryId: categories.arts._id, participationMode: 'group', gender: 'any', minParticipants: 3, maxParticipants: 10, status: 'active',
    });
    assert.equal(edit.body.maxParticipants, 10);
    const list = await admin.get(`/api/admin/competitions?categoryId=${categories.arts._id}&mode=group`);
    assert.ok(list.body.some((i) => i._id === created._id));
  });

  test('deactivate hides the item publicly; archive keeps history', async () => {
    const off = await admin.patch(`/api/admin/competitions/${created._id}/status`).set('x-csrf-token', adminToken).send({ action: 'deactivate' });
    assert.equal(off.body.status, 'inactive');
    const pub = await ctx.agent().get(`/api/competitions?categoryId=${categories.arts._id}&mode=group`);
    assert.ok(!pub.body.some((i) => i._id === created._id));
    const archived = await admin.patch(`/api/admin/competitions/${created._id}/status`).set('x-csrf-token', adminToken).send({ action: 'archive' });
    assert.equal(archived.body.status, 'archived');
    const restored = await admin.patch(`/api/admin/competitions/${created._id}/status`).set('x-csrf-token', adminToken).send({ action: 'restore' });
    assert.equal(restored.body.status, 'inactive');
  });

  test('prevents unsafe deletion', async () => {
    const used = byName('TEST Thiruvathira തിരുവാതിര');
    const res = await admin.delete(`/api/admin/competitions/${used._id}`).set('x-csrf-token', adminToken);
    assert.equal(res.status, 409);
    const del = await admin.delete(`/api/admin/competitions/${created._id}`).set('x-csrf-token', adminToken);
    assert.equal(del.status, 200);
  });

  test('admin mutations require CSRF', async () => {
    const res = await admin.patch(`/api/admin/competitions/${byName('TEST Drama')._id}/status`).send({ action: 'deactivate' });
    assert.equal(res.status, 403);
  });
});

describe('admin registrations, dashboard and exports', () => {
  test('dashboard statistics match the database', async () => {
    const res = await admin.get('/api/admin/dashboard');
    assert.equal(res.status, 200);
    const total = await models.Registration.countDocuments();
    assert.equal(res.body.stats.totalRegistrations, total);
    assert.equal(res.body.stats.individualRegistrations + res.body.stats.groupRegistrations, total);
    assert.equal(res.body.stats.artsRegistrations + res.body.stats.sportsRegistrations, total);
    assert.equal(res.body.stats.totalActiveEvents, await models.CompetitionItem.countDocuments({ isActive: true, archivedAt: null }));
  });

  test('lists, filters, searches and views registrations', async () => {
    const ind = await admin.get('/api/admin/registrations?mode=individual&limit=2');
    assert.equal(ind.body.items.length, 2);
    assert.ok(ind.body.pages >= 2);
    const search = await admin.get('/api/admin/registrations?q=Variayan');
    assert.equal(search.body.items.length, 1);
    const byEvent = await admin.get(`/api/admin/registrations?eventId=${byName('TEST 100m Sprint', 'male')._id}`);
    assert.equal(byEvent.body.total, 1);
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const byDate = await admin.get(`/api/admin/registrations?from=${today}&to=${today}`);
    assert.equal(byDate.body.total, await models.Registration.countDocuments());
    const injection = await admin.get('/api/admin/registrations?mode[$ne]=x');
    assert.equal(injection.body.total, await models.Registration.countDocuments(), 'operator keys are never interpreted');
    const pollution = await admin.get('/api/admin/registrations?mode=individual&mode=group');
    assert.equal(pollution.status, 400);
    const detail = await admin.get(`/api/admin/registrations/${search.body.items[0].registrationId}`);
    assert.equal(detail.body.team.members.length, 3);
    assert.ok(!detail.body.team.members[0].photo.storedName);
    const photo = await admin.get(`/api/admin/registrations/${detail.body._id}/files/member-1`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers['content-type'], 'image/png');
    assert.deepEqual(Buffer.from(photo.body), PNG);
  });

  test('exports Excel workbooks from real records', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const res = await admin.get('/api/admin/registrations/export?format=xlsx').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const names = wb.worksheets.map((w) => w.name);
    assert.deepEqual(names, ['Individual Registrations', 'Group Registrations', 'Group Members', 'Competition Items', 'Export Info']);
    const ind = wb.getWorksheet('Individual Registrations');
    const regs = await models.Registration.find({ mode: 'individual' }).lean();
    assert.equal(ind.rowCount - 1, regs.reduce((n, r) => n + r.events.length, 0), 'one row per participant-event');
    assert.equal(ind.getRow(1).getCell(1).value, 'Registration ID');
    assert.ok(ind.getRow(2).getCell(8).value instanceof Date);
    assert.equal(ind.views[0].state, 'frozen');
    assert.ok(ind.autoFilter);
    const members = wb.getWorksheet('Group Members');
    assert.equal(members.rowCount - 1, 3);
    assert.equal(wb.getWorksheet('Competition Items').rowCount - 1, await models.CompetitionItem.countDocuments());
    const firstRow = ind.getRow(2).values.join('|');
    assert.ok(!/aadhaar/i.test(firstRow));
  });

  test('exports PDFs (including Malayalam and event-wise view) and audits exports', async () => {
    const binary = (r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const before = await models.ExportLog.countDocuments();
    const pdf = await admin.get(`/api/admin/registrations/export?format=pdf&categoryId=${categories.arts._id}`).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    const eventWise = await admin.get('/api/admin/registrations/export?format=pdf&view=events&mode=group').buffer(true).parse(binary);
    assert.equal(eventWise.status, 200);
    assert.equal(await models.ExportLog.countDocuments(), before + 2);
    const anon = await ctx.agent().get('/api/admin/registrations/export?format=pdf');
    assert.equal(anon.status, 401);
  });

  test('deleting a registration removes it and its files', async () => {
    const reg = await models.Registration.findOne({ mode: 'individual' });
    const res = await admin.delete(`/api/admin/registrations/${reg.registrationId}`).set('x-csrf-token', adminToken);
    assert.equal(res.status, 200);
    assert.equal(await models.Registration.countDocuments({ _id: reg._id }), 0);
  });
});
