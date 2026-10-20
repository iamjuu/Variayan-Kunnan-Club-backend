import path from 'node:path';
import PDFDocument from 'pdfkit';
import { SERVER_ROOT } from '../config/env.js';
import { GENDER_LABEL, MODE_LABEL } from './exportData.js';

const FONT_DIR = path.join(SERVER_ROOT, 'assets', 'fonts');
const FONTS = {
  latin: path.join(FONT_DIR, 'NotoSans-Regular.ttf'),
  latinBold: path.join(FONT_DIR, 'NotoSans-Bold.ttf'),
  malayalam: path.join(FONT_DIR, 'NotoSansMalayalam-Regular.ttf'),
  malayalamBold: path.join(FONT_DIR, 'NotoSansMalayalam-Bold.ttf'),
};

const COLORS = { primary: '#14532D', accent: '#D4A373', text: '#1F2937', muted: '#6B7280', border: '#D1D5DB', zebra: '#F3F7F4' };
const MARGIN = 36;
const FOOTER_SPACE = 30;
const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;
const MALAYALAM = /[\u0D00-\u0D7F\u200C\u200D]/;

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
export const formatDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');
const formatDate = (d) => (d ? dateFmt.format(new Date(d)) : '');

/* ----------------------------- text layout ----------------------------- */

/** Splits text into runs that share a script so each run can use a font that has its glyphs. */
function scriptRuns(text) {
  const runs = [];
  for (const ch of text) {
    const ml = MALAYALAM.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.ml === ml) last.text += ch;
    else runs.push({ text: ch, ml });
  }
  return runs;
}

function fontFor(ml, bold) {
  if (ml) return bold ? 'ml-bold' : 'ml';
  return bold ? 'latin-bold' : 'latin';
}

function measureSegments(doc, text, size, bold) {
  return scriptRuns(text).map((run) => {
    const font = fontFor(run.ml, bold);
    doc.font(font).fontSize(size);
    return { text: run.text, font, width: doc.widthOfString(run.text) };
  });
}

