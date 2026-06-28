// Metric snapshots with provenance. The current dashboard stores a single latest scalar
// per metric; the SaaS stores an append-only series so we can analyse velocity (first
// 2/6/12/24/48 h, when it plateaued, repeat waves) and reconcile values from different
// sources WITHOUT one clobbering another.
//
// A snapshot is never overwritten. The "current" value for a metric is chosen by an
// explicit policy (selectCurrent) — NOT a blanket "API beats screenshot", because two
// values can describe different observation times, periods or semantics.

import { metricDef, type MetricSource, type MetricUnit } from './metrics.js'

export type MetricPeriod = 'lifetime' | 'day' | 'week' | 'month' | 'since_publish' | 'unknown'

export interface MetricSnapshot {
  id: string
  workspaceId: string
  accountId: string
  // null contentId => an account-level snapshot.
  contentId: string | null
  metricKey: string
  // null segment => a scalar metric; otherwise a distribution member (e.g. 'foryou').
  segment: string | null
  // null value is a real state ("we looked, the screen showed nothing") and is kept
  // distinct from 0. Selection skips null when a non-null exists for the same slot.
  value: number | null
  unit: MetricUnit
  source: MetricSource
  period: MetricPeriod
  // When the value was true on the platform (the x-axis for velocity).
  observedAt: string
  // When we collected it (audit/debug).
  collectedAt: string
  // 0..1; API/manual are ~1, screenshot extraction carries the model's confidence.
  confidence: number
  // The user (or API) confirmed this value. Unconfirmed screenshot extractions wait.
  confirmed: boolean
  screenshotId: string | null
  extractionVersion: string | null
  // Pointer into raw_api_payloads (we keep raw payloads so a value can be re-derived).
  rawPayloadRef: string | null
}

export type SnapshotInput = Omit<MetricSnapshot, 'id' | 'collectedAt'> &
  Partial<Pick<MetricSnapshot, 'id' | 'collectedAt'>>

// How much we trust a source when two values tie on recency/confirmation. This is a
// TIE-BREAKER only — recency and confirmation dominate (see selectCurrent).
const SOURCE_TRUST: Record<MetricSource, number> = {
  manual: 5, // an explicit human correction wins ties
  instagram_api: 4,
  tiktok_api: 4,
  provider: 3,
  screenshot: 2,
  derived: 1,
}

const isFiniteNum = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v)

// Identity slot a value competes within: same metric + segment + period for the same
// content/account. Values across different periods do NOT compete (they mean different
// things) — the caller asks for the period it wants.
export function snapshotSlot(s: Pick<MetricSnapshot, 'metricKey' | 'segment' | 'period' | 'contentId' | 'accountId'>): string {
  return [s.accountId, s.contentId ?? '∅', s.metricKey, s.segment ?? '∅', s.period].join('|')
}

export interface SelectOptions {
  // Restrict to a period; default: prefer 'since_publish'/'lifetime' but accept any.
  period?: MetricPeriod
  // If true, an unconfirmed value can still be selected (e.g. to preview). Default false:
  // only confirmed values become the canonical current value.
  allowUnconfirmed?: boolean
}

// Pick the current value for one metric slot from its snapshot history.
// Policy, in order: (1) confirmed beats unconfirmed; (2) non-null beats null;
// (3) later observedAt wins; (4) higher confidence; (5) more-trusted source.
export function selectCurrent(
  snapshots: MetricSnapshot[],
  opts: SelectOptions = {},
): MetricSnapshot | null {
  let pool = snapshots
  if (opts.period) pool = pool.filter((s) => s.period === opts.period)
  // By default only confirmed values are eligible to become the canonical current value;
  // if none are confirmed the slot has no current value (null), it is NOT silently filled
  // from an unconfirmed extraction.
  if (!opts.allowUnconfirmed) pool = pool.filter((s) => s.confirmed)
  if (!pool.length) return null
  const better = (a: MetricSnapshot, b: MetricSnapshot): MetricSnapshot => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? a : b
    const aNull = a.value === null
    const bNull = b.value === null
    if (aNull !== bNull) return aNull ? b : a
    if (a.observedAt !== b.observedAt) return a.observedAt > b.observedAt ? a : b
    if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b
    return SOURCE_TRUST[a.source] >= SOURCE_TRUST[b.source] ? a : b
  }
  return pool.reduce((best, s) => better(best, s))
}

