// Canonical metric registry — the single source of truth for "what AI Dash measures",
// independent of any platform payload. Connectors map platform fields onto these keys;
// the requirement engine asks this registry "can platform X deliver metric M via the
// API, or must it come from a screenshot?"; the analytics layer keeps consuming the
// existing PostRecord shape unchanged.
//
// Availability flags here are the PLANNING DEFAULT and are reconciled with the verified
// research in docs/social-api-feasibility.md. They encode the conservative reality:
// Instagram (Business/Creator via Instagram Login) exposes rich Reel insights through the
// API; TikTok's Login Kit + Display API exposes only basic counts, so depth metrics are
// screenshot-assisted. Nothing here is inferred from unrelated endpoints.

export type SocialPlatform = 'instagram' | 'tiktok'

export type MetricSource =
  | 'instagram_api'
  | 'tiktok_api'
  | 'provider'
  | 'screenshot'
  | 'manual'
  | 'derived'

export type MetricKind = 'count' | 'rate' | 'duration' | 'percent' | 'distribution'
export type MetricLevel = 'content' | 'account'
export type MetricUnit = 'count' | 'seconds' | 'percent' | 'fraction'

// The stat screen a value is read from when it is screenshot-assisted. Drives the guide
// shown in the mobile wizard and which metrics a given screenshot is allowed to yield.
export type ScreenType =
  | 'ig_reel_insights'
  | 'ig_account_insights'
  | 'ig_audience'
  | 'tt_post_overview'
  | 'tt_post_viewers'
  | 'tt_account_overview'
  | 'tt_account_followers'
  | 'none'

export interface PlatformAvailability {
  // The platform's OFFICIAL API for a connected creator can return this value.
  api: boolean
  // Obtainable by reading a stat screen (the screenshot fallback).
  screenshot: boolean
  // Computable from other present metrics (e.g. VTR = avg watch / duration).
  derived?: boolean
  // Semantically not exposed by this platform at all (kept distinct from "screenshot").
  unsupported?: boolean
  screen?: ScreenType
  // Hours after publish before the value is meaningful/stable (don't ask too early).
  availableAfterHours?: number
}

export interface MetricDefinition {
  key: string
  label: string
  level: MetricLevel
  kind: MetricKind
  unit: MetricUnit
  // Critical metrics carry more weight in completeness + task priority. A reel missing a
  // critical metric is worth a screenshot prompt; a nice-to-have is not.
  critical: boolean
  // For kind === 'distribution': the segment labels and how each maps to the existing
  // flat extraMetrics key convention consumed by src/lib.ts (whole-percent 0..100).
  segments?: string[]
  extraKey?: (segment: string) => string
  availability: Record<SocialPlatform, PlatformAvailability>
}

const both = (ig: PlatformAvailability, tt: PlatformAvailability) => ({ instagram: ig, tiktok: tt })