function splitLongWord(doc, word, size, bold, maxWidth) {
  const pieces = [];
  let current = '';
  for (const ch of word) {
    const candidate = current + ch;
    const width = measureSegments(doc, candidate, size, bold).reduce((n, s) => n + s.width, 0);
    if (width > maxWidth && current) {
      pieces.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Greedy word-wrap that measures each script run with its own font, so wrapping is exact. */
function layoutText(doc, value, maxWidth, { size = 8.5, bold = false } = {}) {
  const lines = [];
  const text = value === null || value === undefined ? '' : String(value);
  for (const paragraph of text.split('\n')) {
    let line = [];
    let lineWidth = 0;
    const tokens = paragraph.split(/(\s+)/).filter((t) => t.length);
    const pushLine = () => {
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) {
        lineWidth -= line.pop().width;
      }
      lines.push(line);
      line = [];
      lineWidth = 0;
    };
    for (const token of tokens) {
      const isSpace = /^\s+$/.test(token);
      if (isSpace && !line.length) continue;
      let segments = measureSegments(doc, isSpace ? ' ' : token, size, bold);
      let width = segments.reduce((n, s) => n + s.width, 0);
      if (!isSpace && width > maxWidth) {
        for (const piece of splitLongWord(doc, token, size, bold, maxWidth)) {
          const pieceSegs = measureSegments(doc, piece, size, bold);
          const pieceWidth = pieceSegs.reduce((n, s) => n + s.width, 0);
          if (lineWidth + pieceWidth > maxWidth && line.length) pushLine();
          line.push(...pieceSegs);
          lineWidth += pieceWidth;
        }
        continue;
      }
      if (lineWidth + width > maxWidth && line.length) {
        pushLine();
        if (isSpace) continue;
        segments = measureSegments(doc, token, size, bold);
        width = segments.reduce((n, s) => n + s.width, 0);
      }
      line.push(...segments);
      lineWidth += width;
    }
    pushLine();
  }
  return lines;
}

const lineHeightFor = (size) => size * 1.55;

function drawLines(doc, lines, x, y, { size = 8.5, color = COLORS.text, align = 'left', width } = {}) {
  const lh = lineHeightFor(size);
  lines.forEach((line, i) => {
    const lineWidth = line.reduce((n, s) => n + s.width, 0);
    let cx = align === 'right' && width ? x + width - lineWidth : align === 'center' && width ? x + (width - lineWidth) / 2 : x;
    const baseline = y + i * lh + size * 1.15;
    for (const seg of line) {
      doc.font(seg.font).fontSize(size).fillColor(color).text(seg.text, cx, baseline, { lineBreak: false, baseline: 'alphabetic' });
      cx += seg.width;
    }
  });
  return lines.length * lh;
}

function writeBlock(doc, text, { size = 9, bold = false, color = COLORS.text, gapAfter = 4, width } = {}) {
  const w = width ?? doc.page.width - MARGIN * 2;
  const lines = layoutText(doc, text, w, { size, bold });
  const h = lines.length * lineHeightFor(size);
  ensureSpace(doc, h);
  drawLines(doc, lines, MARGIN, doc.y, { size, color });
  doc.y += h + gapAfter;
}

/* ----------------------------- page helpers ---------------------------- */

const bottomLimit = (doc) => doc.page.height - MARGIN - FOOTER_SPACE;

function ensureSpace(doc, height, onNewPage) {
  if (doc.y + height > bottomLimit(doc)) {
    doc.addPage();
    onNewPage?.();
    return true;
  }
  return false;
}

function drawRunningHeader(doc, title) {
  const width = doc.page.width - MARGIN * 2;
  doc.save();
  const lines = layoutText(doc, `Variayan Kunan Club  ·  ${title}`, width, { size: 8, bold: true });
  drawLines(doc, lines.slice(0, 1), MARGIN, MARGIN - 14, { size: 8, color: COLORS.primary });
  doc.moveTo(MARGIN, MARGIN + 4).lineTo(MARGIN + width, MARGIN + 4).lineWidth(0.6).strokeColor(COLORS.accent).stroke();
  doc.restore();
  doc.y = MARGIN + 14;
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  const exportedAt = formatDateTime(new Date());
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN - 6;
    const width = doc.page.width - MARGIN * 2;
    doc.moveTo(MARGIN, y - 6).lineTo(MARGIN + width, y - 6).lineWidth(0.5).strokeColor(COLORS.border).stroke();
    drawLines(doc, layoutText(doc, `Variayan Kunan Club · Keralotsavam · Exported ${exportedAt}`, width / 2, { size: 7.5 }), MARGIN, y, { size: 7.5, color: COLORS.muted });
    const label = `Page ${i + 1 - range.start} of ${range.count}`;
    drawLines(doc, layoutText(doc, label, width / 2, { size: 7.5 }), MARGIN + width / 2, y, { size: 7.5, color: COLORS.muted, align: 'right', width: width / 2 });
    doc.page.margins.bottom = originalBottom;
  }
}

/* -------------------------------- table -------------------------------- */

function drawTable(doc, { columns, rows, onNewPage, size = 8.3 }) {
  const totalWidth = doc.page.width - MARGIN * 2;
  const totalWeight = columns.reduce((n, c) => n + c.weight, 0);
  const widths = columns.map((c) => (c.weight / totalWeight) * totalWidth);
  const xs = widths.reduce((acc, w, i) => [...acc, acc[i] + w], [MARGIN]);

  const measureRow = (cells, bold) => {
    const laid = cells.map((cell, i) => layoutText(doc, cell, widths[i] - CELL_PAD_X * 2, { size, bold }));
    const height = Math.max(...laid.map((l) => l.length * lineHeightFor(size))) + CELL_PAD_Y * 2;
    return { laid, height };
  };

  const header = measureRow(
    columns.map((c) => c.header),
    true,
  );
  const drawHeader = () => {
    doc.rect(MARGIN, doc.y, totalWidth, header.height).fill(COLORS.primary);
    header.laid.forEach((lines, i) =>
      drawLines(doc, lines, xs[i] + CELL_PAD_X, doc.y + CELL_PAD_Y, { size, color: '#FFFFFF', align: columns[i].align, width: widths[i] - CELL_PAD_X * 2 }),
    );
    doc.y += header.height;
  };
  const newPage = () => {
    doc.addPage();
    onNewPage?.();
    drawHeader();
  };

  if (doc.y + header.height + lineHeightFor(size) * 2 > bottomLimit(doc)) {
    doc.addPage();
    onNewPage?.();
  }
  drawHeader();

  if (!rows.length) {
    const empty = measureRow(['No records match the selected filters.'], false);
    doc.rect(MARGIN, doc.y, totalWidth, empty.height).lineWidth(0.4).strokeColor(COLORS.border).stroke();
    drawLines(doc, layoutText(doc, 'No records match the selected filters.', totalWidth - 10, { size }), MARGIN + CELL_PAD_X, doc.y + CELL_PAD_Y, { size, color: COLORS.muted });
    doc.y += empty.height + 10;
    return;
  }

  rows.forEach((cells, rowIndex) => {
    const row = measureRow(cells, false);
    if (doc.y + row.height > bottomLimit(doc)) newPage();
    if (rowIndex % 2 === 1) doc.rect(MARGIN, doc.y, totalWidth, row.height).fill(COLORS.zebra);
    doc.rect(MARGIN, doc.y, totalWidth, row.height).lineWidth(0.4).strokeColor(COLORS.border).stroke();
    row.laid.forEach((lines, i) =>
      drawLines(doc, lines, xs[i] + CELL_PAD_X, doc.y + CELL_PAD_Y, { size, align: columns[i].align, width: widths[i] - CELL_PAD_X * 2 }),
    );
    doc.y += row.height;
  });
  doc.y += 12;
}

function sectionHeading(doc, text, onNewPage) {
  ensureSpace(doc, 60, onNewPage);
  writeBlock(doc, text, { size: 12, bold: true, color: COLORS.primary, gapAfter: 2 });
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + 60, doc.y).lineWidth(1.5).strokeColor(COLORS.accent).stroke();
  doc.y += 8;
}

