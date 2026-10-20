#!/usr/bin/env node
/**
 * Downloads SIL OFL Noto Sans / Noto Sans Malayalam TTF files used by PDF exports.
 * Safe to re-run: existing files are left untouched.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_ROOT } from '../src/config/env.js';

const DIR = path.join(SERVER_ROOT, 'assets', 'fonts');

const FILES = [
  {
    name: 'NotoSans-Regular.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoSans/full/ttf/NotoSans-Regular.ttf',
      'https://github.com/notofonts/latin-greek-cyrillic/raw/main/fonts/NotoSans/full/ttf/NotoSans-Regular.ttf',
    ],
  },
  {
    name: 'NotoSans-Bold.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoSans/full/ttf/NotoSans-Bold.ttf',
      'https://github.com/notofonts/latin-greek-cyrillic/raw/main/fonts/NotoSans/full/ttf/NotoSans-Bold.ttf',
    ],
  },
  {
    name: 'NotoSansMalayalam-Regular.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoSansMalayalam/full/ttf/NotoSansMalayalam-Regular.ttf',
      'https://github.com/notofonts/malayalam/raw/main/fonts/NotoSansMalayalam/full/ttf/NotoSansMalayalam-Regular.ttf',
    ],
  },
  {
    name: 'NotoSansMalayalam-Bold.ttf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoSansMalayalam/full/ttf/NotoSansMalayalam-Bold.ttf',
      'https://github.com/notofonts/malayalam/raw/main/fonts/NotoSansMalayalam/full/ttf/NotoSansMalayalam-Bold.ttf',
    ],
  },
];

async function exists(file) {
  try {
    const st = await fs.stat(file);
    return st.size > 1000;
  } catch {
    return false;
  }
}

async function download(file, urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000 || buf.subarray(0, 4).toString() === '<!do') continue;
      await fs.writeFile(file, buf);
      return buf.length;
    } catch {
      /* try next mirror */
    }
  }
  throw new Error(`Could not download ${path.basename(file)}`);
}

export async function ensurePdfFonts({ log = console.log } = {}) {
  await fs.mkdir(DIR, { recursive: true });
  for (const { name, urls } of FILES) {
    const file = path.join(DIR, name);
    if (await exists(file)) {
      log(`  ✔ ${name} already present`);
      continue;
    }
    log(`  ↓ ${name}`);
    const bytes = await download(file, urls);
    log(`  ✔ ${name} (${Math.round(bytes / 1024)} KB)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensurePdfFonts()
    .then(() => console.log('PDF fonts ready.'))
    .catch((error) => {
      console.error(`✖ ${error.message}`);
      process.exit(1);
    });
}
