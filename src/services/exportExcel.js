import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
const DATE_FORMAT = 'dd-mmm-yyyy hh:mm';
const MAX_WIDTH = 60;

const SHEETS = {
  individual: {
    name: 'Individual Registrations',
    columns: [
      ['Registration ID', 'registrationId'],
      ['Participant Name', 'participantName'],
      ['Contact Number', 'contactNumber'],
      ['Gender', 'gender'],
      ['Category', 'category'],
      ['Event ID', 'eventId'],
      ['Event Name', 'eventName'],
      ['Registration Date', 'registeredAt', 'date'],
    ],
  },
  group: {
    name: 'Group Registrations',
    columns: [
      ['Registration ID', 'registrationId'],
      ['Team Name', 'teamName'],
      ['Leader Name', 'leaderName'],
      ['Contact Number', 'contactNumber'],
      ['Category', 'category'],
      ['Event ID', 'eventId'],
      ['Event Name', 'eventName'],
      ['Member Count', 'memberCount', 'number'],
      ['Registration Date', 'registeredAt', 'date'],
    ],
  },
  members: {
    name: 'Group Members',
    columns: [
      ['Registration ID', 'registrationId'],
      ['Team Name', 'teamName'],
      ['Member Name', 'memberName'],
      ['Gender', 'gender'],
      ['Member Number', 'memberNumber', 'number'],
      ['Event ID', 'eventId'],
      ['Event Name', 'eventName'],
    ],
  },
  items: {
    name: 'Competition Items',
    columns: [
      ['Event ID', 'eventId'],
      ['Event Name', 'name'],
      ['Category', 'category'],
      ['Participation Mode', 'mode'],
      ['Gender', 'gender'],
      ['Minimum Members', 'minParticipants', 'number'],
      ['Maximum Members', 'maxParticipants', 'number'],
      ['Status', 'status'],
    ],
  },
};

function displayLength(value, type) {
  if (value === null || value === undefined) return 0;
  if (type === 'date') return 17;
  return String(value).length;
}

function addSheet(workbook, { name, columns }, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([header, key, type]) => {
    const longest = Math.max(header.length, ...rows.map((r) => displayLength(r[key], type)));
    return {
      header,
      key,
      width: Math.min(Math.max(longest + 2, 10), MAX_WIDTH),
      style: {
        ...(type === 'date' ? { numFmt: DATE_FORMAT } : {}),
        // Phone numbers and IDs stay text so leading digits/format are preserved exactly.
        ...(type ? {} : { numFmt: '@' }),
        alignment: { vertical: 'top', wrapText: longest + 2 > MAX_WIDTH },
      },
    };
  });
  for (const row of rows) {
    const values = {};
    for (const [, key, type] of columns) {
      const v = row[key];
      values[key] = v === null || v === undefined ? null : type === 'date' ? new Date(v) : type === 'number' ? Number(v) : String(v);
    }
    sheet.addRow(values);
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: false };
  header.height = 22;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

export async function buildExcel(data, { filterParts, title, generatedBy }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Variayan Kunan Club';
  workbook.created = new Date();
  workbook.title = title;

  const includeIndividual = !filterParts.some(([k, v]) => k === 'Participation' && v === 'Group');
  const includeGroup = !filterParts.some(([k, v]) => k === 'Participation' && v === 'Individual');
  if (includeIndividual) addSheet(workbook, SHEETS.individual, data.individualRows);
  if (includeGroup) {
    addSheet(workbook, SHEETS.group, data.groupRows);
    addSheet(workbook, SHEETS.members, data.memberRows);
  }
  addSheet(workbook, SHEETS.items, data.competitionItems);

  const info = workbook.addWorksheet('Export Info');
  info.columns = [
    { header: 'Field', key: 'k', width: 24 },
    { header: 'Value', key: 'v', width: 60 },
  ];
  const infoRows = [
    ['Club', 'Variayan Kunan Club'],
    ['Report', title],
    ['Exported at', new Date()],
    ['Exported by', generatedBy],
    ...(filterParts.length ? filterParts : [['Filters', 'None (all registrations)']]),
    ['Total registrations', data.totals.registrations],
    ['Individual registrations', data.totals.individual],
    ['Group registrations', data.totals.group],
    ['Event entries', data.totals.eventEntries],
    ['Group members', data.totals.groupMembers],
  ];
  infoRows.forEach(([k, v]) => {
    const row = info.addRow({ k, v });
    if (v instanceof Date) row.getCell('v').numFmt = DATE_FORMAT;
    row.getCell('v').alignment = { horizontal: 'left' };
  });
  info.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  info.getRow(1).fill = HEADER_FILL;

  return workbook.xlsx.writeBuffer();
}
