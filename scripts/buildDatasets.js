#!/usr/bin/env node
/**
 * Writes the Keralotsavam JSON datasets consumed by the importer.
 * Event names and grouping follow published Kerala Keralotsavam item lists.
 * Empty event arrays are left empty on purpose.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { SERVER_ROOT } from '../src/config/env.js';

const DIR = path.join(SERVER_ROOT, 'data', 'keralotsavam');
const LEVELS = ['Club', 'Panchayat', 'Block', 'District'];

function ev(id, name, { group = false, min = 1, max = 1, gender = 'Both', age = '', active = true, categoryId, subCategoryId } = {}) {
  return {
    id,
    event_name: name,
    category_id: categoryId,
    sub_category_id: subCategoryId,
    is_group_event: group ? 1 : 0,
    min_allowed_participants: group ? min : 1,
    max_allowed_participants: group ? max : 1,
    gender,
    sub_gender: age,
    is_active: active ? 1 : 0,
    event_levels: LEVELS,
  };
}

function expand(idStart, names, { genders = ['Male', 'Female'], ages = ['Junior', 'Senior'], group = false, min, max, categoryId, subCategoryId } = {}) {
  const events = [];
  let id = idStart;
  for (const name of names) {
    for (const gender of genders) {
      for (const age of ages) {
        events.push(ev(id, name, { group, min, max, gender, age, categoryId, subCategoryId }));
        id += 1;
      }
    }
  }
  return { events, nextId: id };
}

const athleticsTrack = [
  '100m Sprint',
  '200m Sprint',
  '400m Run',
  '800m Run',
  '1500m Run',
  '5000m Run',
  'Long Jump',
  'High Jump',
  'Triple Jump',
  'Shot Put',
  'Discus Throw',
  'Javelin Throw',
];
const athleticsMaleHurdles = ['110m Hurdles'];
const athleticsFemaleHurdles = ['100m Hurdles'];
const athleticsRelays = ['4x100m Relay', '4x400m Relay'];

function athletics() {
  const { events, nextId: a } = expand(101, athleticsTrack, { categoryId: 3, subCategoryId: 31 });
  const male = expand(a, athleticsMaleHurdles, { genders: ['Male'], categoryId: 3, subCategoryId: 31 });
  const female = expand(male.nextId, athleticsFemaleHurdles, { genders: ['Female'], categoryId: 3, subCategoryId: 31 });
  const relays = expand(female.nextId, athleticsRelays, { categoryId: 3, subCategoryId: 31 });
  return {
    status: true,
    message: 'Athletics competition items',
    data: {
      category: { id: 3, name: 'Athletics' },
      sub_category: { id: 31, name: 'Track and Field' },
      events: [...events, ...male.events, ...female.events, ...relays.events],
    },
  };
}

function swimming() {
  const strokes = [
    '50m Freestyle',
    '100m Freestyle',
    '50m Backstroke',
    '50m Breaststroke',
    '50m Butterfly',
    '100m Individual Medley',
  ];
  const { events, nextId } = expand(201, strokes, { categoryId: 4, subCategoryId: 41 });
  const relays = expand(nextId, ['4x50m Freestyle Relay', '4x50m Medley Relay'], { categoryId: 4, subCategoryId: 41 });
  return {
    status: true,
    data: {
      category: { id: 4, name: 'Swimming' },
      events: [...events, ...relays.events],
    },
  };
}

function games() {
  const individual = [
    { name: 'Chess ചതുരംഗം', gender: 'Both' },
    { name: 'Carroms കാരംസ്', gender: 'Both' },
    { name: 'Badminton Singles', gender: 'Male' },
    { name: 'Badminton Singles', gender: 'Female' },
    { name: 'Table Tennis Singles', gender: 'Male' },
    { name: 'Table Tennis Singles', gender: 'Female' },
  ];
  const groupItems = [
    { name: 'Football ഫുട്‌ബോൾ', gender: 'Male', min: 11, max: 16 },
    { name: 'Volleyball വോളിബോൾ', gender: 'Male', min: 6, max: 10 },
    { name: 'Volleyball വോളിബോൾ', gender: 'Female', min: 6, max: 10 },
    { name: 'Basketball ബാസ്ക്കറ്റ്ബോൾ', gender: 'Male', min: 5, max: 10 },
    { name: 'Basketball ബാസ്ക്കറ്റ്ബോൾ', gender: 'Female', min: 5, max: 10 },
    { name: 'Kabaddi കബഡി', gender: 'Male', min: 7, max: 12 },
    { name: 'Kabaddi കബഡി', gender: 'Female', min: 7, max: 12 },
    { name: 'Kho-Kho ഖോ ഖോ', gender: 'Male', min: 9, max: 12 },
    { name: 'Kho-Kho ഖോ ഖോ', gender: 'Female', min: 9, max: 12 },
    { name: 'Cricket ക്രിക്കറ്റ്', gender: 'Male', min: 11, max: 15 },
    { name: 'Throwball ത്രോബോൾ', gender: 'Female', min: 7, max: 10 },
    { name: 'Badminton Doubles', gender: 'Male', min: 2, max: 2 },
    { name: 'Badminton Doubles', gender: 'Female', min: 2, max: 2 },
  ];
  let id = 301;
  const events = [];
  for (const item of individual) {
    for (const age of ['Junior', 'Senior']) {
      events.push(ev(id++, item.name, { gender: item.gender, age, categoryId: 5, subCategoryId: 51 }));
    }
  }
  for (const item of groupItems) {
    events.push(
      ev(id++, item.name, {
        group: true,
        min: item.min,
        max: item.max,
        gender: item.gender,
        age: 'Open',
        categoryId: 5,
        subCategoryId: 52,
      }),
    );
  }
  return {
    data: {
      category: { id: 5, name: 'Games' },
      events,
    },
  };
}

function agriculturalGames() {
  let id = 401;
  const events = [
    ev(id++, 'Coconut Tree Climbing തെങ്ങ് കയറ്റം', { gender: 'Male', age: 'Open', categoryId: 6, subCategoryId: 61 }),
    ev(id++, 'Sack Race ചാക്കോട്ടം', { gender: 'Both', age: 'Open', categoryId: 6, subCategoryId: 61 }),
    ev(id++, 'Tug of War വടംവലി', { group: true, min: 8, max: 12, gender: 'Male', age: 'Open', categoryId: 6, subCategoryId: 62 }),
    ev(id++, 'Tug of War വടംവലി', { group: true, min: 8, max: 12, gender: 'Female', age: 'Open', categoryId: 6, subCategoryId: 62 }),
    ev(id++, 'Traditional Ploughing ഉഴവ്', { group: true, min: 2, max: 4, gender: 'Male', age: 'Open', categoryId: 6, subCategoryId: 62 }),
  ];
  return {
    data: {
      category: { id: 6, name: 'Agricultural Games' },
      events,
    },
  };
}

function kalarippayattu() {
  let id = 501;
  const individual = ['Meypayattu മെയ്‌പയറ്റ്', 'Otta ഓട്ട', 'Gadha ഗദ', 'Churika ചുരിക'];
  const events = [];
  for (const name of individual) {
    events.push(ev(id++, name, { gender: 'Male', age: 'Open', categoryId: 7, subCategoryId: 71 }));
    events.push(ev(id++, name, { gender: 'Female', age: 'Open', categoryId: 7, subCategoryId: 71 }));
  }
  events.push(
    ev(id++, 'Angathari Demonstration അങ്കത്തറ', {
      group: true,
      min: 4,
      max: 8,
      gender: 'Both',
      age: 'Open',
      categoryId: 7,
      subCategoryId: 72,
    }),
  );
  return {
    data: {
      category: { id: 7, name: 'Kalarippayattu' },
      events,
    },
  };
}

function artsCategories() {
  let id = 1001;
  const cat = (cid, name, items) => {
    const events = items.map((item) =>
      ev(id++, item.name, {
        group: Boolean(item.group),
        min: item.min,
        max: item.max,
        gender: item.gender ?? 'Both',
        age: item.age ?? '',
        categoryId: 2,
        subCategoryId: cid,
      }),
    );
    return { id: cid, category_name: name, events };
  };

  return [
    cat(11, 'Dance', [
      { name: 'Mohiniyattam മോഹിനിയാട്ടം', gender: 'Female' },
      { name: 'Bharatanatyam ഭരതനാട്യം', gender: 'Female' },
      { name: 'Folk Dance നാടൻ നൃത്തം' },
      { name: 'Kathakali കഥകളി' },
      { name: 'Ottamthullal ഓട്ടൻതുള്ളൽ' },
      { name: 'Thiruvathira തിരുവാതിര', group: true, min: 8, max: 12, gender: 'Female' },
      { name: 'Oppana ഓപ്പന', group: true, min: 8, max: 12, gender: 'Female' },
      { name: 'Kolkali കോൽക്കളി', group: true, min: 8, max: 16, gender: 'Male' },
      { name: 'Margamkali മാർഗംകളി', group: true, min: 8, max: 12, gender: 'Female' },
      { name: 'Group Folk Dance സംഘ നാടൻ നൃത്തം', group: true, min: 6, max: 12 },
    ]),
    cat(12, 'Music', [
      { name: 'Light Music ലളിതഗാനം', gender: 'Male' },
      { name: 'Light Music ലളിതഗാനം', gender: 'Female' },
      { name: 'Classical Vocal കർണാടക സംഗീതം' },
      { name: 'Mappilappattu മാപ്പിളപ്പാട്ട്' },
      { name: 'Violin വയലിൻ' },
      { name: 'Flute വേണു' },
      { name: 'Tabala തബല' },
      { name: 'Chenda ചെണ്ട' },
      { name: 'Group Song സംഘഗാനം', group: true, min: 4, max: 10 },
    ]),
    cat(13, 'Literary', [
      { name: 'Elocution Malayalam പ്രസംഗം (മലയാളം)' },
      { name: 'Elocution English പ്രസംഗം (ഇംഗ്ലീഷ്)' },
      { name: 'Essay Writing ഉപന്യാസം' },
      { name: 'Poetry Recitation കവിതാപാരായണം' },
      { name: 'Aksharaslokam അക്ഷരശ്ലോകം' },
      { name: 'Quiz ക്വിസ്', group: true, min: 2, max: 3 },
    ]),
    cat(14, 'Theatre', [
      { name: 'Monoact മോണോ ആക്ട്' },
      { name: 'Mimicry അനുകരണം' },
      { name: 'Mime മൂകാഭിനയം' },
      { name: 'One Act Play ഏകാങ്കം', group: true, min: 4, max: 10 },
      { name: 'Skit സ്കിറ്റ്', group: true, min: 3, max: 8 },
    ]),
    cat(15, 'Fine Arts', [
      { name: 'Pencil Drawing പെൻസിൽ വര' },
      { name: 'Painting ചിത്രരചന' },
      { name: 'Cartoon കാർട്ടൂൺ' },
      { name: 'Collage കൊളാഷ്' },
      { name: 'Photography ഫോട്ടോഗ്രഫി' },
    ]),
    { id: 16, category_name: 'Western Music', events: [] },
  ];
}

function sportsCategories() {
  return [
    { id: 3, category_name: 'Athletics', events: [] },
    { id: 4, category_name: 'Swimming', events: [] },
    { id: 5, category_name: 'Games', events: [] },
    { id: 6, category_name: 'Agricultural Games', events: [] },
    { id: 7, category_name: 'Kalarippayattu', events: [] },
  ];
}

const files = {
  'manifest.json': {
    files: {
      'Arts Categories.json': 'arts',
      'Sports Categories.json': 'sports',
      'Athletics.json': 'sports',
      'Swimming.json': 'sports',
      'Games.json': 'sports',
      'Agricultural Games.json': 'sports',
      'Kalarippayattu.json': 'sports',
    },
  },
  'Athletics.json': athletics(),
  'Swimming.json': swimming(),
  'Games.json': games(),
  'Agricultural Games.json': agriculturalGames(),
  'Kalarippayattu.json': kalarippayattu(),
  'Arts Categories.json': artsCategories(),
  'Sports Categories.json': sportsCategories(),
};

async function main() {
  await fs.mkdir(DIR, { recursive: true });
  for (const [name, json] of Object.entries(files)) {
    await fs.writeFile(path.join(DIR, name), `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    console.log(`  wrote ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
