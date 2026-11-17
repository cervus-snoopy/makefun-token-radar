// Token Radar's out-of-sample validation (radar-3): leave-one-out, time-split
// and bootstrap, all computed at build time from the sealed snapshot, plus the
// two baselines the fitted curve has to beat. Nothing here is hardcoded: every
// number the dashboard, the proof file and the README quote comes out of these
// functions, so a skeptic can rerun them from the snapshot alone.
//
// Leakage discipline (conformal-UQ skill, calibration-set rule): every
// held-out prediction is made by a model fitted WITHOUT that protocol — and
// without any other protocol of the same token, because the comp pool keeps
// one greatest-TVL protocol per token id. The time split fits on protocols
// listed on or before the cut and tests only on protocols listed after it.
// The bootstrap resamples comps and re-ranks the board's own top 10.
//
// Metrics, all on the traded tokens' market caps:
//   geo factor  = exp(median |ln(predicted / actual)|) — the headline number:
//                 a typical prediction is within this factor of the truth.
//   mean factor = mean(max(pred/actual, actual/pred))
//   MdAPE       = median |pred - actual| / actual
//   Spearman    = rank correlation of predicted vs actual values
//   within-2x / within-3x = share of predictions inside that factor
//
// Baselines, measured on the same pool with the same metric:
//   median-multiple: each comp predicted from the median mcap/TVL of the
//     other comps in its own category (whole-market median when the category
//     has fewer than 3 peers), clamped to [0.05, 1.00] — the radar-2 estimator.
//   TVL-only: predicted market cap = TVL (multiple 1.0, no fitting at all).

import {
  MODEL,
  ageDays,
  compPool,
  fitValueModel,
  fittedMultiple,
  impliedValue,
  median,
  type BoardRow,
  type FitView,
  type FittedModel,
  type ModelConstants,
  type Snapshot,
  type SnapshotProtocol,
} from './model.ts';

/** One validation metric set: the numbers the dashboard and proof file quote. */
export interface ValidationMetrics {
  n: number;
  geo_factor: number;
  mean_factor: number;
  mdape: number;
  spearman: number;
  within_2x: number;
  within_3x: number;
}

/** The whole validation report, computed at build time. */
export interface ValidationReport {
  loo: ValidationMetrics;
  /** The same LOO, with the growth multiplier and the 0.85 discount applied — the full pipeline. */
  loo_pipeline: ValidationMetrics;
  time_split: ValidationMetrics & { cut: string; n_train: number; n_test: number; n_undated: number };
  /** Walk-forward, three expanding folds by listed date (see walkForward). */
  walk_forward: WalkForward;
  bootstrap: { draws: number; seed: number; top10_keeps: number; mean_rank_shift: number; rank1_stays: number };
  baseline_median: ValidationMetrics;
  baseline_tvl: ValidationMetrics;
  /** The LOO log10 error spread: 10^sigma is the band the farm plans net against. */
  loo_sigma_log10: number;
  band: number;
  /** What the band actually covers: share of LOO predictions inside 10^sigma. */
  loo_band_coverage: number;
  /** The 90% conformal band: 10^q90 of the absolute LOO log10 errors. */
  loo_band_90: number;
  /** Fit-view data for the dashboard scatter. */
  fit_view: FitView;
}

/** The fit-view scatter data for the dashboard (defined in lib/model.ts). */
export type { FitView } from './model.ts';

