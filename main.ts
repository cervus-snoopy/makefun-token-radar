// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// fits the radar-3 log-log value model on the snapshot's own traded tokens,
// validates it out of sample (leave-one-out, time split, bootstrap 200),
// ranks every rankable pre-token protocol, nets every farm plan to the
// dollar, and writes the ranked board to /output/board.json, the dashboard's
// data to /output/data.js, the validation report to
// /output/dashboard/validation.json, the proof file to
// /output/dashboard/00-proof.md, copies this repository's dashboard/ and
// screenshots/ to /output, and writes /output/dossier.json with the vendored
// make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/input/snapshot.json
//
// The run is deterministic: two runs write byte-identical files.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, boardIssue, buildBoard, buildRadar, compPool, dataScript, fitValueModel, parseSnapshot, summaryLine } from './lib/model.ts';
import { proofText } from './lib/proof.ts';
import { leaveOneOut, validateModel } from './lib/validation.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
/** The gate's dossier cap, 1.5 MiB — not the vendor library's 4 MiB constant. */
const DOSSIER_MAX_BYTES = 1_572_864;
const SCREENSHOT_CAPS = { max: 3, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// Fit the curve on the snapshot's own traded tokens, then validate it before
// the board is built: the farm band comes from the LOO error spread.
const comps = compPool(snapshot, MODEL);
const fitted = fitValueModel(comps, snapshot.as_of, MODEL);
const provisional = leaveOneOut(comps, snapshot.as_of, MODEL);
// The band is rounded to 4 decimals here and in the report, so the two agree exactly.
const band = Math.round(Math.pow(10, provisional.sigma_log10) * 1e4) / 1e4;
const { board, screening } = buildBoard(snapshot, fitted, band, MODEL);
const report = validateModel(snapshot, comps, fitted, board, MODEL);
if (Math.abs(report.band - band) > 1e-9) {
  process.stderr.write(`token radar: the validation band moved between passes (${band} vs ${report.band})\n`);
  process.exit(1);
}
const { radar } = buildRadar(snapshot, fitted, board, screening, MODEL);
radar.validation = {
  loo_geo: report.loo.geo_factor,
  loo_mdape: report.loo.mdape,
  loo_spearman: report.loo.spearman,
  loo_within_2x: report.loo.within_2x,
  loo_pipeline_geo: report.loo_pipeline.geo_factor,
  loo_pipeline_mdape: report.loo_pipeline.mdape,
  loo_pipeline_spearman: report.loo_pipeline.spearman,
  loo_pipeline_within_2x: report.loo_pipeline.within_2x,
  time_split_geo: report.time_split.geo_factor,
  time_split_cut: report.time_split.cut,
  time_split_n_train: report.time_split.n_train,
  time_split_n_test: report.time_split.n_test,
  bootstrap_top10_keeps: report.bootstrap.top10_keeps,
  bootstrap_rank1_stays: report.bootstrap.rank1_stays,
  baseline_median_geo: report.baseline_median.geo_factor,
  baseline_tvl_geo: report.baseline_tvl.geo_factor,
  band: report.band,
  n_comps: fitted.n,
};
radar.fit_view = report.fit_view;
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The validation report and the proof file are written by this run, from the
// numbers it computed — they can never drift from the board they describe.
writeFileSync(join(out, 'dashboard', 'validation.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(out, 'dashboard', '00-proof.md'), proofText(fitted, report, radar, screening, snapshot.as_of));

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length !== 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in exactly 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierOpts = { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } };
const dossier = buildDossier(out, dossierOpts);
if (dossier.length > DOSSIER_MAX_BYTES) {
  process.stderr.write(`token radar: the dossier is ${dossier.length} bytes, over the gate's ${DOSSIER_MAX_BYTES}\n`);
  process.exit(1);
}
writeFileSync(join(out, 'dossier.json'), dossier);

// Rebuild the dossier from the written /output and refuse a mismatch: the gate
// compares bytes, so a mismatch here means the submission is already dead.
if (!Buffer.from(buildDossier(out, dossierOpts)).equals(readFileSync(join(out, 'dossier.json')))) {
  process.stderr.write('token radar: the dossier does not rebuild to the same bytes\n');
  process.exit(1);
}

process.stdout.write(
  `token radar: ${summaryLine(board, snapshot)}\n` +
    `token radar: fit ln(mcap) = ${fitted.intercept.toFixed(3)} + ${fitted.slope_tvl.toFixed(3)} ln(TVL) ${fitted.slope_age.toFixed(3)} ln(age), R2 ${fitted.r2.toFixed(3)}, n=${fitted.n}\n` +
    `token radar: LOO x${report.loo.geo_factor.toFixed(2)}, time-split x${report.time_split.geo_factor.toFixed(2)}, bootstrap top-10 keeps ${report.bootstrap.top10_keeps.toFixed(2)}/10, band x${report.band.toFixed(2)}\n` +
    `token radar: verdicts FARM ${radar.verdict_counts.FARM} / THIN ${radar.verdict_counts.THIN} / SKIP ${radar.verdict_counts.SKIP}, dossier ${dossier.length} bytes\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