/* -------------------------------- report ------------------------------- */

function drawCoverHeader(doc, { title, filterParts, generatedBy }) {
  const width = doc.page.width - MARGIN * 2;
  doc.rect(0, 0, doc.page.width, 6).fill(COLORS.primary);
  doc.rect(0, 6, doc.page.width, 2).fill(COLORS.accent);
  doc.y = MARGIN;
  writeBlock(doc, 'Variayan Kunan Club', { size: 20, bold: true, color: COLORS.primary, gapAfter: 0 });
  writeBlock(doc, 'Keralotsavam Registration & Management System', { size: 9.5, color: COLORS.muted, gapAfter: 8 });
  writeBlock(doc, title, { size: 14, bold: true, gapAfter: 4 });
  writeBlock(doc, `Export date: ${formatDateTime(new Date())}    Exported by: ${generatedBy}`, { size: 8.5, color: COLORS.muted, gapAfter: 2 });
  const filters = filterParts.length ? filterParts.map(([k, v]) => `${k}: ${v}`).join('   |   ') : 'None (all registrations)';
  writeBlock(doc, `Applied filters: ${filters}`, { size: 8.5, color: COLORS.muted, gapAfter: 10, width });
}

function drawTotals(doc, totals) {
  const cards = [
    ['Registrations', totals.registrations],
    ['Individual', totals.individual],
    ['Group', totals.group],
    ['Event entries', totals.eventEntries],
    ['Group members', totals.groupMembers],
  ];
  const width = doc.page.width - MARGIN * 2;
  const gap = 8;
  const cardWidth = (width - gap * (cards.length - 1)) / cards.length;
  const height = 42;
  ensureSpace(doc, height + 10);
  cards.forEach(([label, value], i) => {
    const x = MARGIN + i * (cardWidth + gap);
    doc.roundedRect(x, doc.y, cardWidth, height, 4).fillAndStroke('#FFFFFF', COLORS.border);
    doc.rect(x, doc.y, 3, height).fill(COLORS.accent);
    drawLines(doc, layoutText(doc, String(value), cardWidth - 16, { size: 14, bold: true }), x + 10, doc.y + 3, { size: 14, color: COLORS.primary });
    drawLines(doc, layoutText(doc, label, cardWidth - 16, { size: 7.5 }), x + 10, doc.y + 25, { size: 7.5, color: COLORS.muted });
  });
  doc.y += height + 16;
}