/** Deterministic PRNG (mulberry32) for the bootstrap: same seed, same draws. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spearman rank correlation, with average ranks for ties. */
export function spearman(xs: number[], ys: number[]): number {
  const rank = (values: number[]): number[] => {
    const order = values.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const out = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]![1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** The metric set for one list of predictions against the actual values. */
export function metricsFor(predicted: number[], actual: number[]): ValidationMetrics {
  const n = actual.length;
  const logErrs = predicted.map((pr, i) => Math.abs(Math.log(pr / actual[i]!)));
  const factors = predicted.map((pr, i) => Math.max(pr / actual[i]!, actual[i]! / pr));
  const apes = predicted.map((pr, i) => Math.abs(pr - actual[i]!) / actual[i]!);
  return {
    n,
    geo_factor: Math.exp(median(logErrs)),
    mean_factor: factors.reduce((s, v) => s + v, 0) / n,
    mdape: median(apes),
    spearman: spearman(predicted, actual),
    within_2x: factors.filter((f) => f <= 2).length / n,
    within_3x: factors.filter((f) => f <= 3).length / n,
  };
}

/** The curve's prediction of one comp's market cap (no growth, no discount). */
function curvePrediction(fitted: FittedModel, p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const { multiple } = fittedMultiple(fitted, p, asOf, model);
  return p.tvl_usd * multiple;
}

/** Leave-one-out: refit on every comp but one, predict the held-out one. */
export function leaveOneOut(
  comps: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): { curve: ValidationMetrics; pipeline: ValidationMetrics; sigma_log10: number; band_coverage: number; band_90: number } {
  const curvePreds: number[] = [];
  const pipelinePreds: number[] = [];
  const actuals: number[] = [];
  const log10Errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const fitted = fitValueModel(train, asOf, model);
    const held = comps[i]!;
    const curve = curvePrediction(fitted, held, asOf, model);
    const v = impliedValue(fitted, held, asOf, model);
    curvePreds.push(curve);
    pipelinePreds.push(v.implied);
    actuals.push(held.mcap_usd!);
    log10Errs.push(Math.log10(curve / held.mcap_usd!));
  }
  const meanErr = log10Errs.reduce((s, v) => s + v, 0) / log10Errs.length;
  const variance = log10Errs.reduce((s, v) => s + (v - meanErr) ** 2, 0) / Math.max(log10Errs.length - 1, 1);
  const sigma = Math.sqrt(variance);
  // Conformal-UQ honesty (round-1 fix): the band is 10^sigma, one standard
  // deviation of the held-out log10 errors — report what it actually covers,
  // and the 90% conformal band beside it, so the proof file never overstates
  // the band as a high-coverage interval. band_90 is 10^q90 where q90 is the
  // ceil((n+1)*0.9)-th smallest absolute LOO log10 error (the (n+1) correction).
  const absErrs = log10Errs.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const bandCoverage = absErrs.filter((e) => e <= sigma).length / Math.max(absErrs.length, 1);
  const q90 = absErrs[Math.min(Math.ceil((absErrs.length + 1) * 0.9), absErrs.length) - 1]!;
  return {
    curve: metricsFor(curvePreds, actuals),
    pipeline: metricsFor(pipelinePreds, actuals),
    sigma_log10: sigma,
    band_coverage: bandCoverage,
    band_90: Math.pow(10, q90),
  };
}

/**
 * Time split: fit on comps listed on or before the cut, test on comps listed
 * after it. Comps with no listed_at date are counted and left out of both
 * sides — a split cannot place an undated protocol in time.
 */
export function timeSplit(
  comps: SnapshotProtocol[],
  asOf: string,
  cut: string,
  model: ModelConstants = MODEL,
): ValidationMetrics & { cut: string; n_train: number; n_test: number; n_undated: number } {
  const dated = comps.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! <= cut);
  const test = dated.filter((p) => p.listed_at! > cut);
  const fitted = fitValueModel(train, asOf, model);
  const predicted = test.map((p) => curvePrediction(fitted, p, asOf, model));
  const actual = test.map((p) => p.mcap_usd!);
  return {
    ...metricsFor(predicted, actual),
    cut,
    n_train: train.length,
    n_test: test.length,
    n_undated: comps.length - dated.length,
  };
}

/**
 * Walk-forward validation (walk-forward-validation skill, expanding
 * windows, adapted to one dated cross-section): sort the dated comps by
 * listed_at, cut at the quartiles, and for each cut fit on everything
 * listed on or before it and test on the rows listed after it up to the
 * next cut. The pooled metric covers every dated comp exactly once as a
 * held-out row (the earliest quartile is train-only). A fold tuple is
 * [cut, n_train, n_test, geo_factor]; the pooled figure keeps n and the
 * geo factor, the two numbers the proof quotes.
 *
 * No purge: the labels are point-in-time market caps, not forward
 * windows, so no training label overlaps any test period. No embargo is
 * applied either — dropping train rows listed just before a cut was
 * tested as a sensitivity check and made every fold worse (round 2),
 * which is pure data loss in this setting, not leakage protection.
 */
export interface WalkForward {
  folds: Array<[string, number, number, number]>;
  pooled: { n: number; geo_factor: number };
}

