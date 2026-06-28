import type {
  AudienceRecord,
  Filters,
  Insight,
  InsightMetric,
  InsightReel,
  Platform,
  PostRecord,
} from './types'

const compact = <T>(values: Array<T | null | undefined>) =>
  values.filter((value): value is T => value !== null && value !== undefined)

export const formatNumber = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)

export const formatPercent = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('ru-RU', {
        style: 'percent',
        maximumFractionDigits: digits,
      }).format(value)

export const formatDate = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date)
}

export const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export function median(values: Array<number | null | undefined>) {
  const sorted = compact(values).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const sum = (values: Array<number | null | undefined>) =>
  compact(values).reduce((total, value) => total + value, 0)

const average = (values: Array<number | null | undefined>) => {
  const present = compact(values)
  return present.length ? sum(present) / present.length : null
}

export function filterPosts(posts: PostRecord[], filters: Filters) {
  return posts.filter((post) => {
    if (post.recordType !== 'LIVE') return false
    if (filters.platform && post.platform !== filters.platform) return false
    if (filters.account && post.account !== filters.account) return false
    if (filters.model && post.model !== filters.model) return false
    if (filters.format && post.format !== filters.format) return false
    if (filters.hook && getHookLabel(post) !== filters.hook) return false
    if (filters.tag && !post.tags.some((tag) => tag.toLowerCase() === filters.tag.toLowerCase()))
      return false
    if (filters.dateFrom && post.publishedAt && post.publishedAt.slice(0, 10) < filters.dateFrom)
      return false
    if (filters.dateTo && post.publishedAt && post.publishedAt.slice(0, 10) > filters.dateTo)
      return false
    if (filters.duration) {
      const duration = post.duration
      if (duration === null) return false
      if (filters.duration === 'short' && duration > 7) return false
      if (filters.duration === 'medium' && (duration <= 7 || duration > 15)) return false
      if (filters.duration === 'long' && (duration <= 15 || duration > 30)) return false
      if (filters.duration === 'extra' && duration <= 30) return false
    }
    return true
  })
}

// A rate where the numerator and denominator are summed over the SAME posts — only
// those where both values are present. This stops a views=null post from inflating a
// rate and a metric=null post from deflating it.
function ratioOver(
  posts: PostRecord[],
  numerator: (post: PostRecord) => number | null,
  denominator: (post: PostRecord) => number | null,
) {
  let totalNumerator = 0
  let totalDenominator = 0
  let counted = false
  for (const post of posts) {
    const num = numerator(post)
    const den = denominator(post)
    if (num === null || den === null) continue
    totalNumerator += num
    totalDenominator += den
    counted = true
  }
  return counted && totalDenominator > 0 ? totalNumerator / totalDenominator : null
}

const shareSavePaired = (post: PostRecord) =>
  post.shares === null || post.saves === null ? null : post.shares + post.saves

export function summarize(posts: PostRecord[]) {
  const ig = posts.filter((post) => post.platform === 'Instagram')
  const tt = posts.filter((post) => post.platform === 'TikTok')
  return {
    count: posts.length,
    views: sum(posts.map((post) => post.views)),
    medianViews: median(posts.map((post) => post.views)),
    meanViews: average(posts.map((post) => post.views)),
    follows: sum(posts.map((post) => post.follows)),
    retention: average(posts.map((post) => post.retentionRate)),
    engagementRate: ratioOver(posts, (post) => post.totalEngagements, (post) => post.views),
    shareSaveRate: ratioOver(posts, shareSavePaired, (post) => post.views),
    followConversion: ratioOver(posts, (post) => post.follows, (post) => post.views),
    // Reach-based aggregates (the ones the UI shows as ER / Share+Save / Follow conv.):
    // engagements over unique viewers, matching IG and consistent cross-platform.
    engagementRateByReach: ratioOver(posts, (post) => post.totalEngagements, reachBase),
    shareSaveRateByReach: ratioOver(posts, shareSavePaired, reachBase),
    followConversionByReach: ratioOver(posts, (post) => post.follows, reachBase),
    holdRate: average(ig.map((post) => post.holdRate)),
    completionRate: average(tt.map((post) => post.completionRate)),
  }
}

// Reach with a views fallback — the denominator for all reach-based rates.
const reachBase = (post: PostRecord) => post.reach ?? post.views

export function mean(values: Array<number | null | undefined>) {
  return average(values)
}

export function stdev(values: Array<number | null | undefined>) {
  const present = compact(values)
  if (present.length < 2) return null
  const avg = present.reduce((total, value) => total + value, 0) / present.length
  const variance =
    present.reduce((total, value) => total + (value - avg) ** 2, 0) / present.length
  return Math.sqrt(variance)
}

// Rank-based percentile (0..1): share of the cohort at or below `value`, counting
// ties as half so identical values don't all land at 100%.
export function percentileOf(values: Array<number | null | undefined>, value: number) {
  const present = compact(values)
  if (!present.length) return null
  const below = present.filter((item) => item < value).length
  const equal = present.filter((item) => item === value).length
  return (below + equal / 2) / present.length
}

export function zScore(value: number, avg: number | null, sd: number | null) {
  if (avg === null || sd === null || sd === 0) return null
  return (value - avg) / sd
}

export interface MetricComparison {
  value: number
  count: number
  median: number | null
  mean: number | null
  percentile: number | null
  deviationFromMedian: number | null
  z: number | null
  rank: number | null
  isOutlier: boolean
}

// Compare one reel's metric against a cohort (e.g. same model, same platform).
export function comparePostMetric(
  value: number | null,
  cohort: PostRecord[],
  getValue: (post: PostRecord) => number | null,
): MetricComparison | null {
  if (value === null) return null
  const values = cohort.map(getValue)
  const present = compact(values)
  const cohortMedian = median(values)
  const cohortMean = average(values)
  const sd = stdev(values)
  const z = zScore(value, cohortMean, sd)
  const rank = present.length
    ? present.filter((item) => item > value).length + 1
    : null
  return {
    value,
    count: present.length,
    median: cohortMedian,
    mean: cohortMean,
    percentile: percentileOf(values, value),
    deviationFromMedian: cohortMedian ? value / cohortMedian - 1 : null,
    z,
    rank,
    isOutlier: z !== null && Math.abs(z) >= 2,
  }
}

// Flag individual reels whose views are statistical outliers across the LIVE set.
export function detectViewOutliers(posts: PostRecord[]) {
  const live = posts.filter((post) => post.recordType === 'LIVE' && post.views !== null)
  if (live.length < 5) return [] as Array<{ post: PostRecord; z: number; direction: 'high' | 'low' }>
  const views = live.map((post) => post.views)
  const avg = average(views)
  const sd = stdev(views)
  if (avg === null || sd === null || sd === 0) return []
  return live
    .map((post) => ({ post, z: ((post.views as number) - avg) / sd }))
    .filter((item) => Math.abs(item.z) >= 2)
    .map((item) => ({ post: item.post, z: item.z, direction: item.z > 0 ? ('high' as const) : ('low' as const) }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
}

export type Dimension =
  | 'model'
  | 'platform'
  | 'format'
  | 'contentPillar'
  | 'hook'
  | 'tag'
  | 'contentTag'
  | 'trackEnergy'

const TRACK_ENERGY_LABEL: Record<string, string> = {
  high: 'Высокая энергия трека',
  mid: 'Средняя энергия трека',
  low: 'Низкая энергия трека',
}
export const trackEnergyLabel = (post: PostRecord) =>
  TRACK_ENERGY_LABEL[post.track?.energyTier || ''] || 'Трек не указан'

// Group posts by a chosen dimension, expanding tag arrays so a reel counts once per tag.
export function groupByDimension(posts: PostRecord[], dimension: Dimension) {
  const groups = new Map<string, PostRecord[]>()
  const add = (name: string, post: PostRecord) => {
    const key = name || 'Не указано'
    groups.set(key, [...(groups.get(key) || []), post])
  }
  posts.forEach((post) => {
    if (dimension === 'hook') add(getHookLabel(post), post)
    else if (dimension === 'trackEnergy') add(trackEnergyLabel(post), post)
    else if (dimension === 'tag') {
      if (!post.tags.length) add('Без тегов', post)
      else post.tags.forEach((tag) => add(tag, post))
    } else if (dimension === 'contentTag') {
      if (!post.contentTags.length) add('Без тегов содержания', post)
      else post.contentTags.forEach((tag) => add(tag, post))
    } else add(String(post[dimension] || ''), post)
  })
  return Array.from(groups, ([name, items]) => ({ name, items, summary: summarize(items) })).sort(
    (a, b) => (b.summary.medianViews || 0) - (a.summary.medianViews || 0),
  )
}

export function uniqueTags(posts: PostRecord[]) {
  const seen = new Map<string, string>()
  posts.forEach((post) => post.tags.forEach((tag) => {
    const key = tag.toLowerCase()
    if (!seen.has(key)) seen.set(key, tag)
  }))
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'ru'))
}

export function uniqueOptions(posts: PostRecord[], field: keyof PostRecord) {
  return Array.from(
    new Set(posts.map((post) => String(post[field] || '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'ru'))
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const shorten = (value: string, max = 54) => {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean
}

// Hook archetypes — each label names the MECHANIC (в чём зацепка) and what it does to
// the viewer (замысел), in plain language. Grouping reels by mechanic (instead of by raw
// on-screen text) makes the filter useful and reads like a hook playbook. The taxonomy
// follows the retention manual: unpredictability, intrigue loop, provocation, debate-bait,
// relatable/shareable message, first-person story.
const has = (s: string, ...needles: string[]) => needles.some((n) => s.includes(n))

export function getHookLabel(post: PostRecord) {
  const t = normalize(post.textOnVideo || '')
  const cap = normalize(post.caption || '')
  const both = `${t} ${cap}`

  // 1) Мини-история «от первого лица» — за кадром будто живой человек (траст, не продажа).
  if (has(both, 'cat ears', 'turn signals', 'last week', 'customer', 'told him', 'thought i was'))
    return 'Мини-история — будто пишет живой человек'

  // 2) Нет текста на видео → крючок держит сам образ, не слова.
  if (!t) return 'Чистый визуал — образ без слов, на залипание'

  // Архетипы 3–7 определяем по ТЕКСТУ НА ВИДЕО (именно он останавливает скролл),
  // подпись — только для мини-истории выше.
  // 3) Вопрос-спор / на мнение — провоцирует доказать своё → гонит комментарии.
  if (t.includes('?') && has(t, 'would you', 'who should', '90%', 'be honest', 'faster than', 'let your girl', 'get this wrong', 'date a girl'))
    return 'Вопрос-спор — провоцирует доказать своё в комментах'

  // 4) Петля интриги — «поймала тебя» / тизер / игра-внимание: причина досмотреть и ответить.
  if (has(t, 'caught', 'from this angle', 'or the other one', '2am', 'what are you doing', 'what color', 'looking'))
    return 'Петля интриги — «поймала тебя», тянет досмотреть'

  // 5) Провокация — берёт дерзостью и двусмысленностью (на грани, но цепляет).
  if (has(t, 'massive plug', 'too hot', 'bad idea', 'not your type', 'slutty', 'bent over'))
    return 'Провокация — берёт дерзостью и двусмысленностью'

  // 6) Relatable-месседж — мем/совет, которым хочется поделиться (шеры → Explore).
  if (has(t, 'your sign', 'flowers die', 'buy her gear', 'gear so she', 'date a biker', 'women who ride'))
    return 'Relatable-месседж — хочется переслать своему'

  // 7) Флекс-сравнение — спокойный понт «выбор очевиден».
  if (has(t, 'three rides', 'obvious choice', 'keep up'))
    return 'Флекс — спокойный понт, выбор очевиден'

  // 8) Любой другой прямой вопрос — приглашает ответить.
  if (t.includes('?')) return 'Вопрос-зацепка — приглашает ответить'

  return 'Прямой визуальный тезис — образ + подпись'
}

export function uniqueHookOptions(posts: PostRecord[]) {
  return Array.from(new Set(posts.map(getHookLabel).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  )
}

// ---- Human titles (no raw slugs in the public UI) ----

const stripWrapQuotes = (value: string) => value.replace(/^["'«»\s]+|["'«»\s]+$/g, '').trim()

// Turn a technical id slug into a readable phrase: drop the platform/type prefix and a
// leading date or index, then space-out and capitalize. CR_13_faster_than_you → "Faster
// than you"; TT_20260618_bad_idea → "Bad idea". Returns '' when nothing human remains.
function humanizeSlug(raw: string): string {
  if (!raw) return ''
  const s = raw
    .replace(/^(TT|IG|CR|CREATIVE|POST)[_-]?/i, '')
    .replace(/^\d{6,8}[_-]?/, '')
    .replace(/^\d{1,3}[_-]?/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (!s) return ''
  const lower = s.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

// The single source of human reel titles. Prefers on-screen text → caption → theme →
// humanized slug. A raw slug/ID is NEVER the headline — only a last-resort fallback.
export function displayTitle(post: PostRecord): string {
  const text = (post.textOnVideo || '').replace(/\s*\n\s*/g, ' / ').trim()
  if (text) return shorten(stripWrapQuotes(text), 72)
  const caption = (post.caption || '').split('\n')[0].trim()
  if (caption) return shorten(stripWrapQuotes(caption), 72)
  const pillar = (post.contentPillar || '').trim()
  if (pillar) return shorten(pillar, 72)
  const hook = (post.hookType || '').trim()
  if (hook) return shorten(hook, 72)
  return humanizeSlug(post.creativeId || post.postId) || 'Без названия'
}

const creativeSlugKey = (creativeId: string) =>
  creativeId
    .replace(/^(CR|CREATIVE)[_-]?\d+[_-]?/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')

// Hand-written names for the creatives we know, so the Creatives page reads like a human
// content plan rather than a slug list.
const CREATIVE_TITLES: Record<string, string> = {
  from_this_angle: 'С какого ракурса?',
  massive_plug: 'Massive plug на перекрёстке',
  caught_posing: 'Поймал за позингом',
  bad_idea: 'Я — твоя плохая идея',
  caught_you_looking: 'Caught you looking · джерси США',
  gear_not_flowers: 'Экипировку, а не цветы',
  bike_meet: 'Заметят на байк-мите?',
  faster_than_you: 'Кто ездит быстрее тебя',
  too_hot_gas_station: 'Слишком горячо для заправки',
  cat_ears: 'Уши-шлем как поворотники',
  turn_signals: 'Уши-шлем как поворотники',
  light_turns_green: 'Когда загорается зелёный',
}

// Human title for a creative group. Known slug → curated RU name; else the leading reel's
// own displayTitle; else a humanized slug; never the raw "Не указано".
export function creativeTitle(posts: PostRecord[], creativeId: string, index = 0): string {
  const key = creativeSlugKey(creativeId)
  if (key && CREATIVE_TITLES[key]) return CREATIVE_TITLES[key]
  const rep = [...posts].sort((a, b) => (b.views || 0) - (a.views || 0))[0]
  if (rep) {
    const title = displayTitle(rep)
    if (title && title !== 'Без названия') return title
  }
  return humanizeSlug(creativeId) || `Креатив #${String(index + 1).padStart(2, '0')}`
}

// ---- Benchmark tiers (operationalize "our benchmarks") ----

export type TierKey = 'weak' | 'norm' | 'strong' | 'breakout'
export interface Tier {
  key: TierKey
  label: string
  glyph: string
}

// Glyph kept '' — the UI renders a coloured dot via CSS (no emoji in a studio-grade UI).
const TIER_META: Record<TierKey, { label: string; glyph: string }> = {
  weak: { label: 'слабо', glyph: '' },
  norm: { label: 'норма', glyph: '' },
  strong: { label: 'сильно', glyph: '' },
  breakout: { label: 'прорыв', glyph: '' },
}

// Ascending thresholds [t1,t2,t3]: <t1 weak · <t2 norm · <t3 strong · ≥t3 breakout.
// Platform-agnostic metrics (volume, view-through which is denominator-free).
const BENCHMARK_THRESHOLDS: Record<string, [number, number, number]> = {
  views: [450, 800, 1300],
  medianViews: [450, 800, 1300],
  completionRate: [0.2, 0.35, 0.46], // TikTok «досмотр до конца»
  retentionRate: [0.6, 0.8, 0.95], // VTR (досматриваемость), доля длины
  commentRate: [0.002, 0.005, 0.012],
  fyp: [40, 80, 95],
}

// Reach-based engagement rates differ ~2× between platforms (TikTok » Instagram),
// so benchmarking them against one blended bar mislabels every IG reel as «слабо».
// Thresholds = p25 / median / p75 of the live 27-reel corpus, split by platform.
const PLATFORM_THRESHOLDS: Record<string, Record<string, [number, number, number]>> = {
  likeRate: {
    TikTok: [0.09, 0.121, 0.15],
    Instagram: [0.045, 0.058, 0.075],
    ALL: [0.061, 0.08, 0.13],
  },
  engagementRateByReach: {
    TikTok: [0.11, 0.147, 0.18],
    Instagram: [0.065, 0.078, 0.1],
    ALL: [0.078, 0.103, 0.16],
  },
  followConversion: {
    TikTok: [0.012, 0.0197, 0.03],
    Instagram: [0.003, 0.006, 0.012],
    ALL: [0.0068, 0.0133, 0.021],
  },
  shareSaveRate: {
    TikTok: [0.008, 0.016, 0.03],
    Instagram: [0.008, 0.014, 0.03],
    ALL: [0.008, 0.015, 0.03],
  },
}

export function benchmarkTier(
  metric: string,
  value: number | null | undefined,
  platform?: string,
): Tier | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const perPlatform = PLATFORM_THRESHOLDS[metric]
  const t = perPlatform ? perPlatform[platform ?? 'ALL'] ?? perPlatform.ALL : BENCHMARK_THRESHOLDS[metric]
  if (!t) return null
  const key: TierKey =
    value >= t[2] ? 'breakout' : value >= t[1] ? 'strong' : value >= t[0] ? 'norm' : 'weak'
  return { key, ...TIER_META[key] }
}

// ---- Reel-page extras: traffic sources, demographics, retention drop ----

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const COUNTRY_RU: Record<string, string> = {
  us: 'США', usa: 'США', 'united states': 'США',
  de: 'Германия', germany: 'Германия',
  uk: 'Великобритания', gb: 'Великобритания', 'united kingdom': 'Великобритания',
  ca: 'Канада', canada: 'Канада',
  in: 'Индия', india: 'Индия',
  mx: 'Мексика', mexico: 'Мексика',
  nl: 'Нидерланды', netherlands: 'Нидерланды',
  ro: 'Румыния', romania: 'Румыния',
  pl: 'Польша', poland: 'Польша',
  se: 'Швеция', sweden: 'Швеция',
  pk: 'Пакистан', pakistan: 'Пакистан',
  au: 'Австралия', australia: 'Австралия',
  it: 'Италия', italy: 'Италия',
  ma: 'Марокко', morocco: 'Марокко',
  fr: 'Франция', france: 'Франция',
  by: 'Беларусь', belarus: 'Беларусь',
  gu: 'Гуам', guam: 'Гуам',
  pr: 'Пуэрто-Рико', 'puerto rico': 'Пуэрто-Рико',
  ch: 'Швейцария', switzerland: 'Швейцария',
  do: 'Доминикана',
  jp: 'Япония', japan: 'Япония',
  al: 'Албания', albania: 'Албания',
  es: 'Испания', spain: 'Испания',
  tr: 'Турция', turkey: 'Турция',
  ir: 'Иран', iran: 'Иран',
  ph: 'Филиппины', philippines: 'Филиппины',
  be: 'Бельгия', belgium: 'Бельгия',
  cn: 'Китай', china: 'Китай',
  pt: 'Португалия', portugal: 'Португалия',
  ru: 'Россия', ua: 'Украина', br: 'Бразилия',
  other: 'Другие',
}
const countryRu = (raw: string) => {
  const key = raw.trim().toLowerCase()
  return COUNTRY_RU[key] || (raw.length <= 3 ? raw.toUpperCase() : raw)
}

const AGE_LABEL: Record<string, string> = {
  age_13_17_pct: '13–17',
  age_18_24_pct: '18–24',
  age_25_34_pct: '25–34',
  age_35_44_pct: '35–44',
  age_45_54_pct: '45–54',
  age_55plus_pct: '55+',
}

export interface NamedShare {
  label: string
  pct: number
}

const TRAFFIC_LABELS: Array<[string, string]> = [
  ['traffic_foryou_pct', 'Рекомендации (FYP)'],
  ['traffic_search_pct', 'Поиск'],
  ['traffic_personalprofile_pct', 'Профиль'],
  ['traffic_other_pct', 'Другое'],
]

// Traffic-source split (For You / Search / Profile / Other) as fractions, for the reel
// page. Empty when the reel carries no traffic_* extras.
export function trafficSources(post: PostRecord): NamedShare[] {
  const extra = post.extraMetrics || {}
  return TRAFFIC_LABELS.filter(([key]) => typeof extra[key] === 'number').map(([key, label]) => ({
    label,
    pct: clamp01(extra[key] / 100),
  }))
}

export interface Demographics {
  gender: NamedShare[]
  age: NamedShare[]
  countries: NamedShare[]
}

export function demographics(post: PostRecord): Demographics {
  const extra = post.extraMetrics || {}
  const pick = (key: string) => (typeof extra[key] === 'number' ? clamp01(extra[key] / 100) : null)
  const gender = (
    [
      ['gender_male_pct', 'Мужчины'],
      ['gender_female_pct', 'Женщины'],
      ['gender_other_pct', 'Другое'],
    ] as Array<[string, string]>
  )
    .map(([key, label]) => ({ label, pct: pick(key) }))
    .filter((row): row is NamedShare => row.pct !== null && row.pct > 0)
  const age = Object.entries(AGE_LABEL)
    .map(([key, label]) => ({ label, pct: pick(key) }))
    .filter((row): row is NamedShare => row.pct !== null && row.pct > 0)
  const countries = Object.entries(extra)
    .filter(([key, value]) => key.startsWith('geo_') && key.endsWith('_pct') && value > 0)
    .map(([key, value]) => ({ label: countryRu(key.slice(4, -4)), pct: clamp01(value / 100) }))
    .sort((a, b) => b.pct - a.pct)
  return { gender, age, countries }
}

// Pull the main retention drop-off point out of the free-text note ("обрыв на 0:02").
export function retentionDropPoint(note: string | null | undefined): string | null {
  const match = (note || '').match(/обрыв[^0-9]*(\d+:\d{2})/i)
  return match ? match[1] : null
}

// ---- Weighted audience (honest aggregation by absolutes) ----

export interface AudienceSegmentAgg {
  segment: string
  abs: number
  share: number
  reels: number
  weak: boolean
}
export interface AudienceDimensionAgg {
  dimension: string
  order: number
  dimTotal: number
  contributingReels: number
  fallbackReels: number
  segments: AudienceSegmentAgg[]
}

const DIMENSION_RU: Record<string, string> = {
  Country: 'Страна',
  Gender: 'Пол',
  Age: 'Возраст',
  'Viewer type': 'Тип зрителя',
  'Follower status': 'Подписка',
  'Traffic source': 'Источник трафика',
}
const DIMENSION_ORDER = ['Страна', 'Пол', 'Возраст', 'Источник трафика', 'Тип зрителя', 'Подписка']

// Canonical segment label so seed rows (English, with Male/Men duplicates) and entry
// extras land on the same bar.
function canonSegment(dimension: string, segment: string): string {
  const value = segment.trim()
  if (dimension === 'Gender') {
    const low = value.toLowerCase()
    if (low === 'male' || low === 'men') return 'Мужчины'
    if (low === 'female' || low === 'women') return 'Женщины'
    if (low === 'other') return 'Другое'
    return value
  }
  if (dimension === 'Viewer type') {
    if (/new/i.test(value)) return 'Новые зрители'
    if (/return/i.test(value)) return 'Вернувшиеся'
    return value
  }
  if (dimension === 'Follower status') {
    if (/non/i.test(value)) return 'Не подписаны'
    if (/follow/i.test(value)) return 'Подписчики'
    return value
  }
  if (dimension === 'Age') return value.replace('-', '–')
  if (dimension === 'Country') return countryRu(value)
  return value
}

interface Slice {
  dimension: string
  segment: string
  fraction: number
}

// A reel's audience as canonical (dimension, segment, fraction) slices — from explicit
// AudienceRecord rows when present, otherwise derived from extraMetrics.
function extraSlices(extra: Record<string, number>): Slice[] {
  const out: Slice[] = []
  for (const [key, value] of Object.entries(extra)) {
    const fraction = value / 100
    if (!Number.isFinite(fraction) || fraction <= 0) continue
    if (key.startsWith('geo_') && key.endsWith('_pct')) {
      out.push({ dimension: 'Страна', segment: countryRu(key.slice(4, -4)), fraction })
    } else if (key === 'gender_male_pct') out.push({ dimension: 'Пол', segment: 'Мужчины', fraction })
    else if (key === 'gender_female_pct') out.push({ dimension: 'Пол', segment: 'Женщины', fraction })
    else if (key === 'gender_other_pct') out.push({ dimension: 'Пол', segment: 'Другое', fraction })
    else if (AGE_LABEL[key]) out.push({ dimension: 'Возраст', segment: AGE_LABEL[key], fraction })
    else if (key === 'traffic_foryou_pct')
      out.push({ dimension: 'Источник трафика', segment: 'Рекомендации (FYP)', fraction })
    else if (key === 'traffic_search_pct')
      out.push({ dimension: 'Источник трафика', segment: 'Поиск', fraction })
    else if (key === 'traffic_personalprofile_pct')
      out.push({ dimension: 'Источник трафика', segment: 'Профиль', fraction })
    else if (key === 'traffic_other_pct')
      out.push({ dimension: 'Источник трафика', segment: 'Другое', fraction })
    else if (key === 'new_viewers_pct')
      out.push({ dimension: 'Тип зрителя', segment: 'Новые зрители', fraction })
    else if (key === 'returning_viewers_pct')
      out.push({ dimension: 'Тип зрителя', segment: 'Вернувшиеся', fraction })
    else if (key === 'nonfollowers_pct')
      out.push({ dimension: 'Подписка', segment: 'Не подписаны', fraction })
    else if (key === 'followers_pct')
      out.push({ dimension: 'Подписка', segment: 'Подписчики', fraction })
  }
  return out
}

// Honest audience aggregation: every segment is weighted by the reel's ABSOLUTE reach
// (segment_abs = fraction × reach, falling back to views), summed across reels, then
// shown as a share of the dimension total. A reel with 1.3k reach pulls far harder than
// one with 80 — unlike the old equal-weight average of percentages.
export function buildAudience(
  posts: PostRecord[],
  audienceRows: AudienceRecord[],
): AudienceDimensionAgg[] {
  const live = posts.filter((post) => post.recordType === 'LIVE')
  const liveIds = new Set(live.map((post) => post.postId))
  const audByPost = new Map<string, AudienceRecord[]>()
  audienceRows
    .filter((row) => row.recordType === 'LIVE' && row.percentage !== null && liveIds.has(row.postId))
    .forEach((row) => audByPost.set(row.postId, [...(audByPost.get(row.postId) || []), row]))

  const dims = new Map<
    string,
    {
      segs: Map<string, { abs: number; reels: Set<string> }>
      reels: Set<string>
      fallback: Set<string>
    }
  >()
  const ensureDim = (dimension: string) => {
    const found = dims.get(dimension)
    if (found) return found
    const created = { segs: new Map(), reels: new Set<string>(), fallback: new Set<string>() }
    dims.set(dimension, created)
    return created
  }

  for (const post of live) {
    const weight = post.reach ?? post.views
    if (weight === null || weight === undefined || weight <= 0) continue
    const usingFallback = post.reach === null || post.reach === undefined
    const rows = audByPost.get(post.postId)
    const slices: Slice[] =
      rows && rows.length
        ? rows.map((row) => ({
            dimension: DIMENSION_RU[row.dimension] || row.dimension,
            // canonSegment keys on the ORIGINAL (English) dimension so seed rows map to
            // RU labels and Male/Men collapse onto one bar.
            segment: canonSegment(row.dimension, row.segment),
            fraction: clamp01(row.percentage as number),
          }))
        : extraSlices(post.extraMetrics || {})
    if (!slices.length) continue
    const seenDims = new Set<string>()
    for (const slice of slices) {
      if (slice.fraction <= 0) continue
      const dim = ensureDim(slice.dimension)
      const seg = dim.segs.get(slice.segment) || { abs: 0, reels: new Set<string>() }
      seg.abs += slice.fraction * weight
      seg.reels.add(post.postId)
      dim.segs.set(slice.segment, seg)
      if (!seenDims.has(slice.dimension)) {
        seenDims.add(slice.dimension)
        dim.reels.add(post.postId)
        if (usingFallback) dim.fallback.add(post.postId)
      }
    }
  }

  const result: AudienceDimensionAgg[] = []
  for (const [dimension, data] of dims) {
    const dimTotal = Array.from(data.segs.values()).reduce((total, seg) => total + seg.abs, 0)
    if (dimTotal <= 0) continue
    const segments = Array.from(data.segs, ([segment, seg]) => ({
      segment,
      abs: seg.abs,
      share: seg.abs / dimTotal,
      reels: seg.reels.size,
      weak: seg.reels.size <= 1,
    })).sort((a, b) => b.abs - a.abs)
    const orderIndex = DIMENSION_ORDER.indexOf(dimension)
    result.push({
      dimension,
      order: orderIndex === -1 ? 99 : orderIndex,
      dimTotal,
      contributingReels: data.reels.size,
      fallbackReels: data.fallback.size,
      segments,
    })
  }
  return result.sort((a, b) => a.order - b.order)
}

export function pluralReels(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ролик'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ролика'
  return 'роликов'
}

export function pluralSegments(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'сегмент'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сегмента'
  return 'сегментов'
}

// Compact viewer count: 980 → "980", 1530 → "1,5k".
export function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  return String(Math.round(n))
}

// ---- Creative anomaly classification ("what happened & why") ----

export type CreativeFlag =
  | 'breakout'
  | 'fyp_throttled'
  | 'long_low_completion'
  | 'underperform'
  | 'baseline'

export interface CreativeVerdict {
  flag: CreativeFlag
  label: string
  tone: 'pos' | 'neg' | 'warn' | 'none'
  cause: string
}

const VIEWS_BENCH = 571

// contentTag → short human cause fragment for breakout drivers.
const DRIVER_TAGS: Array<[string, string]> = [
  ['gear-not-flowers', 'сменил регистр: экипировка, не thirst'],
  ['комьюнити', 'комьюнити-месседж вместо thirst'],
  ['womenwhoride', 'нишевое мото-комьюнити'],
  ['вопрос-мнение', 'комментбейт: вопрос на мнение'],
  ['callout', 'дерзкий текст-callout'],
  ['трендджек', 'тематический трендджек'],
  ['ussoccer', 'трендджек ЧМ-2026'],
  ['райдинг', 'кинематографичный райдинг'],
  ['шеры', 'погнали репосты'],
]
const driverTag = (tags: string[]) => {
  const set = new Set(tags.map((tag) => tag.toLowerCase()))
  for (const [tag, cause] of DRIVER_TAGS) if (set.has(tag)) return cause
  return ''
}

// Classify a creative (one creativeId, possibly TT+IG) against the LIVE cohort and build
// a short, data-driven cause line — never the raw whyItWorked text dumped wholesale.
export function classifyCreative(group: PostRecord[], live: PostRecord[]): CreativeVerdict {
  const leader = [...group].sort((a, b) => (b.views || 0) - (a.views || 0))[0]
  if (!leader || leader.views === null) {
    return { flag: 'baseline', label: '', tone: 'none', cause: '' }
  }
  const views = leader.views
  const liveViews = live.filter((p) => p.views !== null).map((p) => p.views)
  const avg = average(liveViews)
  const sd = stdev(liveViews)
  const z = avg !== null && sd ? (views - avg) / sd : 0
  const extra = leader.extraMetrics || {}
  const fyp = extra.traffic_foryou_pct
  const profile = extra.traffic_personalprofile_pct
  const completion = leader.completionRate
  const duration = leader.duration
  const tags = group.flatMap((p) => p.contentTags)
  const why = group.map((p) => p.contentAnalysis?.whyItWorked || '').join(' ')
  const ratio = (views / VIEWS_BENCH).toFixed(1).replace('.', ',')
  const pctOfBench = Math.round((views / VIEWS_BENCH) * 100)

  if (z >= 2 || views >= VIEWS_BENCH * 2) {
    const driver = driverTag(tags)
    return {
      flag: 'breakout',
      label: 'ПРОРЫВ',
      tone: 'pos',
      cause: `×${ratio} к медиане (${formatNumber(views)} vs ${VIEWS_BENCH})${driver ? ` · ${driver}` : ''}`,
    }
  }
  if (typeof fyp === 'number' && fyp < 30 && typeof profile === 'number' && profile > 50) {
    const explicit = new Set(tags.map((t) => t.toLowerCase()))
    const extraCause = explicit.has('explicit') || explicit.has('booty') ? ' · explicit-кадр уперся в FYP-модерацию' : ''
    return {
      flag: 'fyp_throttled',
      label: 'ЗАРЕЗАН FYP',
      tone: 'neg',
      cause: `For You ${formatNumber(fyp)}%, профиль ${formatNumber(profile)}% — алгоритм не пустил в рекомендации${extraCause}`,
    }
  }
  if (duration !== null && duration > 14 && completion !== null && completion < 0.2) {
    return {
      flag: 'long_low_completion',
      label: 'ДЛИННЫЙ → НИЗКИЙ ДОСМОТР',
      tone: 'warn',
      cause: `${formatNumber(duration)}с → досмотр ${formatPercent(completion)} при медиане 34% — длина утопила идею`,
    }
  }
  if (z <= -2 || views < VIEWS_BENCH * 0.5) {
    const early = /ранн|снимок|early|рано судить/i.test(why) ? ' · ранний снимок, рано судить' : ''
    return {
      flag: 'underperform',
      label: 'СЛАБЫЙ ОХВАТ',
      tone: 'neg',
      cause: `${formatNumber(views)} vs медиана ${VIEWS_BENCH} (${pctOfBench}%)${early}`,
    }
  }
  return { flag: 'baseline', label: '', tone: 'none', cause: '' }
}

export function groupPosts(posts: PostRecord[], key: keyof PostRecord) {
  const groups = new Map<string, PostRecord[]>()
  posts.forEach((post) => {
    const value = String(post[key] || 'Не указано')
    groups.set(value, [...(groups.get(value) || []), post])
  })
  return Array.from(groups, ([name, items]) => ({ name, items, summary: summarize(items) })).sort(
    (a, b) => b.summary.views - a.summary.views,
  )
}

export function timeSeries(posts: PostRecord[]) {
  const groups = new Map<string, { views: number; follows: number; posts: number }>()
  posts.forEach((post) => {
    const date = post.publishedAt?.slice(0, 10)
    if (!date) return
    const current = groups.get(date) || { views: 0, follows: 0, posts: 0 }
    groups.set(date, {
      views: current.views + (post.views || 0),
      follows: current.follows + (post.follows || 0),
      posts: current.posts + 1,
    })
  })
  return Array.from(groups, ([date, value]) => ({ date, ...value })).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}

// ---- Platform scoreboard (IG vs TikTok cross-platform A/B at a glance) ----

export interface PlatformStat {
  platform: Platform
  reels: number
  views: number
  medianViews: number | null
  reach: number
  follows: number
  shares: number
  saves: number
  comments: number
  engagementRateByReach: number | null
}

function platformStat(platform: Platform, posts: PostRecord[]): PlatformStat {
  const s = summarize(posts)
  return {
    platform,
    reels: posts.length,
    views: s.views,
    medianViews: s.medianViews,
    reach: sum(posts.map((post) => post.reach ?? post.views)),
    follows: s.follows,
    shares: sum(posts.map((post) => post.shares)),
    saves: sum(posts.map((post) => post.saves)),
    comments: sum(posts.map((post) => post.comments)),
    engagementRateByReach: s.engagementRateByReach,
  }
}

export interface PlatformScoreboard {
  tiktok: PlatformStat
  instagram: PlatformStat
  reachRatio: number | null // IG reach ÷ TikTok reach
  sharesRatio: number | null // IG shares ÷ TikTok shares
  followsRatio: number | null
  hasBoth: boolean
}

// Side-by-side platform aggregates and IG-relative-to-TikTok ratios — the data behind
// the "IG ≈ ×2 reach, ×6 shares" strategic finding. Ratios are IG ÷ TikTok.
export function platformScoreboard(live: PostRecord[]): PlatformScoreboard {
  const tt = live.filter((post) => post.platform === 'TikTok')
  const ig = live.filter((post) => post.platform === 'Instagram')
  const tiktok = platformStat('TikTok', tt)
  const instagram = platformStat('Instagram', ig)
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
  return {
    tiktok,
    instagram,
    reachRatio: ratio(instagram.reach, tiktok.reach),
    sharesRatio: ratio(instagram.shares, tiktok.shares),
    followsRatio: ratio(instagram.follows, tiktok.follows),
    hasBoth: tt.length > 0 && ig.length > 0,
  }
}

// ---- Growth funnel (reach → profile → follows) on the profile-visit cohort ----

export interface FunnelStep {
  key: 'reach' | 'profile' | 'follows'
  label: string
  value: number
  ofReach: number | null // share of reach (bar width)
  ofPrev: number | null // conversion from the previous step
}
export interface GrowthFunnel {
  steps: FunnelStep[]
  cohortReels: number
  totalReels: number
  reach: number
  shares: number
  saves: number
}

// Honest aggregate funnel: computed only over reels that actually carry profile-visit
// data (mixing a full-cohort reach with a partial-cohort profile count would lie). The
// caller surfaces `cohortReels` so the sample is never hidden.
export function growthFunnel(live: PostRecord[]): GrowthFunnel | null {
  const cohort = live.filter(
    (post) => post.profileVisits !== null && (post.reach ?? post.views) !== null,
  )
  const reach = sum(cohort.map((post) => post.reach ?? post.views))
  if (!cohort.length || reach <= 0) return null
  const profile = sum(cohort.map((post) => post.profileVisits))
  const follows = sum(cohort.map((post) => post.follows))
  const steps: FunnelStep[] = [
    { key: 'reach', label: 'Охват · увидели', value: reach, ofReach: 1, ofPrev: null },
    {
      key: 'profile',
      label: 'Зашли в профиль',
      value: profile,
      ofReach: profile / reach,
      ofPrev: profile / reach,
    },
    {
      key: 'follows',
      label: 'Подписались',
      value: follows,
      ofReach: follows / reach,
      ofPrev: profile > 0 ? follows / profile : null,
    },
  ]
  return {
    steps,
    cohortReels: cohort.length,
    totalReels: live.length,
    reach,
    shares: sum(live.map((post) => post.shares)),
    saves: sum(live.map((post) => post.saves)),
  }
}

// ---- Content-tag leaderboard (which content elements lift median views) ----

export interface TagLift {
  tag: string
  reels: number
  median: number | null
  lift: number | null // vs overall median, signed fraction
}

// Rank content elements by median views, with lift vs the overall median. Honest signal,
// not causal — drives the "winning content" mini-panel and the playbook.
export function topContentTags(live: PostRecord[], minReels = 2): TagLift[] {
  const groups = new Map<string, PostRecord[]>()
  live.forEach((post) =>
    post.contentTags.forEach((tag) => groups.set(tag, [...(groups.get(tag) || []), post])),
  )
  const overall = median(live.map((post) => post.views))
  return Array.from(groups, ([tag, items]) => {
    const med = median(items.map((post) => post.views))
    return {
      tag,
      reels: items.length,
      median: med,
      lift: overall && med ? med / overall - 1 : null,
    }
  })
    .filter((entry) => entry.reels >= minReels && entry.median !== null)
    .sort((a, b) => (b.median || 0) - (a.median || 0))
}

const INSIGHT_METRIC_LABEL: Record<InsightMetric, string> = {
  medianViews: 'медиана просмотров',
  completion: 'досмотр',
  retention: 'удержание',
  follows: 'подписки',
  comments: 'комментарии',
  engagement: 'вовлечённость',
  shareSave: 'репосты и сохранения',
  fyp: 'FYP / рекомендации',
  crossPlatform: 'платформа',
}

function insightReelTitle(post: PostRecord): string {
  const base = displayTitle(post)
  const date = post.publishedAt ? post.publishedAt.slice(5, 10).replace('-', '.') : ''
  return date ? `${shorten(base, 30)} · ${date}` : shorten(base, 30)
}

const buildReels = (items: PostRecord[]): InsightReel[] =>
  items.slice(0, 6).map((post) => ({
    postId: post.postId,
    title: insightReelTitle(post),
    platform: post.platform,
  }))

// Turn (metric, dimension, direction) into a concrete next step for the content plan.
function recommend(metric: InsightMetric, dim: string, dir: 'up' | 'down' | 'flat'): string {
  const m = INSIGHT_METRIC_LABEL[metric]
  if (dir === 'up')
    return `Закладывайте «${dim}» в план следующих роликов — на нём ${m} держится выше. Снимите ещё 2–3 ролика с этим приёмом, чтобы подтвердить сигнал.`
  if (dir === 'down')
    return `Поставьте «${dim}» на паузу или переснимите — ${m} проседает. Перед повтором поменяйте хук и первые 2 секунды.`
  return `Соберите ещё пары на «${dim}», прежде чем делать вывод — пока разброс в пределах нормы.`
}

export function createInsights(posts: PostRecord[]): Insight[] {
  const live = posts.filter((post) => post.recordType === 'LIVE')
  if (live.length < 3) return []
  const overall = summarize(live)
  const insights: Insight[] = []

  // score = |effect| weighted by sample size; ranks the strongest signal to the hero.
  const add = (insight: Omit<Insight, 'score'>) =>
    insights.push({
      ...insight,
      score: Math.abs(insight.effect || 0) * (Math.min(insight.sampleSize, 6) / 6),
    })

  const groupBy = (items: PostRecord[], getName: (post: PostRecord) => string) => {
    const groups = new Map<string, PostRecord[]>()
    items.forEach((post) => {
      const name = getName(post) || 'Не указано'
      groups.set(name, [...(groups.get(name) || []), post])
    })
    return Array.from(groups, ([name, groupItems]) => ({
      name,
      items: groupItems,
      summary: summarize(groupItems),
    }))
  }

  const pushMedianComparison = ({
    id,
    label,
    groups,
    threshold = 0.2,
  }: {
    id: string
    label: string
    groups: ReturnType<typeof groupBy>
    threshold?: number
  }) => {
    const ranked = groups
      .filter((group) => group.items.length >= 2 && group.name !== 'Не указано')
      .filter((group) => Boolean(group.summary.medianViews))
      .sort((a, b) => (b.summary.medianViews || 0) - (a.summary.medianViews || 0))
    const [top, next] = ranked
    if (!top || !next || !next.summary.medianViews || !top.summary.medianViews) return
    const difference = top.summary.medianViews / next.summary.medianViews - 1
    if (Math.abs(difference) < threshold) return
    add({
      id,
      metric: 'medianViews',
      direction: 'up',
      effect: difference,
      title: `${label}: «${top.name}» сильнее по просмотрам`,
      detail: `Медиана просмотров ${formatNumber(top.summary.medianViews)} против ${formatNumber(
        next.summary.medianViews,
      )} у «${next.name}» (${difference > 0 ? '+' : ''}${(difference * 100).toFixed(
        0,
      )}%). Ранний сигнал по текущим роликам, не причинный вывод.`,
      recommendation: recommend('medianViews', top.name, 'up'),
      sampleSize: top.items.length + next.items.length,
      reels: buildReels([...top.items, ...next.items]),
      tone: 'positive',
    })
  }

  const pushRateComparison = ({
    id,
    title,
    groups,
    getValue,
    metric,
    metricLabel,
    threshold = 0.15,
    formatVal = formatPercent,
  }: {
    id: string
    title: (topName: string) => string
    groups: ReturnType<typeof groupBy>
    getValue: (post: PostRecord) => number | null
    metric: InsightMetric
    metricLabel: string
    threshold?: number
    formatVal?: (value: number) => string
  }) => {
    const ranked = groups
      .filter((group) => group.items.length >= 2 && group.name !== 'Не указано')
      .map((group) => ({ ...group, metricValue: median(group.items.map(getValue)) }))
      .filter((group) => group.metricValue !== null)
      .sort((a, b) => (b.metricValue || 0) - (a.metricValue || 0))
    const [top, next] = ranked
    if (!top || !next || top.metricValue === null || next.metricValue === null) return
    if (Math.abs(top.metricValue - next.metricValue) < threshold) return
    const effect = next.metricValue ? top.metricValue / next.metricValue - 1 : null
    add({
      id,
      metric,
      direction: 'up',
      effect,
      title: title(top.name),
      detail: `${metricLabel} у «${top.name}» — ${formatVal(top.metricValue)} против ${formatVal(
        next.metricValue,
      )} у «${next.name}». Считаем только по роликам, где метрика есть.`,
      recommendation: recommend(metric, top.name, 'up'),
      sampleSize: top.items.length + next.items.length,
      reels: buildReels([...top.items, ...next.items]),
      tone: 'positive',
    })
  }

  const dimensions: Array<{ key: keyof PostRecord; label: string }> = [
    { key: 'format', label: 'Способ генерации' },
    { key: 'model', label: 'Модель' },
  ]

  dimensions.forEach(({ key, label }) => {
    groupPosts(live, key)
      .filter((group) => group.items.length >= 3 && group.name !== 'Не указано')
      .forEach((group) => {
        const groupMedian = group.summary.medianViews
        if (!groupMedian || !overall.medianViews) return
        const difference = groupMedian / overall.medianViews - 1
        if (Math.abs(difference) < 0.2) return
        const dir = difference > 0 ? 'up' : 'down'
        add({
          id: `${String(key)}-${group.name}`,
          metric: 'medianViews',
          direction: dir,
          effect: difference,
          title: `${label} «${group.name}» ${difference > 0 ? 'сильнее' : 'слабее'} по просмотрам`,
          detail: `Медиана просмотров ${difference > 0 ? 'выше' : 'ниже'} общей на ${Math.abs(
            difference * 100,
          ).toFixed(0)}%. Сравнение основано только на публикациях текущей выборки.`,
          recommendation: recommend('medianViews', group.name, dir),
          sampleSize: group.items.length,
          reels: buildReels(group.items),
          tone: dir === 'up' ? 'positive' : 'negative',
        })
      })
  })

  // Content tags vs the overall median — the content-first "what works" signal.
  const contentTagGroups = new Map<string, PostRecord[]>()
  live.forEach((post) =>
    post.contentTags.forEach((tag) =>
      contentTagGroups.set(tag, [...(contentTagGroups.get(tag) || []), post]),
    ),
  )
  Array.from(contentTagGroups)
    .filter(([, items]) => items.length >= 3)
    .forEach(([name, items]) => {
      const groupMedian = median(items.map((post) => post.views))
      if (!groupMedian || !overall.medianViews) return
      const difference = groupMedian / overall.medianViews - 1
      if (Math.abs(difference) < 0.2) return
      const dir = difference > 0 ? 'up' : 'down'
      add({
        id: `content-tag-${name}`,
        metric: 'medianViews',
        direction: dir,
        effect: difference,
        title: `Содержание «${name}» ${difference > 0 ? 'работает сильнее' : 'работает слабее'}`,
        detail: `Медиана просмотров роликов с этим элементом содержания ${
          difference > 0 ? 'выше' : 'ниже'
        } общей на ${Math.abs(difference * 100).toFixed(0)}%.`,
        recommendation: recommend('medianViews', name, dir),
        sampleSize: items.length,
        reels: buildReels(items),
        tone: dir === 'up' ? 'positive' : 'negative',
      })
    })

  const hookGroups = groupBy(live, getHookLabel)
  pushMedianComparison({ id: 'hook-median-views', label: 'Хук / сцена', groups: hookGroups })
  pushRateComparison({
    id: 'hook-retention',
    title: () => 'Разница есть и в удержании, не только в просмотрах',
    groups: hookGroups,
    getValue: (post) => post.retentionRate,
    metric: 'retention',
    metricLabel: 'Медианное удержание',
    threshold: 0.05,
  })
  // Comment-rate signal — expand insights beyond views.
  pushRateComparison({
    id: 'hook-comments',
    title: (name) => `«${name}» собирает больше комментариев`,
    groups: hookGroups,
    getValue: (post) => post.commentRate,
    metric: 'comments',
    metricLabel: 'Медианные комментарии',
    threshold: 0.002,
  })
  // For You / reach signal — what the algorithm pushes into recommendations.
  pushRateComparison({
    id: 'hook-fyp',
    title: (name) => `«${name}» лучше заходит в рекомендации`,
    groups: hookGroups,
    getValue: (post) =>
      typeof post.extraMetrics?.traffic_foryou_pct === 'number'
        ? post.extraMetrics.traffic_foryou_pct
        : null,
    metric: 'fyp',
    metricLabel: 'Медианный For You',
    threshold: 10,
    formatVal: (value) => `${formatNumber(value)}%`,
  })

  pushMedianComparison({
    id: 'platform-median-views',
    label: 'Платформа',
    groups: groupBy(live, (post) => post.platform),
  })

  const pairedCreatives = groupBy(
    live.filter((post) => post.creativeId),
    (post) => post.creativeId,
  ).filter(
    (group) =>
      group.items.some((post) => post.platform === 'Instagram') &&
      group.items.some((post) => post.platform === 'TikTok'),
  )
  if (pairedCreatives.length >= 2) {
    const igWins = pairedCreatives.filter((group) => {
      const ig = group.items.find((post) => post.platform === 'Instagram')
      const tt = group.items.find((post) => post.platform === 'TikTok')
      return (ig?.views || 0) > (tt?.views || 0)
    }).length
    const ttWins = pairedCreatives.length - igWins
    add({
      id: 'cross-platform-creative-consistency',
      metric: 'crossPlatform',
      direction: 'flat',
      effect: null,
      title:
        igWins > 0 && ttWins > 0
          ? 'Один креатив ведёт себя по-разному в Instagram и TikTok'
          : `Пока ${igWins > ttWins ? 'Instagram' : 'TikTok'} чаще сильнее на одинаковых креативах`,
      detail:
        igWins > 0 && ttWins > 0
          ? `Есть ${pairedCreatives.length} пар Instagram/TikTok: в ${igWins} выше Instagram, в ${ttWins} — TikTok. Значит, платформу пока нельзя считать самостоятельной причиной результата.`
          : `Проверено ${pairedCreatives.length} пар одинаковых Creative ID. Это ранний сигнал, не вывод о платформенном алгоритме.`,
      recommendation:
        'Снимайте пары один-в-один (то же видео, разные платформы и треки) — это единственный способ отделить эффект платформы от эффекта креатива.',
      sampleSize: pairedCreatives.reduce((total, group) => total + group.items.length, 0),
      reels: buildReels(pairedCreatives.flatMap((group) => group.items)),
      tone: 'neutral',
    })
  }

  const totalFollows = sum(live.map((post) => post.follows))
  const followLeader = [...live].sort((a, b) => (b.follows || 0) - (a.follows || 0))[0]
  if (followLeader && totalFollows >= 3 && (followLeader.follows || 0) / totalFollows >= 0.6) {
    const share = (followLeader.follows || 0) / totalFollows
    add({
      id: 'follow-concentration',
      metric: 'follows',
      direction: 'up',
      effect: share,
      title: 'Подписки держатся на одном ролике',
      detail: `«${displayTitle(followLeader)}» дал ${formatNumber(
        followLeader.follows,
      )} из ${formatNumber(totalFollows)} подписок выборки (${Math.round(
        share * 100,
      )}%). Гипотеза для повтора, не доказанный паттерн.`,
      recommendation: `Разберите «${displayTitle(
        followLeader,
      )}»: что в первых кадрах дало подписки, и повторите этот заход в 2 ближайших роликах.`,
      sampleSize: live.length,
      reels: buildReels([followLeader]),
      tone: 'positive',
    })
  }

  const shareSave = (post: PostRecord) => (post.shares || 0) + (post.saves || 0)
  const totalShareSave = sum(live.map(shareSave))
  const shareSaveLeader = [...live].sort((a, b) => shareSave(b) - shareSave(a))[0]
  if (shareSaveLeader && totalShareSave >= 5 && shareSave(shareSaveLeader) / totalShareSave >= 0.55) {
    const share = shareSave(shareSaveLeader) / totalShareSave
    add({
      id: 'share-save-concentration',
      metric: 'shareSave',
      direction: 'flat',
      effect: share,
      title: 'Репосты и сохранения держатся на одном лидере',
      detail: `«${displayTitle(shareSaveLeader)}» собрал ${formatNumber(
        shareSave(shareSaveLeader),
      )} из ${formatNumber(
        totalShareSave,
      )} репостов+сохранений. Считается по действиям, без смешивания с reach-rate.`,
      recommendation:
        'Пока не считайте репосты/сохранения стабильным каналом — дождитесь, чтобы их дали 2–3 разных ролика.',
      sampleSize: live.length,
      reels: buildReels([shareSaveLeader]),
      tone: 'neutral',
    })
  }

  return insights.sort((a, b) => b.score - a.score).slice(0, 12)
}