const eventsCell = (events) => events.map((e) => `${e.displayEventId} – ${e.name}`).join('\n');

function registrationsView(doc, data, onNewPage) {
  const categoryOf = (r) => data.categoryName.get(String(r.categoryId)) ?? '';
  const individual = data.registrations.filter((r) => r.mode === 'individual' && data.eventsOf(r).length);
  const group = data.registrations.filter((r) => r.mode === 'group' && data.eventsOf(r).length);

  if (individual.length || !group.length) {
    sectionHeading(doc, `Individual Registrations (${individual.length})`, onNewPage);
    drawTable(doc, {
      onNewPage,
      columns: [
        { header: 'Registration ID', weight: 14 },
        { header: 'Participant Name', weight: 17 },
        { header: 'Contact Number', weight: 11 },
        { header: 'Gender', weight: 7 },
        { header: 'Category', weight: 8 },
        { header: 'Competition Items (Event ID – Name)', weight: 29 },
        { header: 'Registered On', weight: 14 },
      ],
      rows: individual.map((r) => [
        r.registrationId,
        r.participant.fullName,
        r.participant.contactNumber,
        GENDER_LABEL[r.participant.gender],
        categoryOf(r),
        eventsCell(data.eventsOf(r)),
        formatDateTime(r.createdAt),
      ]),
    });
  }

  if (group.length) {
    sectionHeading(doc, `Group Registrations (${group.length})`, onNewPage);
    drawTable(doc, {
      onNewPage,
      columns: [
        { header: 'Registration ID', weight: 13 },
        { header: 'Team Name', weight: 14 },
        { header: 'Team Leader', weight: 13 },
        { header: 'Contact Number', weight: 10 },
        { header: 'Category', weight: 7 },
        { header: 'Competition Items (Event ID – Name)', weight: 24 },
        { header: 'Members', weight: 7, align: 'right' },
        { header: 'Registered On', weight: 12 },
      ],
      rows: group.map((r) => [
        r.registrationId,
        r.team.teamName,
        r.team.teamLeaderName,
        r.team.contactNumber,
        categoryOf(r),
        eventsCell(data.eventsOf(r)),
        String(r.team.members.length),
        formatDateTime(r.createdAt),
      ]),
    });

    sectionHeading(doc, `Group Members (${data.totals.groupMembers})`, onNewPage);
    drawTable(doc, {
      onNewPage,
      columns: [
        { header: 'Registration ID', weight: 14 },
        { header: 'Team Name', weight: 18 },
        { header: 'No.', weight: 5, align: 'right' },
        { header: 'Member Name', weight: 22 },
        { header: 'Gender', weight: 8 },
        { header: 'Date of Birth', weight: 11 },
        { header: 'Contact Number', weight: 11 },
      ],
      rows: group.flatMap((r) =>
        r.team.members.map((m) => [
          r.registrationId,
          r.team.teamName,
          String(m.memberNumber),
          m.fullName,
          GENDER_LABEL[m.gender],
          formatDate(m.dateOfBirth),
          m.contactNumber ?? '',
        ]),
      ),
    });
  }
}