export function walkForward(
  comps: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): WalkForward {
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const cuts = [0.25, 0.5, 0.75].map((q) => dated[Math.floor(dated.length * q)]!.listed_at!);
  const folds: Array<[string, number, number, number]> = [];
  const pooledPred: number[] = [];
  const pooledAct: number[] = [];
  cuts.forEach((cut, fi) => {
    const train = dated.filter((p) => p.listed_at! <= cut);
    const test = dated.filter(
      (p) => p.listed_at! > cut && (fi === cuts.length - 1 || p.listed_at! <= cuts[fi + 1]!),
    );
    const fitted = fitValueModel(train, asOf, model);
    const pred = test.map((p) => curvePrediction(fitted, p, asOf, model));
    const act = test.map((p) => p.mcap_usd!);
    folds.push([cut, train.length, test.length, round4(metricsFor(pred, act).geo_factor)]);
    pooledPred.push(...pred);
    pooledAct.push(...act);
  });
  const pooled = metricsFor(pooledPred, pooledAct);
  return { folds, pooled: { n: pooled.n, geo_factor: round4(pooled.geo_factor) } };
}

/** The median-multiple baseline, LOO: each comp from the other comps of its category. */export function baselineMedian(comps: SnapshotProtocol[], model: ModelConstants = MODEL): ValidationMetrics {
  // The radar-2 estimator's own clamp, [0.05, 1.00], and its 3-peer rule —
  // the baseline is the old model, measured exactly as the old model ran.
  const floor = 0.05;
  const cap = 1.0;
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const byCat = new Map<string, number[]>();
    const all: number[] = [];
    for (const p of train) {
      const ratio = p.mcap_usd! / p.tvl_usd;
      all.push(ratio);
      const list = byCat.get(p.category ?? '__null') ?? [];
      list.push(ratio);
      byCat.set(p.category ?? '__null', list);
    }
    const fallback = Math.min(cap, Math.max(floor, median(all)));
    const held = comps[i]!;
    const peers = byCat.get(held.category ?? '__null') ?? [];
    const multiple =
      peers.length >= 3
        ? Math.min(cap, Math.max(floor, median(peers)))
        : fallback;
    predicted.push(held.tvl_usd * multiple);
    actual.push(held.mcap_usd!);
  }
  return metricsFor(predicted, actual);
}

/** The TVL-only baseline: predicted market cap = TVL. No fitting, so no LOO loop. */
export function baselineTvl(comps: SnapshotProtocol[]): ValidationMetrics {
  return metricsFor(
    comps.map((p) => p.tvl_usd),
    comps.map((p) => p.mcap_usd!),
  );
}

/**
 * Bootstrap stability: resample the comp pool with replacement, refit, and
 * re-rank the board's protocols by implied value. Reports how many of the
 * full-fit top 10 stay in the top 10, the mean rank shift of those ten, and
 * how often rank 1 stays rank 1. Deterministic for a fixed seed.
 */
export function bootstrapTop10(
  comps: SnapshotProtocol[],
  board: BoardRow[],
  snapshot: Snapshot,
  asOf: string,
  draws: number,
  seed: number,
  model: ModelConstants = MODEL,
): { draws: number; seed: number; top10_keeps: number; mean_rank_shift: number; rank1_stays: number } {
  const rng = mulberry32(seed);
  const top10 = board.slice(0, 10).map((r) => r.slug);
  const protocols = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  let keeps = 0;
  let shift = 0;
  let rank1 = 0;
  for (let d = 0; d < draws; d++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const fitted = fitValueModel(sample, asOf, model);
    const scored = board.map((r) => {
      const p = protocols.get(r.slug)!;
      const v = impliedValue(fitted, p, asOf, model);
      return { slug: r.slug, implied: v.implied };
    });
    scored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
    const newTop10 = scored.slice(0, 10).map((s) => s.slug);
    keeps += newTop10.filter((s) => top10.includes(s)).length;
    const pos = new Map(scored.map((s, i) => [s.slug, i]));
    shift += top10.reduce((sum, slug, i) => sum + Math.abs((pos.get(slug) ?? 99) - i), 0) / 10;
    if (newTop10[0] === top10[0]) rank1++;
  }
  return {
    draws,
    seed,
    top10_keeps: keeps / draws,
    mean_rank_shift: shift / draws,
    rank1_stays: rank1 / draws,
  };
}

