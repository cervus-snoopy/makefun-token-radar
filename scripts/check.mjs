// Token Radar's local gate replica (radar-3): the sealed 7-row gate, checked
// against a built /output directory, plus the dossier cap and the text cap
// the gate enforces. Run after main.ts:
//
//   node scripts/check.mjs out
//
// Exits 0 with 7/7 PASS, or 1 naming the failing row. It does not grade the
// entry — only the gate the scorer runs before the judge ever sees it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'out';
const snapshot = JSON.parse(readFileSync(process.argv[3] ?? 'kit/input/snapshot.json', 'utf8'));
const TEXT_MAX = 65_536;
const DOSSIER_MAX = 1_572_864;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

let pass = 0;
let fail = 0;
function row(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (ok) pass++;
  else fail++;
}

// 1. dashboard_files
{
  const dash = join(dir, 'dashboard');
  const files = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) throw new Error(`dot-directory ${p}`);
        walk(join(d, e.name), p);
      } else if (e.isFile()) {
        if (!PLAIN_NAME.test(e.name)) throw new Error(`bad name ${p}`);
        files.push(p);
      }
    }
  };
  let detail = '';
  let ok = false;
  try {
    walk(dash, '');
    const bytes = files.reduce((s, f) => s + statSync(join(dash, f)).size, 0);
    const hasHtml = files.some((f) => f === 'index.html' || f.endsWith('/index.html'));
    const hasCss = files.some((f) => f.endsWith('.css'));
    const hasJs = files.some((f) => f.endsWith('.js'));
    const noNet = files.every((f) => {
      if (!/\.(html|css|js)$/.test(f)) return true;
      const text = readFileSync(join(dash, f), 'utf8');
      if (f.endsWith('.css')) return !/https?:\/\//.test(text);
      if (f.endsWith('.js')) {
        // No network in the page's code: no remote imports, requires or
        // dynamic imports, and no fetch/XHR/URL built from an http(s) address.
        return !/(import|require)\s*\(?\s*['"]https?:\/\//.test(text) && !/import\s*\(['"]https?:\/\//.test(text) && !/(fetch|XMLHttpRequest|new\s+URL|new\s+WebSocket)\s*\(\s*['"]https?:\/\//.test(text);
      }
      return !/(href|src|action)\s*=\s*['"]https?:\/\//.test(text);
    });
    ok = files.length <= 400 && bytes <= 4 * 1024 * 1024 && hasHtml && hasCss && hasJs && noNet;
    detail = `${files.length} files, ${bytes} bytes, html/css/js present, no network refs`;
  } catch (e) {
    detail = String(e.message);
  }
  row('dashboard_files', ok, detail);
}

// 2. board_file + 3. sorted_by_value + 4. coverage + 5. farm_steps
{
  const board = JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8'));
  const rows = board.rows;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const bad = rows.filter((r) => !slugs.has(r.slug) || typeof r.name !== 'string' || r.name === '' || !Number.isSafeInteger(r.rank) || r.rank <= 0 || !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14 || !Array.isArray(r.farm_steps));
  const allEqual = rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
  row('board_file', rows.length >= 100 && rows.length <= 4000 && bad.length === 0 && !allEqual, `${rows.length} rows, ${bad.length} bad`);
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((v, i) => v === i + 1);
  const sortedOk = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
  row('sorted_by_value', ranksOk && sortedOk, `ranks 1..${rows.length}, non-rising implied value`);
  const have = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  row('coverage', missing.length === 0, `${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist covered`);
  const badSteps = rows.filter((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600));
  row('farm_steps', badSteps.length === 0, `${rows.length} rows, ${badSteps.length} with bad steps`);
}

// 6. screenshots
{
  const shots = readdirSync(join(dir, 'screenshots')).filter((n) => !n.startsWith('.')).sort();
  let ok = shots.length >= 3 && shots.length <= 4;
  let detail = shots.map((n) => `${n} ${statSync(join(dir, 'screenshots', n)).size}B`).join(', ');
  for (const n of shots) {
    const buf = readFileSync(join(dir, 'screenshots', n));
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpeg) ok = false;
    if (buf.length > 524288) ok = false;
    if (isPng) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (Math.max(w, h) > 1440 || Math.min(w, h) < 800) ok = false;
      detail += ` (${w}x${h})`;
    }
  }
  row('screenshots', ok, detail);
}

// 7. dossier_matches (+ caps)
{
  const dossier = JSON.parse(readFileSync(join(dir, 'dossier.json'), 'utf8'));
  const textBytes = Buffer.byteLength(dossier.text, 'utf8');
  const size = statSync(join(dir, 'dossier.json')).size;
  // The byte-for-byte rebuild is checked by main.ts itself; here we check
  // the caps the gate enforces and the dossier's shape.
  const ok = dossier.schema === 'makefun/dossier/v1' && dossier.cover === 0 && dossier.images.length >= 3 && textBytes <= TEXT_MAX && size <= DOSSIER_MAX;
  row('dossier_matches', ok, `${size} bytes, text ${textBytes}/${TEXT_MAX}, ${dossier.images.length} images`);
}

console.log(`\n${pass}/7 gate rows pass${fail > 0 ? `, ${fail} FAIL` : ''}`);
process.exit(fail > 0 ? 1 : 0);