// Convenience builders for the common availability shapes.
const apiIg = (screen: ScreenType, hours = 24): PlatformAvailability => ({ api: true, screenshot: true, screen, availableAfterHours: hours })
const shotIg = (screen: ScreenType, hours = 24): PlatformAvailability => ({ api: false, screenshot: true, screen, availableAfterHours: hours })
const apiTt = (): PlatformAvailability => ({ api: true, screenshot: true, screen: 'tt_post_overview', availableAfterHours: 24 })
const shotTt = (screen: ScreenType, hours = 48): PlatformAvailability => ({ api: false, screenshot: true, screen, availableAfterHours: hours })

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // ---- content-level scalars ----
  { key: 'views', label: 'Просмотры', level: 'content', kind: 'count', unit: 'count', critical: true,
    availability: both(apiIg('ig_reel_insights'), apiTt()) },
  { key: 'reach', label: 'Охват (Total viewers)', level: 'content', kind: 'count', unit: 'count', critical: true,
    availability: both(apiIg('ig_reel_insights'), shotTt('tt_post_viewers')) },
  { key: 'duration', label: 'Длительность', level: 'content', kind: 'duration', unit: 'seconds', critical: false,
    availability: both({ api: true, screenshot: false, screen: 'none', availableAfterHours: 0 }, { api: true, screenshot: false, screen: 'none', availableAfterHours: 0 }) },
  { key: 'average_watch_time', label: 'Среднее время просмотра', level: 'content', kind: 'duration', unit: 'seconds', critical: true,
    availability: both(apiIg('ig_reel_insights'), shotTt('tt_post_overview')) },
  { key: 'total_play_time', label: 'Суммарное время просмотра', level: 'content', kind: 'duration', unit: 'seconds', critical: false,
    availability: both(apiIg('ig_reel_insights'), shotTt('tt_post_overview')) },
  { key: 'completion_rate', label: 'Досмотр до конца', level: 'content', kind: 'rate', unit: 'fraction', critical: true,
    availability: both({ api: false, screenshot: false, unsupported: true, screen: 'none' }, shotTt('tt_post_overview')) },
  { key: 'retention_rate', label: 'Удержание (VTR)', level: 'content', kind: 'rate', unit: 'fraction', critical: true,
    availability: both({ api: false, screenshot: true, derived: true, screen: 'ig_reel_insights' }, { api: false, screenshot: true, derived: true, screen: 'tt_post_overview' }) },
  { key: 'hold_rate', label: 'Удержание после 3 c', level: 'content', kind: 'rate', unit: 'fraction', critical: false,
    availability: both(shotIg('ig_reel_insights'), shotTt('tt_post_overview')) },
  { key: 'skip_rate', label: 'Доля пропусков', level: 'content', kind: 'rate', unit: 'fraction', critical: false,
    availability: both(shotIg('ig_reel_insights'), shotTt('tt_post_overview')) },
  { key: 'likes', label: 'Лайки', level: 'content', kind: 'count', unit: 'count', critical: false,
    availability: both(apiIg('ig_reel_insights'), apiTt()) },
  { key: 'comments', label: 'Комментарии', level: 'content', kind: 'count', unit: 'count', critical: false,
    availability: both(apiIg('ig_reel_insights'), apiTt()) },
  { key: 'shares', label: 'Репосты', level: 'content', kind: 'count', unit: 'count', critical: false,
    availability: both(apiIg('ig_reel_insights'), apiTt()) },
  { key: 'saves', label: 'Сохранения', level: 'content', kind: 'count', unit: 'count', critical: false,
    availability: both(apiIg('ig_reel_insights'), shotTt('tt_post_overview')) },
  { key: 'total_engagements', label: 'Все вовлечения', level: 'content', kind: 'count', unit: 'count', critical: false,
    availability: both({ api: false, screenshot: false, derived: true, screen: 'none' }, { api: false, screenshot: false, derived: true, screen: 'none' }) },
  { key: 'profile_visits', label: 'Заходы в профиль с ролика', level: 'content', kind: 'count', unit: 'count', critical: true,
    // TikTok doesn't expose a per-video profile-visits COUNT (only "Personal profile" as a
    // traffic source %); on IG it's on the Reel insights screen.
    availability: both(shotIg('ig_reel_insights'), { api: false, screenshot: false, unsupported: true, screen: 'none' }) },
  { key: 'follows', label: 'Подписки с ролика (New followers)', level: 'content', kind: 'count', unit: 'count', critical: true,
    availability: both(shotIg('ig_reel_insights'), shotTt('tt_post_overview')) },

  // ---- content-level distributions (map onto the existing extraMetrics keys) ----
  { key: 'traffic_sources', label: 'Источники трафика', level: 'content', kind: 'distribution', unit: 'percent', critical: true,
    segments: ['foryou', 'search', 'personalprofile', 'sound', 'following', 'other'],
    extraKey: (s) => `traffic_${s}_pct`,
    availability: both(shotIg('ig_reel_insights'), shotTt('tt_post_overview')) },
  { key: 'viewer_type', label: 'Тип зрителя', level: 'content', kind: 'distribution', unit: 'percent', critical: false,
    segments: ['new_viewers', 'returning_viewers'],
    extraKey: (s) => `${s}_pct`,
    availability: both(shotIg('ig_reel_insights'), shotTt('tt_post_viewers')) },
  { key: 'follower_status', label: 'Подписчики vs не подписаны', level: 'content', kind: 'distribution', unit: 'percent', critical: false,
    segments: ['followers', 'nonfollowers'],
    extraKey: (s) => `${s}_pct`,
    availability: both(shotIg('ig_reel_insights'), shotTt('tt_post_viewers')) },
  { key: 'viewer_gender', label: 'Пол зрителей', level: 'content', kind: 'distribution', unit: 'percent', critical: false,
    segments: ['male', 'female', 'other'],
    extraKey: (s) => `gender_${s}_pct`,
    availability: both(shotIg('ig_audience'), shotTt('tt_post_viewers')) },
  { key: 'viewer_age', label: 'Возраст зрителей', level: 'content', kind: 'distribution', unit: 'percent', critical: false,
    segments: ['13_17', '18_24', '25_34', '35_44', '45_54', '55plus'],
    extraKey: (s) => `age_${s}_pct`,
    availability: both(shotIg('ig_audience'), shotTt('tt_post_viewers')) },
  { key: 'viewer_geo', label: 'География зрителей', level: 'content', kind: 'distribution', unit: 'percent', critical: false,
    // geo segments are open-ended country codes; extraKey takes the cc.
    extraKey: (cc) => `geo_${cc}_pct`,
    availability: both(shotIg('ig_audience'), shotTt('tt_post_viewers')) },

  // ---- account-level ----
  { key: 'follower_count', label: 'Подписчики аккаунта', level: 'account', kind: 'count', unit: 'count', critical: false,
    availability: both({ api: true, screenshot: true, screen: 'ig_account_insights' }, { api: true, screenshot: true, screen: 'tt_account_overview' }) },
  { key: 'account_reach', label: 'Охват аккаунта (период)', level: 'account', kind: 'count', unit: 'count', critical: false,
    availability: both(apiIg('ig_account_insights', 0), shotTt('tt_account_overview')) },
  { key: 'follower_gender', label: 'Пол подписчиков', level: 'account', kind: 'distribution', unit: 'percent', critical: false,
    segments: ['male', 'female', 'other'],
    extraKey: (s) => `follower_gender_${s}_pct`,
    availability: both(apiIg('ig_audience', 0), shotTt('tt_account_followers')) },
  { key: 'follower_age', label: 'Возраст подписчиков', level: 'account', kind: 'distribution', unit: 'percent', critical: false,
    segments: ['13_17', '18_24', '25_34', '35_44', '45_54', '55plus'],
    extraKey: (s) => `follower_age_${s}_pct`,
    availability: both(apiIg('ig_audience', 0), shotTt('tt_account_followers')) },
  { key: 'follower_geo', label: 'География подписчиков', level: 'account', kind: 'distribution', unit: 'percent', critical: false,
    extraKey: (cc) => `follower_geo_${cc}_pct`,
    availability: both(apiIg('ig_audience', 0), shotTt('tt_account_followers')) },
  { key: 'follower_active_times', label: 'Активность подписчиков по времени', level: 'account', kind: 'distribution', unit: 'percent', critical: false,
    availability: both(shotIg('ig_audience', 0), shotTt('tt_account_followers')) },
]