/** Round to 4 decimal places, so validation.json stays compact in the dossier text. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function roundMetrics(m: ValidationMetrics): ValidationMetrics {
  return {
    n: m.n,
    geo_factor: round4(m.geo_factor),
    mean_factor: round4(m.mean_factor),
    mdape: round4(m.mdape),
    spearman: round4(m.spearman),
    within_2x: round4(m.within_2x),
    within_3x: round4(m.within_3x),
  };
}

/** The fit-view scatter data for the dashboard. */
export function fitView(
  snapshot: Snapshot,
  comps: SnapshotProtocol[],
  fitted: FittedModel,
  board: BoardRow[],
  model: ModelConstants = MODEL,
): FitView {
  const flagDex = 0.5;
  const kept = comps.map((p) => {
    const x = Math.log10(Math.max(p.tvl_usd, 1));
    const y = Math.log10(p.mcap_usd!);
    const { multiple } = fittedMultiple(fitted, p, snapshot.as_of, model);
    const yFit = Math.log10(p.tvl_usd * multiple);
    const residual = y - yFit;
    // No residual_dex field: it is y - y_fit, and the flagged boolean carries
    // the >0.5 dex call the dashboard needs. Keeps validation.json small
    // enough for the dossier text to hold it whole.
    return { slug: p.slug, x: round4(x), y: round4(y), y_fit: round4(yFit), flagged: Math.abs(residual) > flagDex };
  });
  const compSlugs = new Set(comps.map((p) => p.slug));
  const dropped = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !compSlugs.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      x: round4(Math.log10(Math.max(p.tvl_usd, 1))),
      y: round4(Math.log10(p.mcap_usd!)),
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const candidates = board.slice(0, 25).map((r) => {
    const p = bySlug.get(r.slug)!;
    return {
      slug: r.slug,
      x: round4(Math.log10(Math.max(p.tvl_usd, 1))),
      y: round4(Math.log10(Math.max(r.implied_value_usd, 1))),
      rank: r.rank,
    };
  });
  return { kept, dropped, candidates, flag_dex: flagDex };
}

/** The time-split cut: the median listed_at of the dated comps. */
export function medianListedCut(comps: SnapshotProtocol[]): string {
  const dates = comps
    .filter((p) => p.listed_at !== null)
    .map((p) => p.listed_at!)
    .sort();
  return dates[Math.floor(dates.length / 2)]!;
}

/**
 * The full validation report. The board is needed only for the bootstrap
 * re-ranking; the LOO, time-split and baselines need the comp pool alone.
 * The band comes from the LOO log10 error spread: farm plans net against
 * implied / 10^sigma.
 */
export function validateModel(
  snapshot: Snapshot,
  comps: SnapshotProtocol[],
  fitted: FittedModel,
  board: BoardRow[],
  model: ModelConstants = MODEL,
): ValidationReport {
  const loo = leaveOneOut(comps, snapshot.as_of, model);
  const cut = medianListedCut(comps);
  const split = timeSplit(comps, snapshot.as_of, cut, model);
  const wf = walkForward(comps, snapshot.as_of, model);
  const boot = bootstrapTop10(comps, board, snapshot, snapshot.as_of, 200, 20261114, model);
  const band = Math.pow(10, loo.sigma_log10);
  return {
    loo: roundMetrics(loo.curve),
    loo_pipeline: roundMetrics(loo.pipeline),
    time_split: {
      ...roundMetrics(split),
      cut: split.cut,
      n_train: split.n_train,
      n_test: split.n_test,
      n_undated: split.n_undated,
    },
    walk_forward: wf,
    bootstrap: {
      draws: boot.draws,
      seed: boot.seed,
      top10_keeps: round4(boot.top10_keeps),
      mean_rank_shift: round4(boot.mean_rank_shift),
      rank1_stays: round4(boot.rank1_stays),
    },
    baseline_median: roundMetrics(baselineMedian(comps, model)),
    baseline_tvl: roundMetrics(baselineTvl(comps)),
    loo_sigma_log10: round4(loo.sigma_log10),
    band: round4(band),
    loo_band_coverage: round4(loo.band_coverage),
    loo_band_90: round4(loo.band_90),
    fit_view: fitView(snapshot, comps, fitted, board, model),
  };
}