function eventWiseView(doc, data, onNewPage) {
  const byEvent = new Map();
  for (const r of data.registrations) {
    for (const e of data.eventsOf(r)) {
      const key = String(e.eventId);
      if (!byEvent.has(key)) byEvent.set(key, { event: e, mode: r.mode, category: data.categoryName.get(String(r.categoryId)) ?? '', entries: [] });
      byEvent.get(key).entries.push(r);
    }
  }
  if (!byEvent.size) {
    sectionHeading(doc, 'Event-wise Registrations', onNewPage);
    drawTable(doc, { onNewPage, columns: [{ header: 'Details', weight: 1 }], rows: [] });
    return;
  }
  const groups = [...byEvent.values()].sort((a, b) => a.category.localeCompare(b.category) || a.event.name.localeCompare(b.event.name));
  for (const { event, mode, category, entries } of groups) {
    sectionHeading(doc, `${event.displayEventId} – ${event.name}`, onNewPage);
    const details = [
      `Category: ${category}`,
      `Mode: ${MODE_LABEL[mode]}`,
      `Gender: ${GENDER_LABEL[event.gender] ?? 'Open'}`,
      event.ageDivision ? `Age division: ${event.ageDivision}` : null,
      `Entries: ${entries.length}`,
    ].filter(Boolean);
    writeBlock(doc, details.join('   ·   '), { size: 8.5, color: COLORS.muted, gapAfter: 6 });
    drawTable(doc, {
      onNewPage,
      columns:
        mode === 'individual'
          ? [
              { header: '#', weight: 4, align: 'right' },
              { header: 'Registration ID', weight: 16 },
              { header: 'Participant Name', weight: 26 },
              { header: 'Gender', weight: 9 },
              { header: 'Contact Number', weight: 14 },
              { header: 'Registered On', weight: 16 },
            ]
          : [
              { header: '#', weight: 4, align: 'right' },
              { header: 'Registration ID', weight: 14 },
              { header: 'Team Name', weight: 16 },
              { header: 'Team Leader', weight: 14 },
              { header: 'Contact Number', weight: 11 },
              { header: 'Members', weight: 27 },
              { header: 'Registered On', weight: 14 },
            ],
      rows: entries.map((r, i) =>
        mode === 'individual'
          ? [String(i + 1), r.registrationId, r.participant.fullName, GENDER_LABEL[r.participant.gender], r.participant.contactNumber, formatDateTime(r.createdAt)]
          : [
              String(i + 1),
              r.registrationId,
              r.team.teamName,
              r.team.teamLeaderName,
              r.team.contactNumber,
              r.team.members.map((m) => `${m.memberNumber}. ${m.fullName} (${GENDER_LABEL[m.gender]})`).join('\n'),
              formatDateTime(r.createdAt),
            ],
      ),
    });
  }
}

function competitionSummary(doc, data, onNewPage) {
  const counts = new Map();
  for (const r of data.registrations) for (const e of data.eventsOf(r)) counts.set(String(e.eventId), (counts.get(String(e.eventId)) ?? 0) + 1);
  const items = data.competitionItems.filter((i) => counts.has(i._id));
  sectionHeading(doc, `Competition Details (${items.length} with entries)`, onNewPage);
  drawTable(doc, {
    onNewPage,
    columns: [
      { header: 'Event ID', weight: 9 },
      { header: 'Competition Item', weight: 28 },
      { header: 'Category', weight: 8 },
      { header: 'Mode', weight: 9 },
      { header: 'Gender', weight: 8 },
      { header: 'Age Division', weight: 12 },
      { header: 'Participants', weight: 10, align: 'right' },
      { header: 'Status', weight: 8 },
      { header: 'Entries', weight: 8, align: 'right' },
    ],
    rows: items.map((i) => [
      i.eventId,
      i.name,
      i.category,
      i.mode,
      i.gender,
      i.ageDivision || '–',
      i.minParticipants === i.maxParticipants ? String(i.minParticipants) : `${i.minParticipants}–${i.maxParticipants}`,
      i.status,
      String(counts.get(i._id)),
    ]),
  });
  writeBlock(
    doc,
    `Totals: ${data.totals.registrations} registrations (${data.totals.individual} individual, ${data.totals.group} group) · ${data.totals.eventEntries} event entries · ${data.totals.groupMembers} group members.`,
    { size: 9, bold: true, color: COLORS.primary },
  );
}

export function buildPdf(data, { title, filterParts, generatedBy, view = 'registrations' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `${title} – Variayan Kunan Club`, Author: 'Variayan Kunan Club', Creator: 'VKC Keralotsavam' },
    });
    doc.registerFont('latin', FONTS.latin);
    doc.registerFont('latin-bold', FONTS.latinBold);
    doc.registerFont('ml', FONTS.malayalam);
    doc.registerFont('ml-bold', FONTS.malayalamBold);

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.on('pageAdded', () => drawRunningHeader(doc, title));
      const onNewPage = undefined;
      drawCoverHeader(doc, { title, filterParts, generatedBy });
      drawTotals(doc, data.totals);
      if (view === 'events') eventWiseView(doc, data, onNewPage);
      else registrationsView(doc, data, onNewPage);
      competitionSummary(doc, data, onNewPage);
      drawFooters(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