const BY_KEY = new Map(METRIC_DEFINITIONS.map((m) => [m.key, m]))

export function metricDef(key: string): MetricDefinition | null {
  return BY_KEY.get(key) || null
}

export function allMetricKeys(): string[] {
  return METRIC_DEFINITIONS.map((m) => m.key)
}

export function metricLabelMap(): Record<string, string> {
  return Object.fromEntries(METRIC_DEFINITIONS.map((m) => [m.key, m.label]))
}

// Metrics a given stat screen is expected to yield ON A SPECIFIC PLATFORM (screenshot,
// not API). Drives the "what to capture" list and the post-upload completeness check.
export function expectedScreenshotMetrics(screen: ScreenType, platform: SocialPlatform): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((m) => {
    const a = m.availability[platform]
    // Derived metrics (e.g. VTR = avg watch / duration) are computed, never required as a
    // screenshot — exclude them from the "must capture" set.
    return a && a.screen === screen && a.screenshot && !a.api && !a.unsupported && !a.derived
  })
}

export function criticalMetricKeys(level?: MetricLevel): string[] {
  return METRIC_DEFINITIONS.filter((m) => m.critical && (!level || m.level === level)).map((m) => m.key)
}

// True when the platform's official API can deliver this metric for a connected creator.
export function isApiAvailable(key: string, platform: SocialPlatform): boolean {
  return Boolean(metricDef(key)?.availability[platform]?.api)
}

// True when the metric is screenshot-assisted on this platform (not API, not unsupported).
export function isScreenshotMetric(key: string, platform: SocialPlatform): boolean {
  const a = metricDef(key)?.availability[platform]
  return Boolean(a && !a.api && a.screenshot && !a.unsupported)
}

export function isUnsupported(key: string, platform: SocialPlatform): boolean {
  return Boolean(metricDef(key)?.availability[platform]?.unsupported)
}

// All metrics whose screenshot fallback lives on a given stat screen — drives "one screen
// → these values" extraction whitelisting and the wizard's per-screen instructions.
export function metricsForScreen(screen: ScreenType): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((m) => {
    return (Object.keys(m.availability) as SocialPlatform[]).some((p) => {
      const a = m.availability[p]
      return a.screen === screen && a.screenshot && !a.api
    })
  })
}

// The distinct screens needed to fill a set of screenshot-assisted metric keys on a platform.
export function screensFor(keys: string[], platform: SocialPlatform): ScreenType[] {
  const screens = new Set<ScreenType>()
  for (const key of keys) {
    const a = metricDef(key)?.availability[platform]
    if (a && a.screenshot && !a.api && a.screen && a.screen !== 'none') screens.add(a.screen)
  }
  return [...screens]
}