// Group a flat snapshot list into slots and resolve the current value of each.
export function currentValues(snapshots: MetricSnapshot[], opts: SelectOptions = {}): Map<string, MetricSnapshot> {
  const bySlot = new Map<string, MetricSnapshot[]>()
  for (const s of snapshots) {
    const slot = snapshotSlot(s)
    bySlot.set(slot, [...(bySlot.get(slot) || []), s])
  }
  const out = new Map<string, MetricSnapshot>()
  for (const [slot, list] of bySlot) {
    const current = selectCurrent(list, opts)
    if (current) out.set(slot, current)
  }
  return out
}

// Which canonical metric keys have a usable (confirmed, non-null) current value for a
// content item — the input the requirement engine needs to know what's still missing.
export function presentMetricKeys(snapshots: MetricSnapshot[], contentId: string): Set<string> {
  const present = new Set<string>()
  const forContent = snapshots.filter((s) => s.contentId === contentId)
  for (const [, snap] of currentValues(forContent)) {
    if (snap.value !== null) present.add(snap.metricKey)
  }
  return present
}

export interface FoldedMetrics {
  // Maps onto EntryMetrics fields the existing dashboard consumes.
  metrics: Record<string, number | null>
  // Maps onto the flat whole-percent extraMetrics convention used by src/lib.ts.
  extraMetrics: Record<string, number>
  // Per-field provenance, so the UI can show an API/Screenshot/Manual/Derived badge.
  provenance: Record<string, MetricSource>
}

// Canonical key -> the EntryMetrics field name used by derive.ts / the dashboard.
const CANON_TO_ENTRY: Record<string, string> = {
  views: 'views',
  reach: 'reach',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
  follows: 'follows',
  profile_visits: 'profileVisits',
  average_watch_time: 'averageWatchTimeSec',
  total_play_time: 'totalPlayTimeSec',
  skip_rate: 'skipRate',
  completion_rate: 'completionRate',
  // `reposts` and `duration` are handled by the entry directly; kept out to avoid clobber.
}

// Project a content item's snapshots back into the EntryMetrics + extraMetrics shape the
// current analytics layer already understands. This is the bridge that lets API- and
// screenshot-sourced values flow into the EXISTING dashboard without touching src/lib.ts.
export function foldSnapshotsToMetrics(snapshots: MetricSnapshot[], contentId: string): FoldedMetrics {
  const metrics: Record<string, number | null> = {}
  const extraMetrics: Record<string, number> = {}
  const provenance: Record<string, MetricSource> = {}
  const current = currentValues(snapshots.filter((s) => s.contentId === contentId))

  for (const [, snap] of current) {
    const def = metricDef(snap.metricKey)
    if (!def) continue
    if (def.kind === 'distribution') {
      if (snap.segment && def.extraKey && snap.value !== null) {
        const key = def.extraKey(snap.segment)
        extraMetrics[key] = snap.value
        provenance[key] = snap.source
      }
      continue
    }
    const entryField = CANON_TO_ENTRY[snap.metricKey]
    if (!entryField) continue
    metrics[entryField] = snap.value
    provenance[entryField] = snap.source
  }
  return { metrics, extraMetrics, provenance }
}

export function makeSnapshot(input: SnapshotInput, id: string, now: string): MetricSnapshot {
  return {
    id: input.id || id,
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    contentId: input.contentId,
    metricKey: input.metricKey,
    segment: input.segment ?? null,
    value: isFiniteNum(input.value ?? null) ? input.value : input.value === 0 ? 0 : input.value,
    unit: input.unit,
    source: input.source,
    period: input.period,
    observedAt: input.observedAt,
    collectedAt: input.collectedAt || now,
    confidence: input.confidence,
    confirmed: input.confirmed,
    screenshotId: input.screenshotId ?? null,
    extractionVersion: input.extractionVersion ?? null,
    rawPayloadRef: input.rawPayloadRef ?? null,
  }
}
