// Dynamic requirement engine for Manual Analytics Completion ("Досбор данных").
//
// It does NOT hard-code one screenshot checklist. For each content item it asks the
// metric registry + the connected platform's capabilities which metrics can arrive via
// the API (and so should NOT be asked for), which must come from a screenshot, which are
// derivable, and which are simply unsupported — then builds the smallest set of screenshot
// tasks, age-gated so we never ask before the analytics have formed. Re-run after every
// API sync: a metric the API later returns drops out of the task automatically.

import {
  METRIC_DEFINITIONS,
  metricDef,
  type ScreenType,
  type SocialPlatform,
} from './metrics.js'
import type { ConnectorCapabilities } from './connectors/types.js'

export type ExpectedSource = 'api' | 'screenshot' | 'derived' | 'manual' | 'unsupported'

export interface MissingMetric {
  key: string
  label: string
  critical: boolean
  expectedSource: ExpectedSource
  screen: ScreenType | null
  // When the value becomes meaningful (publish + availableAfterHours). null for account.
  dueAt: string | null
  // true when now < dueAt (don't ask yet).
  tooEarly: boolean
}

export type TaskStatus =
  | 'needs_screenshots'
  | 'partially_completed'
  | 'scheduled' // all required screens still too early
  | 'awaiting_api' // only API-fillable metrics remain
  | 'completed'
  | 'no_longer_required'

export type TaskLevel = 'content' | 'account'

export interface CompletionTask {
  id: string
  level: TaskLevel
  workspaceId: string
  accountId: string
  contentId: string | null
  platform: SocialPlatform
  title: string
  status: TaskStatus
  missing: MissingMetric[]
  screens: ScreenType[]
  screenshotCount: number
  priority: number
  publishedAt: string | null
  dueAt: string | null
  caption: string
  thumbnailUrl: string | null
  model: string
}

export interface ContentForCompletion {
  contentId: string
  workspaceId: string
  accountId: string
  platform: SocialPlatform
  publishedAt: string
  caption: string
  thumbnailUrl: string | null
  model: string
}

export interface AccountForCompletion {
  accountId: string
  workspaceId: string
  platform: SocialPlatform
  username: string
  // ISO timestamp of the most recent confirmed audience snapshot, or null if never.
  lastAudienceAt: string | null
}

export interface CompletionOptions {
  now: string
  // A live API connector is attached (so API-fillable metrics are not asked for).
  hasApiConnector: boolean
  capabilities: ConnectorCapabilities | null
  // Minimum hours after publish before we surface ANY content screenshot task.
  minContentAgeHours?: number
  // Re-ask account audience after this many days.
  accountAudienceMaxAgeDays?: number
}

const hoursBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return (to - from) / 3_600_000
}

const addHours = (iso: string, hours: number): string => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + hours * 3_600_000).toISOString() : iso
}

// Where a metric is expected to come from for THIS platform, given whether an API
// connector is attached. An API-capable metric with no connector falls back to a
// screenshot (if screenshotable) or manual entry.
export function expectedSourceFor(
  key: string,
  platform: SocialPlatform,
  hasApiConnector: boolean,
  capabilities: ConnectorCapabilities | null,
): ExpectedSource {
  const def = metricDef(key)
  if (!def) return 'unsupported'
  const a = def.availability[platform]
  if (!a) return 'unsupported'
  if (a.unsupported) return 'unsupported'
  const apiCanDeliver =
    a.api && hasApiConnector && (!capabilities || capabilities.apiContentMetrics.includes(key) || capabilities.apiAccountMetrics.includes(key))
  if (apiCanDeliver) return 'api'
  if (a.screenshot) return 'screenshot'
  if (a.derived) return 'derived'
  return 'manual'
}

