// Token Radar's fitted value model (radar-3): one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank: the whole
// watchlist (the floor, never the ceiling) plus every other rankable pre-token
// protocol below the floor, by implied launch value.
//
// Implied value follows only from the snapshot's own figures — never from a
// hardcoded list of names. The estimator is a log-log curve fitted on the
// traded tokens in the snapshot itself:
//
//   ln(mcap) = a + b*ln(TVL) + c*ln(age_days) + category offset
//
// The curve is ordinary least squares on the comp pool (see compPool): live
// tokens whose mcap/TVL ratio sits in [0.02, 20], one greatest-TVL protocol
// per token id so no token leaks across folds. Category offsets are the mean
// residual of the category's comps, shrunk toward zero by 8 pseudo-observations
// (a category with n comps keeps n/(n+8) of its mean residual). The fitted
// multiple is clamped to [0.08, 1.20]. The 7-day growth enters as a post-fit
// multiplier, 1 + 0.6 * clamped growth, and a 0.85 pre-token discount is applied
// as a stated assumption: a token that does not trade yet is worth less than
// the curve's traded-token prediction, and 0.85 says how much less.
//
//   multiple  = clamp(exp(a + b*ln(TVL) + c*ln(age)) * exp(offset) / TVL, 0.08, 1.20)
//   growthMul = 1 + 0.6 * clamp(change_7d, -60, 120) / 100
//   implied   = max(1, round(TVL * multiple * growthMul * 0.85))
//
// A separate readiness score (0-100, display only, never the rank key) blends
// age, growth and size: how close a launch looks, not what it is worth.
//
// Every farm plan is netted to the dollar (see farmEconomics): the farmer's
// expected slice, less gas fees and less the T-bill cost of the capital for
// the hold, with a FARM / THIN / SKIP verdict. A SKIP plan says so in its
// first step.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model's constants: the OLS coefficients and the rules around them. */
export interface ModelConstants {
  /** Ratio band a live token must sit in to join the comp pool. */
  ratio_low: number;
  ratio_high: number;
  /** Pseudo-observations shrinking each category offset toward zero. */
  offset_shrink: number;
  /** Clamp on the fitted multiple. */
  multiple_low: number;
  multiple_high: number;
  /** Growth multiplier: weight on the clamped 7-day change. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** Pre-token discount, a stated assumption. */
  pre_token_discount: number;
  /** Days of age assumed when listed_at is missing. */
  unknown_age_days: number;
  /** The farmer's assumed share of the implied value. */
  farmer_share: number;
  /** The risk-free rate used for the T-bill cost of capital. */
  tbill_rate: number;
  /** Net dollars that clear the FARM hurdle, and the share of capital it must also clear. */
  farm_min_net_usd: number;
  farm_min_net_share: number;
}