function missingFor(
  level: TaskLevel,
  platform: SocialPlatform,
  present: Set<string>,
  publishedAt: string | null,
  opts: CompletionOptions,
): MissingMetric[] {
  const out: MissingMetric[] = []
  for (const def of METRIC_DEFINITIONS) {
    if (def.level !== level) continue
    if (present.has(def.key)) continue
    const expectedSource = expectedSourceFor(def.key, platform, opts.hasApiConnector, opts.capabilities)
    if (expectedSource === 'unsupported' || expectedSource === 'derived') continue
    const a = def.availability[platform]
    const dueAt = level === 'content' && publishedAt ? addHours(publishedAt, a.availableAfterHours || 0) : null
    const tooEarly = dueAt ? Date.parse(opts.now) < Date.parse(dueAt) : false
    out.push({
      key: def.key,
      label: def.label,
      critical: def.critical,
      expectedSource,
      screen: a.screen && a.screen !== 'none' ? a.screen : null,
      dueAt,
      tooEarly,
    })
  }
  return out
}

function statusFor(
  missing: MissingMetric[],
  screenshotMetrics: MissingMetric[],
  screenshotExpectedPresent: boolean,
): TaskStatus {
  if (!missing.length) return 'completed'
  if (!screenshotMetrics.length) return 'awaiting_api'
  if (screenshotExpectedPresent && screenshotMetrics.some((m) => !m.tooEarly)) return 'partially_completed'
  if (screenshotMetrics.every((m) => m.tooEarly)) return 'scheduled'
  return 'needs_screenshots'
}

// True when at least one metric whose EXPECTED source on this platform is a screenshot is
// already present — i.e. a real earlier screenshot, not an API value that merely happens to
// also be screenshotable.
function hasScreenshotSourcedValue(
  level: TaskLevel,
  platform: SocialPlatform,
  present: Set<string>,
  opts: CompletionOptions,
): boolean {
  return METRIC_DEFINITIONS.some(
    (d) =>
      d.level === level &&
      present.has(d.key) &&
      expectedSourceFor(d.key, platform, opts.hasApiConnector, opts.capabilities) === 'screenshot',
  )
}

// Build the single content-level task for one reel. `present` = canonical metric keys that
// already have a confirmed value (from API sync or earlier screenshots).
export function computeContentTask(
  content: ContentForCompletion,
  present: Set<string>,
  opts: CompletionOptions,
): CompletionTask {
  const minAge = opts.minContentAgeHours ?? 18
  const missing = missingFor('content', content.platform, present, content.publishedAt, opts)
  const screenshotMetrics = missing.filter((m) => m.expectedSource === 'screenshot')
  const dueable = screenshotMetrics.filter((m) => !m.tooEarly)
  const screens = [...new Set(dueable.map((m) => m.screen).filter((s): s is ScreenType => Boolean(s)))]
  const screenshotPresent = hasScreenshotSourcedValue('content', content.platform, present, opts)
  const status = statusFor(missing, screenshotMetrics, screenshotPresent)

  const ageH = hoursBetween(content.publishedAt, opts.now)
  const tooYoung = ageH < minAge
  const criticalMissing = screenshotMetrics.filter((m) => m.critical).length

  // Priority: critical screenshot gaps dominate; fresh reels and partially-filled tasks
  // bubble up; nothing is surfaced before it is due.
  let priority = 0
  if (status === 'needs_screenshots' || status === 'partially_completed') {
    priority += criticalMissing * 10 + screenshotMetrics.length
    if (ageH <= 72) priority += 6
    else if (ageH <= 168) priority += 3
    if (status === 'partially_completed') priority += 4
  }

  const dueAt = screenshotMetrics.length
    ? screenshotMetrics.map((m) => m.dueAt).filter(Boolean).sort()[0] || null
    : null

  return {
    id: `content:${content.contentId}`,
    level: 'content',
    workspaceId: content.workspaceId,
    accountId: content.accountId,
    contentId: content.contentId,
    platform: content.platform,
    title: content.caption ? content.caption.slice(0, 80) : content.contentId,
    status: tooYoung && status === 'needs_screenshots' ? 'scheduled' : status,
    missing,
    screens,
    screenshotCount: screens.length,
    priority,
    publishedAt: content.publishedAt,
    dueAt: tooYoung ? addHours(content.publishedAt, minAge) : dueAt,
    caption: content.caption,
    thumbnailUrl: content.thumbnailUrl,
    model: content.model,
  }
}