export const MODEL: ModelConstants = {
  ratio_low: 0.02,
  ratio_high: 20,
  offset_shrink: 8,
  multiple_low: 0.08,
  multiple_high: 1.2,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  pre_token_discount: 0.85,
  unknown_age_days: 365,
  farmer_share: 0.000025,
  tbill_rate: 0.04,
  farm_min_net_usd: 60,
  farm_min_net_share: 0.04,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted curve: OLS coefficients plus the shrunk category offsets. */
export interface FittedModel {
  intercept: number;
  slope_tvl: number;
  slope_age: number;
  /** Category offset in log units, shrunk toward zero; missing categories get 0. */
  offsets: Map<string, number>;
  /** In-sample R squared of the curve with offsets. */
  r2: number;
  /** In-sample R squared of the plain OLS curve without offsets. */
  r2_plain: number;
  /** Number of comps the fit was run on. */
  n: number;
  /** Residual standard deviation in log10 units (the model band's sigma). */
  sigma_log10: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The netted economics of one farm plan, in dollars. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  /** The farmer's expected slice at the implied value. */
  slice_usd: number;
  /** The slice netted to the low end of the model band. */
  slice_low_usd: number;
  fees_usd: number;
  tbill_usd: number;
  net_usd: number;
  hours: number;
  per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  model: {
    fitted_multiple: number;
    category_offset: number;
    growth_pct: number;
    growth_multiplier: number;
    age_days: number | null;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  fitted_multiple: number;
  growth_multiplier: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_usd: number;
  farm: FarmEconomics;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How the snapshot's 758 protocols were screened down to the board. */
export interface Screening {
  total: number;
  has_token: number;
  pre_token: number;
  excluded_category: number;
  versioned_name: number;
  wrapped_name: number;
  exchange_name: number;
  no_category: number;
  board_rows: number;
  watchlist_rows: number;
  early_rows: number;
}

/** The fit-view scatter data for the dashboard. */
export interface FitView {
  /** Kept comps: log10 TVL, log10 mcap, log10 fitted mcap, flagged when |residual| > flag_dex. */
  kept: { slug: string; x: number; y: number; y_fit: number; flagged: boolean }[];
  /** Live tokens the ratio filter dropped: hollow points. */
  dropped: { slug: string; x: number; y: number; ratio: number }[];
  /** The board's top 25, placed on the same axes by implied value. */
  candidates: { slug: string; x: number; y: number; rank: number }[];
  /** Residual dex above which a point is flagged as disagreeing with the curve. */
  flag_dex: number;
}

/** The validation summary the dashboard's hero and method panels show. */
export interface ValidationSummary {
  loo_geo: number;
  loo_mdape: number;
  loo_spearman: number;
  loo_within_2x: number;
  loo_pipeline_geo: number;
  /** The full pipeline's own MdAPE / Spearman / within-2x (round-1 fix: the
   * calibration table used to repeat the curve's three numbers under the
   * pipeline's label — they differ, if only in the third decimal and 1.8pp).
   * Kept beside the curve's three so a reader can compare the two rows. */
  loo_pipeline_mdape: number;
  loo_pipeline_spearman: number;
  loo_pipeline_within_2x: number;
  time_split_geo: number;
  time_split_cut: string;
  time_split_n_train: number;
  time_split_n_test: number;
  bootstrap_top10_keeps: number;
  bootstrap_rank1_stays: number;
  baseline_median_geo: number;
  baseline_tvl_geo: number;
  band: number;
  n_comps: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: {
    intercept: number;
    slope_tvl: number;
    slope_age: number;
    r2: number;
    r2_plain: number;
    n_comps: number;
    sigma_log10: number;
    offsets: { category: string; offset: number; peers: number }[];
  };
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  screening: Screening;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  rows: RadarRow[];
  live: LiveRow[];
  /** Attached by main.ts from the validation report: the hero/method numbers. */
  validation?: ValidationSummary;
  /** Attached by main.ts from the validation report: the fit scatter. */
  fit_view?: FitView;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers; 0 when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp `n` into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to 4 decimal places, for display. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Round to 2 decimal places, for dollars. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Solve a small dense linear system by Gaussian elimination with partial
 * pivoting. Used for the OLS normal equations (3 unknowns); a tiny ridge
 * keeps the system solvable when a column is degenerate.
 */
export function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    if (pivot !== c) {
      const tmp = m[c]!;
      m[c] = m[pivot]!;
      m[pivot] = tmp;
    }
    const d = m[c]![c]!;
    for (let j = c; j <= n; j++) m[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      for (let j = c; j <= n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** Ordinary least squares for a design matrix X and target y, via the normal equations. */
export function ols(design: number[][], target: number[]): number[] {
  const k = design[0]!.length;
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i]!;
    for (let r = 0; r < k; r++) {
      atb[r]! += row[r]! * target[i]!;
      for (let c = 0; c < k; c++) ata[r]![c]! += row[r]! * row[c]!;
    }
  }
  for (let r = 0; r < k; r++) ata[r]![r]! += 1e-9;
  return solveLinear(ata, atb);
}

/** The design row for one protocol: intercept, ln(TVL), ln(age in days). */
function designRow(p: SnapshotProtocol, asOf: string, model: ModelConstants): number[] {
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  return [1, Math.log(Math.max(p.tvl_usd, 1)), Math.log(Math.max(age, 1))];
}

/**
 * The comp pool: live-token protocols whose mcap/TVL ratio sits inside the
 * model's band, one greatest-TVL protocol per token id (gecko id, else symbol,
 * else slug) so the same token never appears twice and never leaks across
 * folds. Sorted by slug, so every later step is deterministic.
 */
export function compPool(snapshot: Snapshot, model: ModelConstants = MODEL): SnapshotProtocol[] {
  const live = snapshot.protocols.filter((p) => {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return false;
    const ratio = p.mcap_usd / p.tvl_usd;
    return ratio >= model.ratio_low && ratio <= model.ratio_high;
  });
  const byToken = new Map<string, SnapshotProtocol>();
  for (const p of live) {
    const key = p.gecko_id ?? p.symbol ?? p.slug;
    const cur = byToken.get(key);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd) byToken.set(key, p);
  }
  return [...byToken.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/**
 * Fit the log-log curve on a comp pool: OLS of ln(mcap) on ln(TVL) and
 * ln(age), then per-category mean residuals shrunk toward zero by the
 * model's pseudo-observation count. Returns the coefficients, the offsets,
 * both R squared values and the residual spread in log10 units.
 */
export function fitValueModel(
  comps: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): FittedModel {
  const design = comps.map((p) => designRow(p, asOf, model));
  const target = comps.map((p) => Math.log(p.mcap_usd!));
  const beta = ols(design, target);
  const plainPred = design.map((row) => row.reduce((s, v, j) => s + v * beta[j]!, 0));
  const meanY = target.reduce((s, v) => s + v, 0) / target.length;
  let ssTot = 0;
  let ssPlain = 0;
  for (let i = 0; i < target.length; i++) {
    ssTot += (target[i]! - meanY) ** 2;
    ssPlain += (target[i]! - plainPred[i]!) ** 2;
  }
  const r2Plain = ssTot === 0 ? 0 : 1 - ssPlain / ssTot;
  // Category offsets: mean residual, shrunk by offset_shrink pseudo-observations.
  const byCat = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const key = p.category ?? '__null';
    const list = byCat.get(key) ?? [];
    list.push(target[i]! - plainPred[i]!);
    byCat.set(key, list);
  });
  const offsets = new Map<string, number>();
  for (const [cat, residuals] of byCat) {
    const mean = residuals.reduce((s, v) => s + v, 0) / residuals.length;
    offsets.set(cat, (residuals.length / (residuals.length + model.offset_shrink)) * mean);
  }
  // Residuals with offsets, for the band sigma and the offset R squared.
  let ssOff = 0;
  const residuals: number[] = [];
  comps.forEach((p, i) => {
    const r = target[i]! - plainPred[i]! - (offsets.get(p.category ?? '__null') ?? 0);
    residuals.push(r);
    ssOff += r * r;
  });
  const r2 = ssTot === 0 ? 0 : 1 - ssOff / ssTot;
  const meanRes = residuals.reduce((s, v) => s + v, 0) / residuals.length;
  const variance = residuals.reduce((s, v) => s + (v - meanRes) ** 2, 0) / Math.max(residuals.length - 1, 1);
  const sigmaLog10 = Math.sqrt(variance) / Math.LN10;
  return {
    intercept: beta[0]!,
    slope_tvl: beta[1]!,
    slope_age: beta[2]!,
    offsets,
    r2,
    r2_plain: r2Plain,
    n: comps.length,
    sigma_log10: sigmaLog10,
  };
}

/** The fitted multiple for one protocol: the curve's prediction over its TVL, clamped. */
export function fittedMultiple(
  fitted: FittedModel,
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { multiple: number; offset: number } {
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  const offset = fitted.offsets.get(p.category ?? '__null') ?? 0;
  const lnPred =
    fitted.intercept + fitted.slope_tvl * Math.log(Math.max(p.tvl_usd, 1)) + fitted.slope_age * Math.log(Math.max(age, 1)) + offset;
  const multiple = clamp(Math.exp(lnPred) / p.tvl_usd, model.multiple_low, model.multiple_high);
  return { multiple, offset };
}

/** The multipliers and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  fitted: FittedModel,
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; offset: number; growthPct: number; growthMult: number; age: number | null; readiness: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, offset } = fittedMultiple(fitted, protocol, asOf, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * multiple * growthMult * model.pre_token_discount),
  );
  // Readiness (display only): older, growing and larger protocols look closer to a launch.
  const ageForModel = age ?? model.unknown_age_days;
  const ageNorm = Math.min(Math.max(ageForModel, 0), 1460) / 1460;
  const growthNorm = (growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor);
  const sizeNorm = clamp((Math.log10(Math.max(protocol.tvl_usd, 1)) - 6) / 4, 0, 1);
  const readiness = Math.round(100 * (0.4 * ageNorm + 0.3 * growthNorm + 0.3 * sizeNorm));
  return { implied, multiple, offset, growthPct, growthMult, age, readiness };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that says what it is: a wrapped, staked or staking product of a protocol that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Categories that are never a launch of their own: exchanges, bridges, and
 * staking wrappers — a wrapped, staked or bridged product of a protocol that
 * trades, not a protocol waiting for a token.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The exchange names, derived from the snapshot itself: the first word of every
 * CEX protocol's name. A protocol whose name begins with one is an exchange's
 * own product, not a protocol waiting for a token.
 */
export function exchangeNames(snapshot: Snapshot): Set<string> {
  const names = new Set<string>();
  for (const p of snapshot.protocols) {
    if (p.category !== 'CEX') continue;
    const first = p.name.split(/[^A-Za-z]+/)[0]?.toLowerCase();
    if (first !== undefined && first !== '') names.add(first);
  }
  return names;
}

/** Whether a protocol's name begins with an exchange name. */
function beginsWithExchange(p: SnapshotProtocol, exchanges: Set<string>): boolean {
  const first = p.name.split(/[^A-Za-z]+/)[0]?.toLowerCase();
  return first !== undefined && first !== '' && exchanges.has(first);
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why a pre-token protocol is not rankable, or null when it is: the first
 * reason in the order the screening counts use. A protocol with a token is
 * never screened here — it is not pre-token in the first place.
 */
export function screenReason(p: SnapshotProtocol, exchanges: Set<string>): string | null {
  if (p.category === null) return 'no_category';
  if (EXCLUDED_CATEGORIES.has(p.category)) return 'excluded_category';
  if (VERSIONED.test(p.name)) return 'versioned_name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped_name';
  if (beginsWithExchange(p, exchanges)) return 'exchange_name';
  return null;
}

/** Whether a protocol is one the board may rank. */
export function isRankable(p: SnapshotProtocol, exchanges: Set<string> = new Set()): boolean {
  return isPreToken(p) && screenReason(p, exchanges) === null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The netted economics of one farm plan, in dollars. The farmer's slice is a
 * stated share of the implied value (one active farmer captures 0.0025% of
 * what the launch would be worth), netted to the low end of the model band
 * (divided by 10^sigma, sigma the LOO log10 error spread), less gas fees and
 * less the T-bill cost of the capital for the hold. FARM when the net clears
 * $60 AND 4% of the capital; THIN when it covers its costs but not the
 * hurdle; SKIP otherwise. Hours are active hours only — setup, one weekly
 * action and the claim — never the hold itself.
 */
export function farmEconomics(
  implied: number,
  p: SnapshotProtocol,
  age: number | null,
  band: number,
  model: ModelConstants = MODEL,
): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const slice = implied * model.farmer_share;
  const sliceLow = slice / band;
  const fees = (capital >= 150 ? 8 : 4) + 2 * weeks + 2;
  const tbill = (capital * model.tbill_rate * hold) / 365;
  const net = sliceLow - fees - tbill;
  const hours = 0.5 + 0.17 * weeks + 0.25;
  const verdict: FarmEconomics['verdict'] =
    net >= model.farm_min_net_usd && net >= model.farm_min_net_share * capital
      ? 'FARM'
      : net > 0
        ? 'THIN'
        : 'SKIP';
  return {
    capital_usd: capital,
    hold_days: hold,
    slice_usd: round2(slice),
    slice_low_usd: round2(sliceLow),
    fees_usd: round2(fees),
    tbill_usd: round2(tbill),
    net_usd: round2(net),
    hours: round2(hours),
    per_hour_usd: round2(net / hours),
    verdict,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit working.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep it in range.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} onto ${chain}, then put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the native staking asset via ${name} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and take one position in an open market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Place $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the position.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** Format a dollar amount with commas and two decimals, for farm steps. */
function dollars(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. The first step states the
 * verdict and the net dollars; a SKIP plan says so there, before any action.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const capital = econ.capital_usd;
  const hold = econ.hold_days;
  const action = actionFor(p, capital, chain);
  const netLine =
    econ.verdict === 'FARM'
      ? `FARM: this plan nets $${dollars(econ.net_usd)} after $${dollars(econ.fees_usd)} of fees and $${dollars(econ.tbill_usd)} of T-bill cost on $${capital} for ${hold} days, about $${dollars(econ.per_hour_usd)} an active hour (${econ.hours} active hours in all).`
      : econ.verdict === 'THIN'
        ? `THIN: this plan nets only $${dollars(econ.net_usd)} after $${dollars(econ.fees_usd)} of fees and $${dollars(econ.tbill_usd)} of T-bill cost on $${capital} for ${hold} days — it covers its costs but clears neither the $60 nor the 4%-of-capital hurdle.`
        : `SKIP: this plan loses $${dollars(Math.abs(econ.net_usd))} after $${dollars(econ.fees_usd)} of fees and $${dollars(econ.tbill_usd)} of T-bill cost on $${capital} for ${hold} days — the expected slice of $${dollars(econ.slice_low_usd)} at the low end of the model band does not cover the costs, so do not farm it on this plan.`;
  return [
    {
      text: `${netLine} Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline, away from the machine.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week — a deposit, a swap, a borrow, a vote or a claim — so the wallet reads as active, not parked.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw anything, open the protocol's own points or rewards page and claim only from the link it publishes itself.`,
      cost: 'nothing to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash, so you can repeat the position, prove it later, or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  fitted: FittedModel,
  band: number,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; screening: Screening } {
  const index = bySlug(snapshot.protocols);
  const exchanges = exchangeNames(snapshot);
  // Screening counts, in the order screenReason applies them.
  const screening: Screening = {
    total: snapshot.protocols.length,
    has_token: 0,
    pre_token: 0,
    excluded_category: 0,
    versioned_name: 0,
    wrapped_name: 0,
    exchange_name: 0,
    no_category: 0,
    board_rows: 0,
    watchlist_rows: 0,
    early_rows: 0,
  };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      screening.has_token++;
      continue;
    }
    screening.pre_token++;
    const reason = screenReason(p, exchanges);
    if (reason === 'excluded_category') screening.excluded_category++;
    else if (reason === 'versioned_name') screening.versioned_name++;
    else if (reason === 'wrapped_name') screening.wrapped_name++;
    else if (reason === 'exchange_name') screening.exchange_name++;
    else if (reason === 'no_category') screening.no_category++;
  }
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the biggest
  // few — the board exists to find the whole early universe, not a sample of it.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p, exchanges)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(fitted, p, snapshot.as_of, model);
    const econ = farmEconomics(v.implied, p, v.age, band, model);
    return { p, ...v, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    readiness: s.readiness,
    model: {
      fitted_multiple: s.multiple,
      category_offset: round4(s.offset),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_days: s.age,
    },
    farm: s.econ,
    farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
  }));
  screening.board_rows = board.length;
  screening.watchlist_rows = board.filter((r) => snapshot.watchlist.includes(r.slug)).length;
  screening.early_rows = board.length - screening.watchlist_rows;
  return { board, screening };
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    readiness: row.readiness,
    fitted_multiple: row.model.fitted_multiple,
    growth_multiplier: row.model.growth_multiplier,
    verdict: row.farm.verdict,
    net_usd: row.farm.net_usd,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot, the fit and the board. */
export function buildRadar(
  snapshot: Snapshot,
  fitted: FittedModel,
  board: BoardRow[],
  screening: Screening,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const live = liveRows(snapshot);
  const offsets = [...fitted.offsets.entries()]
    .map(([category, offset]) => {
      const peers = compPool(snapshot, model).filter((p) => (p.category ?? '__null') === category).length;
      return { category, offset: round4(offset), peers };
    })
    .sort((a, b) => b.offset - a.offset || (a.category < b.category ? -1 : 1));
  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.farm.verdict]++;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: {
      intercept: round4(fitted.intercept),
      slope_tvl: round4(fitted.slope_tvl),
      slope_age: round4(fitted.slope_age),
      r2: round4(fitted.r2),
      r2_plain: round4(fitted.r2_plain),
      n_comps: fitted.n,
      sigma_log10: round4(fitted.sigma_log10),
      offsets,
    },
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    screening,
    verdict_counts: verdictCounts,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** The board's watchlist rows only, in rank order — the floor the radar starts from. */
export function watchlistRows(board: BoardRow[], snapshot: Snapshot): BoardRow[] {
  const wanted = new Set(snapshot.watchlist);
  return board.filter((r) => wanted.has(r.slug));
}

/** One headline sentence for the board: how many rows, how many of them are the watchlist, and the top implied value. */
export function summaryLine(board: BoardRow[], snapshot: Snapshot): string {
  const top = board[0];
  const topValue = top === undefined ? 0 : top.implied_value_usd;
  const topName = top === undefined ? 'none' : top.name;
  return `${board.length} pre-token protocols ranked, ${snapshot.watchlist.length} of them the watchlist, led by ${topName} at $${topValue.toLocaleString('en-US')} implied.`;
}