// Build the account-level audience task (one per account+period, NEVER per reel).
export function computeAccountTask(
  account: AccountForCompletion,
  present: Set<string>,
  opts: CompletionOptions,
): CompletionTask {
  const maxAgeDays = opts.accountAudienceMaxAgeDays ?? 30
  const missing = missingFor('account', account.platform, present, null, opts)
  const screenshotMetrics = missing.filter((m) => m.expectedSource === 'screenshot')
  const screens = [...new Set(screenshotMetrics.map((m) => m.screen).filter((s): s is ScreenType => Boolean(s)))]

  const stale = account.lastAudienceAt
    ? hoursBetween(account.lastAudienceAt, opts.now) / 24 >= maxAgeDays
    : true

  let status: TaskStatus = 'completed'
  if (screenshotMetrics.length) status = stale ? 'needs_screenshots' : 'completed'
  else if (missing.length) status = 'awaiting_api'

  let priority = 0
  if (status === 'needs_screenshots') {
    priority += 2 + screenshotMetrics.length
    if (!account.lastAudienceAt) priority += 4
  }

  return {
    id: `account:${account.accountId}`,
    level: 'account',
    workspaceId: account.workspaceId,
    accountId: account.accountId,
    contentId: null,
    platform: account.platform,
    title: `Аудитория аккаунта @${account.username}`,
    status,
    missing,
    screens,
    screenshotCount: screens.length,
    priority,
    publishedAt: null,
    dueAt: null,
    caption: '',
    thumbnailUrl: null,
    model: '',
  }
}

// Sort tasks the owner should act on first to the top, hiding completed / not-yet-due.
export function prioritizeTasks(tasks: CompletionTask[]): CompletionTask[] {
  const actionable = (t: CompletionTask) =>
    t.status === 'needs_screenshots' || t.status === 'partially_completed'
  return [...tasks].sort((a, b) => {
    if (actionable(a) !== actionable(b)) return actionable(a) ? -1 : 1
    if (b.priority !== a.priority) return b.priority - a.priority
    return (b.publishedAt || '').localeCompare(a.publishedAt || '')
  })
}

export interface Completeness {
  apiCoverage: number // 0..1 of API-expected metrics that are present
  screenshotCoverage: number // 0..1 of screenshot-expected metrics that are present
  missingCritical: string[]
  overall: number // critical-weighted 0..1
  recommendationConfidence: 'high' | 'medium' | 'low'
}

// Completeness is NOT a flat field percentage — critical metrics weigh 3×.
export function contentCompleteness(
  content: ContentForCompletion,
  present: Set<string>,
  opts: CompletionOptions,
): Completeness {
  const defs = METRIC_DEFINITIONS.filter((d) => d.level === 'content')
  let apiTotal = 0
  let apiHave = 0
  let shotTotal = 0
  let shotHave = 0
  let weighted = 0
  let weightedHave = 0
  const missingCritical: string[] = []

  for (const def of defs) {
    const src = expectedSourceFor(def.key, content.platform, opts.hasApiConnector, opts.capabilities)
    if (src === 'unsupported' || src === 'derived') continue
    const have = present.has(def.key)
    const weight = def.critical ? 3 : 1
    weighted += weight
    if (have) weightedHave += weight
    else if (def.critical) missingCritical.push(def.key)
    if (src === 'api') {
      apiTotal += 1
      if (have) apiHave += 1
    } else {
      shotTotal += 1
      if (have) shotHave += 1
    }
  }

  const overall = weighted ? weightedHave / weighted : 1
  const recommendationConfidence = missingCritical.length === 0 ? 'high' : missingCritical.length <= 2 ? 'medium' : 'low'
  return {
    apiCoverage: apiTotal ? apiHave / apiTotal : 1,
    screenshotCoverage: shotTotal ? shotHave / shotTotal : 1,
    missingCritical,
    overall,
    recommendationConfidence,
  }
}
