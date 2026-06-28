import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Clock3,
  CloudDownload,
  Plug,
  Compass,
  ExternalLink,
  FileVideo2,
  Film,
  Flame,
  Gauge,
  Hash,
  Heart,
  Info,
  KeyRound,
  Layers3,
  Lightbulb,
  Lock,
  Menu,
  Moon,
  MoveRight,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Search,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react'
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { api, mediaUrl, ownerToken, thumbnailUrl } from './api'
import {
  benchmarkTier,
  buildAudience,
  classifyCreative,
  comparePostMetric,
  compactCount,
  createInsights,
  creativeTitle,
  demographics,
  detectViewOutliers,
  displayTitle,
  filterPosts,
  formatDate,
  formatNumber,
  formatPercent,
  getHookLabel,
  groupByDimension,
  groupPosts,
  growthFunnel,
  median,
  platformScoreboard,
  pluralReels,
  pluralSegments,
  retentionDropPoint,
  summarize,
  timeSeries,
  topContentTags,
  trafficSources,
  uniqueHookOptions,
  uniqueOptions,
  uniqueTags,
  type AudienceDimensionAgg,
  type Dimension,
  type GrowthFunnel,
  type MetricComparison,
  type PlatformScoreboard,
  type Tier,
} from './lib'
import { MetricInfo } from './MetricInfo'
import type { MetricKey } from './glossary'
import { OwnerProvider, useOwner } from './owner'
import { EntryForm } from './EntryForm'
import type {
  DashboardData,
  Entry,
  Filters,
  Insight,
  InsightMetric,
  ManualNotes,
  MediaItem,
  PostRecord,
  TrackProfile,
} from './types'

const TRACK_ENERGY_RU: Record<string, string> = {
  high: 'высокая энергия',
  mid: 'средняя энергия',
  low: 'низкая энергия',
}
// Track enums come in English from the audio probe — translate before display so the RU
// UI never shows «бит: steady» / «бас: heavy».
const BEAT_RU: Record<string, string> = {
  steady: 'ровный бит',
  sparse: 'разреженный бит',
  driving: 'гонящий бит',
  punchy: 'панчевый бит',
  syncopated: 'синкопа',
}
const BASS_RU: Record<string, string> = {
  heavy: 'плотный бас',
  light: 'лёгкий бас',
  deep: 'глубокий бас',
  sub: 'саб-бас',
  warm: 'тёплый бас',
}
function trackSummary(track?: TrackProfile) {
  if (!track) return ''
  const parts: string[] = []
  if (track.name) parts.push(track.name)
  const energy = TRACK_ENERGY_RU[track.energyTier]
  if (energy) parts.push(energy)
  if (track.mood) parts.push(track.mood)
  if (track.beat) parts.push(BEAT_RU[track.beat] ?? `бит: ${track.beat}`)
  if (track.bass) parts.push(BASS_RU[track.bass] ?? `бас: ${track.bass}`)
  if (track.loudnessMeanDb !== null && track.loudnessMeanDb !== undefined)
    parts.push(`${track.loudnessMeanDb} dB`)
  return parts.join(' · ')
}

const OverviewCharts = lazy(() => import('./OverviewCharts'))

// ---- Theme (dark default, light persisted in localStorage) ----
type Theme = 'dark' | 'light'
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => undefined,
})
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem('ai-dash-theme') === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ai-dash-theme', theme)
  }, [theme])
  const toggle = useCallback(() => setTheme((current) => (current === 'dark' ? 'light' : 'dark')), [])
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}
function useTheme() {
  return useContext(ThemeContext)
}
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      className="sync-button theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      <span>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span>
    </button>
  )
}

// ---- Benchmark tier badges ----
function TierPill({ tier }: { tier: Tier | null }) {
  if (!tier) return null
  return <span className={`tier-pill ${tier.key}`}>{tier.label}</span>
}
function TierDot({ tier }: { tier: Tier | null }) {
  return <span className={`tier-dot ${tier ? tier.key : 'none'}`} title={tier?.label} />
}

// A date input where the whole control is clickable and the value reads in RU, so it's
// obvious where to click and what's selected (no raw mm/dd/yyyy).
function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const open = () => {
    const el = ref.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        // some browsers throw if not user-activated — fall back to focus
      }
    }
    el.focus()
  }
  return (
    <div className="date-field" onClick={open}>
      <span className="date-field-label">{label}</span>
      <span className={`date-field-value${value ? '' : ' empty'}`}>
        {value ? formatDate(value) : 'Любая'}
      </span>
      <input
        ref={ref}
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      {value && (
        <button
          type="button"
          className="date-clear"
          aria-label="Очистить дату"
          onClick={(e) => {
            e.stopPropagation()
            onChange('')
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

const emptyFilters: Filters = {
  dateFrom: '',
  dateTo: '',
  platform: '',
  account: '',
  model: '',
  format: '',
  hook: '',
  tag: '',
  duration: '',
}

const baseNav = [
  { to: '/', label: 'Сводка', icon: Target },
  { to: '/posts', label: 'Ролики', icon: Clapperboard },
  { to: '/creatives', label: 'Креативы', icon: Sparkles },
  { to: '/compare', label: 'Сравнение', icon: Layers3 },
  { to: '/audience', label: 'Аудитория', icon: Users },
  { to: '/insights', label: 'Инсайты', icon: Lightbulb },
  { to: '/models', label: 'Модели', icon: Gauge },
  { to: '/sync', label: 'Источник', icon: CloudDownload },
]

function TagChips({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <div className="tag-chips">
      {tags.map((tag) => (
        <span key={tag}>
          <Hash size={10} />
          {tag}
        </span>
      ))}
    </div>
  )
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Все</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function FiltersBar({
  filters,
  setFilters,
  posts,
}: {
  filters: Filters
  setFilters: (filters: Filters) => void
  posts: PostRecord[]
}) {
  const liveDates = useMemo(
    () =>
      posts
        .filter((post) => post.recordType === 'LIVE' && post.publishedAt)
        .map((post) => post.publishedAt.slice(0, 10))
        .sort((a, b) => a.localeCompare(b)),
    [posts],
  )
  const minDate = liveDates[0] || ''
  const maxDate = liveDates[liveDates.length - 1] || ''
  const options = useMemo(
    () => ({
      models: uniqueOptions(posts, 'model'),
      formats: uniqueOptions(posts, 'format'),
      hooks: uniqueHookOptions(posts),
      tags: uniqueTags(posts),
    }),
    [posts],
  )
  const active = [
    filters.dateFrom,
    filters.dateTo,
    filters.platform,
    filters.model,
    filters.format,
    filters.hook,
    filters.tag,
    filters.duration,
  ].filter(Boolean).length
  const update = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value })
  const applyDateRange = (dateFrom: string, dateTo: string) =>
    setFilters({ ...filters, dateFrom, dateTo })
  const applyLastDays = (days: number) => {
    if (!maxDate) return
    const date = new Date(`${maxDate}T00:00:00`)
    date.setDate(date.getDate() - (days - 1))
    applyDateRange(date.toISOString().slice(0, 10), maxDate)
  }
  const applyMonth = () => {
    if (!maxDate) return
    applyDateRange(`${maxDate.slice(0, 7)}-01`, maxDate)
  }

  return (
    <section className="filters">
      <div className="filters-heading">
        <div>
          <span className="eyebrow">ФИЛЬТРЫ ВЫБОРКИ</span>
          <strong>{active ? `Активно: ${active}` : 'Все LIVE-публикации'}</strong>
        </div>
        {active > 0 && (
          <button className="text-button" onClick={() => setFilters(emptyFilters)}>
            <X size={15} /> Сбросить
          </button>
        )}
      </div>
      <div className="filter-grid">
        <div className="date-filter">
          <div className="date-fields">
            <DateField
              label="Дата с"
              value={filters.dateFrom}
              onChange={(v) => update('dateFrom', v)}
              min={minDate}
              max={filters.dateTo || maxDate}
            />
            <DateField
              label="Дата по"
              value={filters.dateTo}
              onChange={(v) => update('dateTo', v)}
              min={filters.dateFrom || minDate}
              max={maxDate}
            />
          </div>
          <div className="date-presets">
            <button type="button" onClick={() => applyDateRange('', '')}>Все даты</button>
            <button type="button" onClick={() => applyDateRange(minDate, maxDate)} disabled={!minDate}>Диапазон данных</button>
            <button type="button" onClick={() => applyLastDays(7)} disabled={!maxDate}>7 дней</button>
            <button type="button" onClick={applyMonth} disabled={!maxDate}>Месяц</button>
          </div>
        </div>
        <label>
          Платформа
          <select value={filters.platform} onChange={(e) => update('platform', e.target.value)}>
            <option value="">Все</option>
            <option>Instagram</option>
            <option>TikTok</option>
          </select>
        </label>
        <SelectFilter label="Модель" value={filters.model} options={options.models} onChange={(v) => update('model', v)} />
        <SelectFilter label="Способ генерации" value={filters.format} options={options.formats} onChange={(v) => update('format', v)} />
        <SelectFilter label="Хук" value={filters.hook} options={options.hooks} onChange={(v) => update('hook', v)} />
        {options.tags.length > 0 && (
          <SelectFilter label="Тег" value={filters.tag} options={options.tags} onChange={(v) => update('tag', v)} />
        )}
        <label>
          Длительность
          <select value={filters.duration} onChange={(e) => update('duration', e.target.value)}>
            <option value="">Любая</option>
            <option value="short">до 7 сек</option>
            <option value="medium">8–15 сек</option>
            <option value="long">16–30 сек</option>
            <option value="extra">31+ сек</option>
          </select>
        </label>
      </div>
    </section>
  )
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <FileVideo2 size={28} />
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  )
}

function PageHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string
  title: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {action}
    </header>
  )
}

function AddReelButton() {
  const { isOwner } = useOwner()
  if (!isOwner) return null
  return (
    <Link className="button primary" to="/add">
      <Plus size={16} /> Добавить ролик
    </Link>
  )
}

function KpiTile({
  eyebrow,
  value,
  sub,
  tier,
  icon: Icon,
  accent,
}: {
  eyebrow: string
  value: string
  sub: React.ReactNode
  tier: Tier | null
  icon: typeof BarChart3
  accent?: boolean
}) {
  return (
    <article className={`kpi-tile${accent ? ' accent' : ''}`}>
      <div className="kpi-top">
        <span className="eyebrow">{eyebrow}</span>
        <span className="kpi-icon">
          <Icon size={15} />
        </span>
      </div>
      <strong className="kpi-value">{value}</strong>
      <div className="kpi-foot">
        {tier && <TierPill tier={tier} />}
        <span className="kpi-sub">{sub}</span>
      </div>
    </article>
  )
}

function StripCell({
  label,
  value,
  infoKey,
  tierMetric,
  rawValue,
  platform,
}: {
  label: string
  value: string
  infoKey: MetricKey
  tierMetric?: string
  rawValue: number | null
  platform?: string
}) {
  const tier = tierMetric ? benchmarkTier(tierMetric, rawValue, platform) : null
  return (
    <div className="metric-strip-cell">
      <span className="lbl">
        {label}
        <MetricInfo metric={infoKey} />
      </span>
      <span className="val">
        {tierMetric && <TierDot tier={tier} />}
        {value}
      </span>
    </div>
  )
}

function TopReelRow({
  post,
  index,
  median,
  media,
}: {
  post: PostRecord
  index: number
  median: number | null
  media: MediaItem[]
}) {
  const dev = median && post.views !== null ? post.views / median - 1 : null
  return (
    <Link className="rank-item with-thumb" to={`/posts/${encodeURIComponent(post.postId)}`}>
      <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
      <PostThumb media={media} post={post} w={30} h={38} />
      <div>
        <strong>{displayTitle(post)}</strong>
        <small>
          {post.platform} · {post.model || 'Модель не указана'}
        </small>
      </div>
      <div className="rank-value">
        <b>{formatNumber(post.views)}</b>
        {dev !== null && Math.abs(dev) >= 0.05 && (
          <span className={`effect-badge ${dev >= 0 ? 'pos' : 'neg'}`}>
            {dev >= 0 ? '+' : ''}
            {Math.round(dev * 100)}%
          </span>
        )}
      </div>
    </Link>
  )
}

// The answer-first hero: the single strongest, most actionable signal stated as the move
// to make next, with its evidence reels. Derived from createInsights (highest score).
function NextMove({ insight }: { insight: Insight }) {
  return (
    <section className={`next-move ${insight.tone}`}>
      <div className="next-move-head">
        <span className="next-move-badge">
          <Target size={13} /> СЛЕДУЮЩИЙ ХОД
        </span>
        <InsightMeta insight={insight} />
      </div>
      <h2>{insight.title}</h2>
      <p>{insight.detail}</p>
      <div className="next-move-reco">
        <MoveRight size={17} />
        <span>{insight.recommendation}</span>
      </div>
      <div className="next-move-foot">
        <ReelChips reels={insight.reels} />
        <Link to="/insights" className="next-move-link">
          Все инсайты <ChevronRight size={15} />
        </Link>
      </div>
    </section>
  )
}

// IG ↔ TikTok scoreboard: the cross-platform A/B at a glance. Reach/shares/follows side
// by side, plus the headline ratios that carry the "IG ≈ ×2 reach, ×6 shares" story.
function PlatformScoreboardPanel({ board }: { board: PlatformScoreboard }) {
  const { tiktok, instagram } = board
  const rows: Array<{ label: string; tt: string; ig: string; igWins: boolean | null }> = [
    {
      label: 'Охват',
      tt: compactCount(tiktok.reach),
      ig: compactCount(instagram.reach),
      igWins: instagram.reach === tiktok.reach ? null : instagram.reach > tiktok.reach,
    },
    {
      label: 'Медиана показов',
      tt: formatNumber(tiktok.medianViews),
      ig: formatNumber(instagram.medianViews),
      igWins:
        (instagram.medianViews || 0) === (tiktok.medianViews || 0)
          ? null
          : (instagram.medianViews || 0) > (tiktok.medianViews || 0),
    },
    {
      label: 'Подписки',
      tt: formatNumber(tiktok.follows),
      ig: formatNumber(instagram.follows),
      igWins: instagram.follows === tiktok.follows ? null : instagram.follows > tiktok.follows,
    },
    {
      label: 'Репосты',
      tt: formatNumber(tiktok.shares),
      ig: formatNumber(instagram.shares),
      igWins: instagram.shares === tiktok.shares ? null : instagram.shares > tiktok.shares,
    },
    {
      label: 'ER',
      tt: formatPercent(tiktok.engagementRateByReach),
      ig: formatPercent(instagram.engagementRateByReach),
      igWins: null,
    },
  ]
  const xLabel = (ratio: number | null) =>
    ratio && ratio >= 1.15 ? `×${ratio.toFixed(1).replace('.', ',')}` : null
  const reachX = xLabel(board.reachRatio)
  const sharesX = xLabel(board.sharesRatio)
  return (
    <section className="panel scoreboard">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ПЛАТФОРМЕННЫЙ СЧЁТ</span>
          <h2>TikTok ↔ Instagram</h2>
        </div>
      </div>
      <div className="sb-head">
        <span className="sb-corner" />
        <span className="sb-plat tt">
          TikTok<small>{tiktok.reels} {pluralReels(tiktok.reels)}</small>
        </span>
        <span className="sb-plat ig">
          Instagram<small>{instagram.reels} {pluralReels(instagram.reels)}</small>
        </span>
      </div>
      <div className="sb-rows">
        {rows.map((row) => (
          <div className="sb-row" key={row.label}>
            <span className="sb-label">{row.label}</span>
            <span className={`sb-val tt${row.igWins === false ? ' win' : ''}`}>{row.tt}</span>
            <span className={`sb-val ig${row.igWins === true ? ' win' : ''}`}>{row.ig}</span>
          </div>
        ))}
      </div>
      {(reachX || sharesX) && (
        <div className="sb-takeaway">
          <Compass size={15} />
          <p>
            {reachX && (
              <>
                Instagram даёт <b>{reachX} охвата</b> TikTok
              </>
            )}
            {reachX && sharesX && ' и '}
            {sharesX && (
              <>
                <b>{sharesX} репостов</b>
              </>
            )}
            . Репосты гонят ролик в Explore — главный драйвер прорывов на Instagram.
          </p>
        </div>
      )}
    </section>
  )
}

// Aggregate growth funnel: reach → profile visits → follows (over the cohort that has
// profile data), plus the "returns" signal (репосты+сохранения > лайков).
function GrowthFunnelPanel({ funnel }: { funnel: GrowthFunnel }) {
  const top = Math.max(...funnel.steps.map((step) => step.value), 1)
  const returns = funnel.shares + funnel.saves
  return (
    <section className="panel funnel-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ВОРОНКА РОСТА</span>
          <h2>Из показа в подписку</h2>
        </div>
        <small>
          по {funnel.cohortReels} из {funnel.totalReels} {pluralReels(funnel.totalReels)}
        </small>
      </div>
      <div className="funnel-steps">
        {funnel.steps.map((step, index) => (
          <div className="funnel-step" key={step.key}>
            <div className="funnel-step-head">
              <span>{step.label}</span>
              <strong>{formatNumber(step.value)}</strong>
            </div>
            <div className="funnel-bar">
              <span
                className={`funnel-fill s${index}`}
                style={{ width: `${Math.max((step.value / top) * 100, 1.5)}%` }}
              />
            </div>
            {step.ofPrev !== null && index > 0 && (
              <small className="funnel-conv">
                {formatPercent(step.ofPrev)}{' '}
                {index === 1 ? 'охвата заходят в профиль' : 'из зашедших подписались'}
              </small>
            )}
          </div>
        ))}
      </div>
      <div className="funnel-returns">
        <span className="returns-stat">
          <Repeat2 size={14} /> {formatNumber(funnel.shares)} репостов
        </span>
        <span className="returns-stat">
          <Heart size={14} /> {formatNumber(funnel.saves)} сохранений
        </span>
        <p>
          {returns > 0
            ? 'Возвратные действия важнее лайков — к ролику возвращаются и им делятся.'
            : 'Пока нет репостов и сохранений — ролики развлекают, но к ним не возвращаются.'}
        </p>
      </div>
    </section>
  )
}

// Playbook: winning levers (delai) vs anti-patterns (izbegai), derived from the same
// insight engine so it stays honest and live — never a hard-coded recipe.
function Playbook({ positive, negative }: { positive: Insight[]; negative: Insight[] }) {
  if (!positive.length && !negative.length) return null
  const Column = ({
    kind,
    title,
    icon: Icon,
    items,
    empty,
  }: {
    kind: 'do' | 'avoid'
    title: string
    icon: typeof BarChart3
    items: Insight[]
    empty: string
  }) => (
    <div className={`playbook-col ${kind}`}>
      <header>
        <Icon size={15} />
        <h3>{title}</h3>
        <span className="count">{items.length}</span>
      </header>
      {items.length ? (
        items.slice(0, 3).map((insight) => (
          <Link
            to="/insights"
            className="playbook-item"
            key={insight.id}
            title={insight.recommendation}
          >
            <strong>{insight.title}</strong>
            <p>{insight.recommendation}</p>
          </Link>
        ))
      ) : (
        <p className="playbook-empty">{empty}</p>
      )}
    </div>
  )
  return (
    <section className="panel playbook">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ИНСАЙТЫ · ПО ТЕКУЩЕЙ ВЫБОРКЕ</span>
          <h2>Что повторять, чего избегать</h2>
        </div>
        <Link to="/insights" className="text-link">
          Подробно <ChevronRight size={14} />
        </Link>
      </div>
      <div className="playbook-grid">
        <Column
          kind="do"
          title="Повторять"
          icon={CheckCircle2}
          items={positive}
          empty="Пока нет приёмов с уверенным подъёмом ≥20% над медианой."
        />
        <Column
          kind="avoid"
          title="Избегать"
          icon={AlertTriangle}
          items={negative}
          empty="Просадок ниже медианы на ≥20% не нашлось — это хорошо."
        />
      </div>
    </section>
  )
}

// Which content elements lift median views — the content-first "what works" leaderboard.
function ContentLeaderboard({ posts }: { posts: PostRecord[] }) {
  const tags = useMemo(() => topContentTags(posts, 2).slice(0, 6), [posts])
  if (tags.length < 2) return null
  const max = Math.max(...tags.map((tag) => tag.median || 0), 1)
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ВЫИГРЫШНОЕ СОДЕРЖАНИЕ</span>
          <h2>Какие элементы тянут показы</h2>
        </div>
      </div>
      <div className="content-bars">
        {tags.map((tag) => (
          <div className="content-bar" key={tag.tag}>
            <div className="content-bar-head">
              <span className="cb-tag">
                <Hash size={11} />
                {tag.tag}
              </span>
              <strong>{formatNumber(tag.median)}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${Math.max(((tag.median || 0) / max) * 100, 2)}%` }} />
            </div>
            <div className="content-bar-foot">
              <span>
                {tag.reels} {pluralReels(tag.reels)}
              </span>
              {tag.lift !== null && Math.abs(tag.lift) >= 0.05 && (
                <span className={`effect-badge ${tag.lift >= 0 ? 'pos' : 'neg'}`}>
                  {tag.lift >= 0 ? '+' : ''}
                  {Math.round(tag.lift * 100)}% к медиане
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Overview({
  posts,
  filters,
  setFilters,
  exampleCount,
  media,
}: {
  posts: PostRecord[]
  filters: Filters
  setFilters: (filters: Filters) => void
  exampleCount: number
  media: MediaItem[]
}) {
  const { theme } = useTheme()
  const filtered = useMemo(() => filterPosts(posts, filters), [posts, filters])
  const summary = useMemo(() => summarize(filtered), [filtered])
  const timeline = useMemo(() => timeSeries(filtered), [filtered])
  const top = useMemo(
    () =>
      [...filtered]
        .filter((post) => post.views !== null)
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5),
    [filtered],
  )
  const outliers = useMemo(() => detectViewOutliers(filtered).slice(0, 3), [filtered])
  const insights = useMemo(() => createInsights(filtered), [filtered])
  const nextMove = insights.find((insight) => insight.tone !== 'neutral') || insights[0]
  const positive = insights.filter(
    (insight) => insight.tone === 'positive' && insight.id !== nextMove?.id,
  )
  const negative = insights.filter(
    (insight) => insight.tone === 'negative' && insight.id !== nextMove?.id,
  )
  const board = useMemo(() => platformScoreboard(filtered), [filtered])
  const funnel = useMemo(() => growthFunnel(filtered), [filtered])
  // When the view is filtered to one platform, benchmark rate-based KPIs against THAT
  // platform's thresholds (TikTok ≈ 2× Instagram on reach-rates) instead of the blend.
  const plat = filters.platform || undefined
  const models = useMemo(
    () => Array.from(new Set(filtered.map((post) => post.model).filter(Boolean))),
    [filtered],
  )

  return (
    <>
      <PageHeading
        eyebrow="СВОДКА РОСТА"
        title="Что снимать дальше"
        detail={`${models.length === 1 ? models[0] : models.length ? `${models.length} моделей` : 'Модели не указаны'} · ${summary.count} ${pluralReels(summary.count)} в выборке. Один экран отвечает: что сработало, почему и какой ход сделать в следующем ролике.`}
        action={<AddReelButton />}
      />
      <FiltersBar filters={filters} setFilters={setFilters} posts={posts} />
      {!filtered.length ? (
        <div className="notice">
          <CircleAlert size={18} />
          <div>
            <strong>В текущей выборке нет LIVE-роликов.</strong>
            <p>
              {exampleCount
                ? `Есть ${exampleCount} демонстрационных строк — они намеренно исключены из аналитики. `
                : ''}
              Добавьте ролик, чтобы увидеть метрики.
            </p>
          </div>
        </div>
      ) : (
        <>
          {nextMove && <NextMove insight={nextMove} />}

          <div className="kpi-cockpit">
            <KpiTile
              eyebrow="ПОКАЗЫ · LIVE"
              value={formatNumber(summary.views)}
              sub={`медиана ${formatNumber(summary.medianViews)} / ролик`}
              tier={benchmarkTier('medianViews', summary.medianViews)}
              icon={Play}
            />
            <KpiTile
              eyebrow="НОВЫЕ ПОДПИСКИ"
              value={formatNumber(summary.follows)}
              sub={`${formatPercent(summary.followConversionByReach)} от охвата`}
              tier={benchmarkTier('followConversion', summary.followConversionByReach, plat)}
              icon={Users}
            />
            <KpiTile
              eyebrow="ВОВЛЕЧЁННОСТЬ · ER"
              value={formatPercent(summary.engagementRateByReach)}
              sub="реакции ÷ охват"
              tier={benchmarkTier('engagementRateByReach', summary.engagementRateByReach, plat)}
              icon={Flame}
            />
            <KpiTile
              eyebrow="ДОСМАТРИВАЕМОСТЬ · VTR"
              value={formatPercent(summary.retention)}
              sub="среднее ÷ длина"
              tier={benchmarkTier('retentionRate', summary.retention)}
              icon={Gauge}
            />
          </div>

          <div className="metric-strip">
            <StripCell label="Репосты + сейвы" value={formatPercent(summary.shareSaveRateByReach)} infoKey="shareSaveRate" tierMetric="shareSaveRate" rawValue={summary.shareSaveRateByReach} platform={plat} />
            <StripCell label="В подписку" value={formatPercent(summary.followConversionByReach)} infoKey="followConversion" rawValue={summary.followConversionByReach} />
            <StripCell label="Досмотр до конца" value={formatPercent(summary.completionRate)} infoKey="completionRate" tierMetric="completionRate" rawValue={summary.completionRate} />
            <StripCell label="IG hold" value={formatPercent(summary.holdRate)} infoKey="holdRate" rawValue={summary.holdRate} />
          </div>

          {(board.hasBoth || funnel) && (
            <div className="cockpit-duo">
              {board.hasBoth && <PlatformScoreboardPanel board={board} />}
              {funnel && <GrowthFunnelPanel funnel={funnel} />}
            </div>
          )}

          <Playbook positive={positive} negative={negative} />

          <div className="cockpit-main">
            <Suspense
              fallback={
                <section className="panel chart-panel cockpit-chart">
                  <div className="empty-state">
                    <RefreshCw className="spin" size={22} />
                    <strong>Готовим график…</strong>
                  </div>
                </section>
              }
            >
              <OverviewCharts timeline={timeline} theme={theme} />
            </Suspense>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <span className="eyebrow">ЛИДЕРЫ</span>
                  <h2>Топ роликов</h2>
                </div>
                <Link to="/posts" className="text-link">
                  Все ролики <ChevronRight size={14} />
                </Link>
              </div>
              {top.length ? (
                <div className="rank-list">
                  {top.map((post, index) => (
                    <TopReelRow key={post.postId} post={post} index={index} median={summary.medianViews} media={media} />
                  ))}
                </div>
              ) : (
                <EmptyState title="Пока нет рейтинга" detail="Нужны LIVE-ролики с просмотрами." />
              )}
            </section>
          </div>

          <div className="cockpit-secondary">
            <ContentLeaderboard posts={filtered} />
            <section className="panel">
              <div className="panel-title">
                <div>
                  <span className="eyebrow">АНОМАЛИИ</span>
                  <h2>Заметно выше или ниже нормы</h2>
                </div>
              </div>
              {outliers.length ? (
                <div className="rank-list">
                  {outliers.map(({ post, z, direction }) => (
                    <Link className="rank-item" to={`/posts/${encodeURIComponent(post.postId)}`} key={post.postId}>
                      <span className={`anomaly-dot ${direction}`}>
                        <AlertTriangle size={13} />
                      </span>
                      <div>
                        <strong>{displayTitle(post)}</strong>
                        <small>
                          {post.platform} · {post.model || '—'}
                        </small>
                      </div>
                      <b className={direction === 'high' ? 'pos' : 'neg'}>
                        {direction === 'high' ? '▲' : '▼'} z {z.toFixed(1)}
                      </b>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="Аномалий нет" detail="Для оценки выбросов нужно минимум 5 роликов с просмотрами." />
              )}
            </section>
          </div>
        </>
      )}
    </>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  return <span className={`platform ${platform.toLowerCase()}`}>{platform}</span>
}

function PostThumb({
  media,
  post,
  w = 40,
  h = 40,
}: {
  media: MediaItem[]
  post: PostRecord
  w?: number
  h?: number
}) {
  const item = media.find(
    (m) => m.bindingId === post.postId || (post.creativeId && m.bindingId === post.creativeId),
  )
  const [failed, setFailed] = useState(false)
  // The thumbnail route self-heals (generates the frame on first request), so we attempt
  // the image whenever a video exists rather than gating on the thumbnailFile flag.
  if (item && !failed) {
    return (
      <img
        className="post-thumb"
        style={{ width: w, height: h }}
        src={thumbnailUrl(item.id)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className="post-thumb post-thumb-ph" style={{ width: w, height: h }}>
      <Film size={Math.round(Math.min(w, h) * 0.4)} />
    </div>
  )
}

function PostsPage({
  posts,
  filters,
  setFilters,
  media,
}: {
  posts: PostRecord[]
  filters: Filters
  setFilters: (filters: Filters) => void
  media: MediaItem[]
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'views' | 'date' | 'engagement'>('views')
  const [page, setPage] = useState(1)
  const perPage = 12

  const rows = useMemo(() => {
    const needle = search.toLowerCase()
    return filterPosts(posts, filters)
      .filter((post) =>
        [post.postId, post.creativeId, post.model, post.description, post.account, post.tags.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      .sort((a, b) => {
        if (sort === 'date') return (b.publishedAt || '').localeCompare(a.publishedAt || '')
        if (sort === 'engagement') return (b.engagementRateByReach || 0) - (a.engagementRateByReach || 0)
        return (b.views || 0) - (a.views || 0)
      })
  }, [posts, filters, search, sort])

  const pages = Math.max(1, Math.ceil(rows.length / perPage))
  const visible = rows.slice((page - 1) * perPage, page * perPage)

  useEffect(() => setPage(1), [search, sort, filters])

  return (
    <>
      <PageHeading
        eyebrow="РОЛИКИ"
        title="Библиотека публикаций"
        detail="Поиск, сортировка, видеофайлы и подробная карточка каждой публикации."
        action={<AddReelButton />}
      />
      <FiltersBar filters={filters} setFilters={setFilters} posts={posts} />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input placeholder="Post ID, модель, тег, описание…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="views">Сначала по просмотрам</option>
            <option value="date">Сначала новые</option>
            <option value="engagement">По engagement rate</option>
          </select>
          <span className="result-count">{rows.length} результатов</span>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Ролик</th>
                <th>Платформа</th>
                <th>Модель</th>
                <th>Дата</th>
                <th>
                  Просмотры <MetricInfo metric="views" />
                </th>
                <th>
                  ER <MetricInfo metric="engagementRateByReach" />
                </th>
                <th>
                  Подписки <MetricInfo metric="follows" />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((post) => (
                <tr key={post.postId}>
                  <td>
                    <div className="post-row">
                      <PostThumb media={media} post={post} />
                      <div className="post-cell">
                        <strong>{displayTitle(post)}</strong>
                        <small>{post.postId} · {post.creativeId || 'без Creative ID'}</small>
                        <TagChips tags={post.tags} />
                      </div>
                    </div>
                  </td>
                  <td><PlatformBadge platform={post.platform} /></td>
                  <td>{post.model || '—'}</td>
                  <td>{formatDate(post.publishedAt)}</td>
                  <td className="numeric">
                    <span className="cell-bench">
                      <TierDot tier={benchmarkTier('views', post.views)} />
                      {formatNumber(post.views)}
                    </span>
                  </td>
                  <td className="numeric">
                    <span className="cell-bench">
                      <TierDot tier={benchmarkTier('engagementRateByReach', post.engagementRateByReach, post.platform)} />
                      {formatPercent(post.engagementRateByReach)}
                    </span>
                  </td>
                  <td className="numeric">{formatNumber(post.follows)}</td>
                  <td>
                    <Link className="icon-button" to={`/posts/${encodeURIComponent(post.postId)}`} aria-label="Открыть ролик">
                      <ChevronRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <EmptyState
            title="Ролики не найдены"
            detail="Измените фильтры или добавьте ролик."
            action={<AddReelButton />}
          />
        )}
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</button>
          <span>{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Дальше</button>
        </div>
      </section>
    </>
  )
}

function NotesEditor({
  postId,
  notes,
  onSaved,
}: {
  postId: string
  notes?: ManualNotes
  onSaved: () => void
}) {
  const { isOwner } = useOwner()
  const [form, setForm] = useState({
    works: notes?.works || '',
    doesntWork: notes?.doesntWork || '',
    hypothesis: notes?.hypothesis || '',
    changeNext: notes?.changeNext || '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    setSaving(true)
    setError('')
    try {
      await api.saveNotes(postId, form)
      setSaved(true)
      onSaved()
      window.setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить заметки')
    } finally {
      setSaving(false)
    }
  }
  const fields = [
    ['works', 'Что работает'],
    ['doesntWork', 'Что не работает'],
    ['hypothesis', 'Гипотеза'],
    ['changeNext', 'Что изменить'],
  ] as const
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">РУЧНОЙ РАЗБОР</span>
          <h2>Заметки</h2>
        </div>
        {notes?.updatedAt && <small>Обновлено {formatDate(notes.updatedAt)}</small>}
      </div>
      {!isOwner && <p className="muted readonly-hint">Войдите как владелец, чтобы редактировать заметки.</p>}
      <div className="notes-grid">
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              value={form[key]}
              disabled={!isOwner}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              placeholder="Зафиксируйте наблюдение без домыслов…"
            />
          </label>
        ))}
      </div>
      {error && <div className="error-box">{error}</div>}
      {isOwner && (
        <button className="button primary" onClick={submit} disabled={saving}>
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Сохранено' : 'Сохранить заметки'}
        </button>
      )}
    </section>
  )
}

function CohortStat({ title, cmp }: { title: string; cmp: MetricComparison | null }) {
  if (!cmp || cmp.count < 2) {
    return (
      <div className="cohort-stat">
        <span className="eyebrow">{title}</span>
        <p className="muted">Недостаточно роликов для сравнения.</p>
      </div>
    )
  }
  const deviation = cmp.deviationFromMedian
  const tone = deviation === null ? '' : deviation > 0.05 ? 'pos' : deviation < -0.05 ? 'neg' : ''
  return (
    <div className="cohort-stat">
      <span className="eyebrow">{title}</span>
      <div className="cohort-row">
        <div>
          <small>Позиция</small>
          <strong>#{cmp.rank} из {cmp.count}</strong>
        </div>
        <div>
          <small>Процентиль</small>
          <strong>{formatPercent(cmp.percentile)}</strong>
        </div>
        <div>
          <small>vs медиана</small>
          <strong className={tone}>
            {deviation === null ? '—' : `${deviation > 0 ? '+' : ''}${(deviation * 100).toFixed(0)}%`}
          </strong>
        </div>
      </div>
      {cmp.isOutlier && (
        <span className={`anomaly-badge ${cmp.z && cmp.z > 0 ? 'high' : 'low'}`}>
          <AlertTriangle size={12} /> Статистический выброс (z {cmp.z?.toFixed(1)})
        </span>
      )}
    </div>
  )
}

function ReelVerdict({ modelCmp, platformCmp }: { modelCmp: MetricComparison | null; platformCmp: MetricComparison | null }) {
  const cmp = modelCmp && modelCmp.count >= 2 ? modelCmp : platformCmp
  if (!cmp || cmp.count < 2 || cmp.deviationFromMedian === null) return null
  const dev = cmp.deviationFromMedian
  const z = cmp.z ?? 0
  let text: string
  let tone: string
  if (cmp.isOutlier && z > 0) {
    text = 'Сильный выброс вверх — изучите как референс и попробуйте повторить хук/формат.'
    tone = 'pos'
  } else if (cmp.isOutlier && z < 0) {
    text = 'Сильный выброс вниз — проверьте, не разовая ли это аномалия.'
    tone = 'neg'
  } else if (dev > 0.5) {
    text = 'Заметно выше нормы — хороший кандидат в референсы.'
    tone = 'pos'
  } else if (dev < -0.5) {
    text = 'Заметно ниже нормы — проверьте, не аномалия ли это, прежде чем делать выводы.'
    tone = 'neg'
  } else {
    text = 'В пределах типичного результата для этой выборки.'
    tone = 'neutral'
  }
  return (
    <div className={`reel-verdict ${tone}`}>
      <Trophy size={16} />
      <p>{text}</p>
    </div>
  )
}

function ContentPanel({ post }: { post: PostRecord }) {
  const ca = post.contentAnalysis
  const rows = (
    [
      ['Хук', ca.hook],
      ['Действие', ca.action],
      ['Сцена', ca.scene],
      ['Субъект', ca.subject],
      ['Динамика', ca.pacing],
      ['Концовка', ca.ending],
    ] as Array<[string, string]>
  ).filter(([, value]) => value)
  if (!rows.length && !post.contentTags.length && !ca.whyItWorked) return null
  return (
    <section className="panel content-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ЧТО В РОЛИКЕ</span>
          <h2>Содержание и почему сработало</h2>
        </div>
      </div>
      {post.contentTags.length > 0 && <TagChips tags={post.contentTags} />}
      {rows.length > 0 && (
        <div className="content-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      {ca.whyItWorked && (
        <div className="reel-verdict pos">
          <Lightbulb size={16} />
          <p>{ca.whyItWorked}</p>
        </div>
      )}
    </section>
  )
}

type MetricRow = {
  label: string
  value: string
  info?: MetricKey
  tier?: { metric: string; value: number | null; platform?: string }
}

function ShareBars({ title, rows }: { title: string; rows: Array<{ label: string; pct: number }> }) {
  if (!rows.length) return null
  return (
    <div className="reel-extra">
      <span className="eyebrow">{title}</span>
      <div className="extra-bars">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="extra-bar-head">
              <span>{row.label}</span>
              <strong>{formatPercent(row.pct)}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${Math.min(row.pct * 100, 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Forward-looking next step from the reel's weakest lever (not just "почему сработало").
function forwardRecommendation(post: PostRecord): string {
  const fyp = post.extraMetrics?.traffic_foryou_pct
  if (typeof fyp === 'number' && fyp < 30)
    return 'Охват зарезан рекомендациями (FYP) — сделайте кадр менее explicit и более styled/вариативным, чтобы пройти модерацию ленты.'
  if (benchmarkTier('completionRate', post.completionRate)?.key === 'weak')
    return 'Досмотр ниже нормы — укоротите ролик и ускорьте смену кадров в первые 2 секунды.'
  if (benchmarkTier('followConversion', post.followConversion)?.key === 'weak')
    return 'Подписок мало относительно показов — дайте повод подписаться: серийность, обещание продолжения, узнаваемый образ.'
  if (post.commentRate !== null && post.commentRate < 0.003)
    return 'Комментариев мало — задайте вопрос на мнение или спор, а не флирт-вопрос (на него молча скроллят).'
  return 'Метрики в норме — повторите рабочий приём и протестируйте ровно один новый элемент (трек, хук или длину).'
}

// Reel page answer-first banner: what kind of hook this is (the thing that stops the
// scroll) and the single most useful next step, derived from the reel's weakest lever.
function ReelHookBanner({ post }: { post: PostRecord }) {
  return (
    <section className="reel-hook">
      <div className="reel-hook-head">
        <span className="reel-hook-badge">
          <Sparkles size={12} /> ХУК
        </span>
        <strong>{getHookLabel(post)}</strong>
      </div>
      <div className="reel-hook-reco">
        <MoveRight size={15} />
        <span>{forwardRecommendation(post)}</span>
      </div>
    </section>
  )
}

// P3 — conversion funnel (показ → профиль → подписка) + P2 — «возвратные» действия.
// Manual: репосты и сохранения важнее лайков; «лайкнул, но не сохранил» = развлекает,
// но не цепляет (к ролику не возвращаются, им не делятся).
function ReelFunnel({ post }: { post: PostRecord }) {
  const reach = post.reach
  if (reach === null && post.profileVisits === null && post.follows === null) return null
  const top = Math.max(reach || 0, post.profileVisits || 0, post.follows || 0, 1)
  const pct = (a: number | null, b: number | null) =>
    a !== null && b && b > 0 ? formatPercent(a / b) : null
  const steps = [
    { label: 'Охват · увидели', value: reach },
    {
      label: `Заходы в профиль${pct(post.profileVisits, reach) ? ` · ${pct(post.profileVisits, reach)} от охвата` : ''}`,
      value: post.profileVisits,
    },
    {
      label: `Подписки${
        pct(post.follows, post.profileVisits)
          ? ` · ${pct(post.follows, post.profileVisits)} из зашедших`
          : pct(post.follows, reach)
            ? ` · ${pct(post.follows, reach)} от охвата`
            : ''
      }`,
      value: post.follows,
    },
  ]
  const returns = (post.shares || 0) + (post.saves || 0)
  const weakReturn = (post.likes || 0) > 0 && returns === 0
  return (
    <section className="panel reel-extras">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ВОРОНКА: ИЗ ПОКАЗА В ПОДПИСКУ</span>
          <h2>Кто прошёл дальше просмотра</h2>
        </div>
      </div>
      <div className="reel-extra">
        <div className="extra-bars">
          {steps.map((step) => (
            <div key={step.label}>
              <div className="extra-bar-head">
                <span>{step.label}</span>
                <strong>{formatNumber(step.value)}</strong>
              </div>
              <div className="bar-track">
                <span style={{ width: `${Math.min(((step.value || 0) / top) * 100, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="muted">
        Возвратные действия: <strong>{formatNumber(post.shares)}</strong> репостов ·{' '}
        <strong>{formatNumber(post.saves)}</strong> сохранений.{' '}
        {weakReturn
          ? 'Лайки есть, а сохранений и репостов нет — ролик развлекает, но не цепляет: к нему не возвращаются и им не делятся.'
          : 'Репосты и сохранения важнее лайков — это сигнал, что к ролику возвращаются и им делятся (главный драйвер Explore).'}
      </p>
    </section>
  )
}

// Surfaces the rich data we capture but used to hide: traffic sources, this reel's
// demographics, the retention drop-off point, and a forward-looking recommendation.
function ReelExtras({ post }: { post: PostRecord }) {
  const traffic = trafficSources(post)
  const demo = demographics(post)
  const drop = retentionDropPoint(post.sourceNotes)
  const hasAudience =
    traffic.length || demo.gender.length || demo.age.length || demo.countries.length
  return (
    <section className="panel reel-extras">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ИСТОЧНИКИ И АУДИТОРИЯ РОЛИКА</span>
          <h2>Откуда пришли и кто смотрел</h2>
        </div>
      </div>
      {hasAudience ? (
        <div className="reel-extras-grid">
          <ShareBars title="ИСТОЧНИКИ ТРАФИКА" rows={traffic} />
          <ShareBars title="ПОЛ" rows={demo.gender} />
          <ShareBars title="ВОЗРАСТ" rows={demo.age} />
          <ShareBars title="ГЕОГРАФИЯ" rows={demo.countries.slice(0, 6)} />
        </div>
      ) : (
        <p className="muted">По этому ролику не вносились источники трафика и демография.</p>
      )}
      {drop && (
        <div className="retention-chip">
          <Clock3 size={14} /> Основной обрыв удержания — на {drop}
        </div>
      )}
    </section>
  )
}

function PostDetail({
  data,
  entries,
  reload,
}: {
  data: DashboardData
  entries: Entry[]
  reload: () => Promise<void> | void
}) {
  const { postId = '' } = useParams()
  const { isOwner } = useOwner()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const decodedId = decodeURIComponent(postId)
  const post = data.posts.find((item) => item.postId === decodedId)
  const entry = entries.find((item) => item.postId === decodedId)

  const live = useMemo(() => data.posts.filter((item) => item.recordType === 'LIVE'), [data.posts])
  const modelCohort = useMemo(
    () => (post ? live.filter((item) => item.model === post.model && post.model) : []),
    [live, post],
  )
  const platformCohort = useMemo(
    () => (post ? live.filter((item) => item.platform === post.platform) : []),
    [live, post],
  )
  const modelCmp = useMemo(
    () => (post ? comparePostMetric(post.views, modelCohort, (item) => item.views) : null),
    [post, modelCohort],
  )
  const platformCmp = useMemo(
    () => (post ? comparePostMetric(post.views, platformCohort, (item) => item.views) : null),
    [post, platformCohort],
  )

  if (!post) return <Navigate to="/posts" replace />

  const mediaItems = data.media.filter(
    (item) => item.bindingId === post.postId || (post.creativeId && item.bindingId === post.creativeId),
  )
  const metrics: MetricRow[] = [
    { label: 'Просмотры', value: formatNumber(post.views), info: 'views', tier: { metric: 'views', value: post.views } },
    { label: 'Охват', value: formatNumber(post.reach), info: 'reach' },
    { label: 'Лайки', value: formatNumber(post.likes) },
    { label: 'Комментарии', value: formatNumber(post.comments) },
    { label: 'Репосты', value: formatNumber(post.shares ?? post.reposts) },
    { label: 'Сохранения', value: formatNumber(post.saves) },
    { label: 'Новые подписки', value: formatNumber(post.follows), info: 'follows' },
    { label: 'Подписчиков на старте', value: formatNumber(post.followersAtPublish) },
    { label: 'VTR (досматриваемость)', value: formatPercent(post.retentionRate), info: 'retentionRate', tier: { metric: 'retentionRate', value: post.retentionRate } },
    { label: 'ER', value: formatPercent(post.engagementRateByReach), info: 'engagementRateByReach', tier: { metric: 'engagementRateByReach', value: post.engagementRateByReach, platform: post.platform } },
    { label: 'Репосты, %', value: formatPercent(post.shareRate), info: 'shareRate' },
    { label: 'Сохранения, %', value: formatPercent(post.saveRate), info: 'saveRate' },
    { label: 'В подписку', value: formatPercent(post.followConversion), info: 'followConversion', tier: { metric: 'followConversion', value: post.followConversion, platform: post.platform } },
    post.platform === 'Instagram'
      ? { label: 'IG Hold rate', value: formatPercent(post.holdRate), info: 'holdRate' }
      : { label: 'Досмотр до конца', value: formatPercent(post.completionRate), info: 'completionRate', tier: { metric: 'completionRate', value: post.completionRate } },
  ]

  async function remove() {
    if (!entry) return
    setDeleting(true)
    setError('')
    try {
      await api.deleteEntry(entry.id)
      await reload()
      navigate('/posts')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить ролик')
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeading
        eyebrow={`${post.platform.toUpperCase()} / ${post.postId}`}
        title={displayTitle(post)}
        detail={`${post.model || 'Модель не указана'} · ${formatDate(post.publishedAt)}`}
        action={
          <div className="heading-actions">
            {post.postUrl && (
              <a className="button secondary" href={post.postUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> Публикация
              </a>
            )}
            {isOwner && entry && (
              <Link className="button secondary" to={`/posts/${encodeURIComponent(post.postId)}/edit`}>
                <Pencil size={15} /> Изменить
              </Link>
            )}
            {isOwner && entry && (
              <button className="button danger" onClick={() => setConfirming(true)} disabled={deleting}>
                <Trash2 size={15} /> Удалить
              </button>
            )}
            <Link className="button secondary" to="/posts">К списку</Link>
          </div>
        }
      />
      {error && <div className="error-box">{error}</div>}
      <ReelHookBanner post={post} />
      <div className="detail-grid">
        <section className="panel detail-main">
          {mediaItems[0] ? (
            <video
              className="detail-video"
              controls
              playsInline
              poster={thumbnailUrl(mediaItems[0].id)}
              src={mediaUrl(mediaItems[0].id)}
            />
          ) : (
            <EmptyState title="Видео ещё не загружено" detail={isOwner ? 'Добавьте видео через «Изменить».' : 'Файл появится после загрузки владельцем.'} />
          )}
          <div className="detail-copy">
            <div><span>Creative ID</span><strong>{post.creativeId || '—'}</strong></div>
            <div><span>Способ генерации</span><strong>{post.format || '—'}</strong></div>
            <div><span>Тема</span><strong>{post.contentPillar || '—'}</strong></div>
            <div><span>Длительность</span><strong>{post.duration ? `${post.duration} сек` : '—'}</strong></div>
            <div className="full"><span>Трек (аудио-профиль)</span><strong>{trackSummary(post.track) || '—'}</strong></div>
            <div className="full"><span>Хук / сцена</span><strong>{getHookLabel(post)}</strong></div>
            <div className="full"><span>Текст на видео</span><strong>{post.textOnVideo || '—'}</strong></div>
            {post.tags.length > 0 && (
              <div className="full"><span>Теги</span><TagChips tags={post.tags} /></div>
            )}
            {post.sourceNotes && (
              <div className="full"><span>Заметка</span><strong>{post.sourceNotes}</strong></div>
            )}
          </div>
        </section>
        <section className="panel metrics-list">
          <span className="eyebrow">МЕТРИКИ ПУБЛИКАЦИИ</span>
          {metrics.map((row) => (
            <div key={row.label}>
              <span>
                {row.label}
                {row.info && <MetricInfo metric={row.info} />}
              </span>
              <strong>
                {row.tier && <TierPill tier={benchmarkTier(row.tier.metric, row.tier.value, row.tier.platform)} />}
                {row.value}
              </strong>
            </div>
          ))}
        </section>
      </div>
      <ReelFunnel post={post} />
      <ReelExtras post={post} />
      <ContentPanel post={post} />
      <section className="panel position-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">ПОЗИЦИЯ РОЛИКА</span>
            <h2>Как просмотры выглядят на фоне остальных</h2>
          </div>
        </div>
        <ReelVerdict modelCmp={modelCmp} platformCmp={platformCmp} />
        <div className="cohort-grid">
          <CohortStat title={`Среди модели «${post.model || '—'}»`} cmp={modelCmp} />
          <CohortStat title={`Среди ${post.platform}`} cmp={platformCmp} />
        </div>
      </section>
      <NotesEditor postId={post.postId} notes={data.notes[post.postId]} onSaved={() => void reload()} />
      {confirming && (
        <ConfirmDialog
          title="Удалить ролик?"
          detail="Запись, видео и скриншоты будут удалены безвозвратно."
          confirmLabel="Удалить"
          onConfirm={() => {
            setConfirming(false)
            void remove()
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}

function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  detail: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{detail}</p>
        <div className="modal-actions">
          <button className="button secondary" onClick={onCancel}>Отмена</button>
          <button className="button danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function AddReelPage({ posts, reload }: { posts: PostRecord[]; reload: () => Promise<void> | void }) {
  const { isOwner, checking } = useOwner()
  const navigate = useNavigate()
  const models = useMemo(() => uniqueOptions(posts, 'model'), [posts])
  const formats = useMemo(() => uniqueOptions(posts, 'format'), [posts])
  if (checking) return <div className="empty-state"><RefreshCw className="spin" size={22} /><strong>Проверяем доступ…</strong></div>
  if (!isOwner) return <Navigate to="/" replace />
  return (
    <>
      <PageHeading eyebrow="ДОБАВЛЕНИЕ" title="Новый ролик" detail="Заполняйте по одному: модель, платформа, дата, видео, скриншоты, метрики." />
      <EntryForm
        mode="create"
        models={models}
        formats={formats}
        onSaved={async (postId) => {
          await reload()
          navigate(`/posts/${encodeURIComponent(postId)}`)
        }}
        onCancel={() => navigate('/posts')}
      />
    </>
  )
}

function EditReelPage({
  posts,
  entries,
  reload,
}: {
  posts: PostRecord[]
  entries: Entry[]
  reload: () => Promise<void> | void
}) {
  const { isOwner, checking } = useOwner()
  const { postId = '' } = useParams()
  const navigate = useNavigate()
  const models = useMemo(() => uniqueOptions(posts, 'model'), [posts])
  const formats = useMemo(() => uniqueOptions(posts, 'format'), [posts])
  const entry = entries.find((item) => item.postId === decodeURIComponent(postId))
  if (checking) return <div className="empty-state"><RefreshCw className="spin" size={22} /><strong>Проверяем доступ…</strong></div>
  if (!isOwner) return <Navigate to="/" replace />
  if (!entry) {
    return (
      <>
        <PageHeading eyebrow="РЕДАКТИРОВАНИЕ" title="Ролик недоступен для правки" detail="Через UI редактируются только ролики, добавленные владельцем." />
        <EmptyState title="Нет редактируемой записи" detail="Сид-данные и таблица доступны только для чтения." action={<Link className="button secondary" to={`/posts/${encodeURIComponent(postId)}`}>Назад к ролику</Link>} />
      </>
    )
  }
  return (
    <>
      <PageHeading eyebrow="РЕДАКТИРОВАНИЕ" title={entry.model} detail={`${entry.platform} · ${formatDate(entry.publishedAt)}`} />
      <EntryForm
        mode="edit"
        entry={entry}
        models={models}
        formats={formats}
        onSaved={async (savedPostId) => {
          await reload()
          navigate(`/posts/${encodeURIComponent(savedPostId)}`)
        }}
        onCancel={() => navigate(`/posts/${encodeURIComponent(entry.postId)}`)}
      />
    </>
  )
}

function ComparePage({ posts, media }: { posts: PostRecord[]; media: MediaItem[] }) {
  const [mode, setMode] = useState<'videos' | 'dimension'>('videos')
  const live = useMemo(() => posts.filter((post) => post.recordType === 'LIVE'), [posts])
  return (
    <>
      <PageHeading
        eyebrow="СРАВНЕНИЕ"
        title="Что с чем сравнить"
        detail="Сравнивайте ролики бок о бок или агрегаты по модели, платформе, теме, формату, хуку и тегам."
        action={
          <div className="segmented">
            <button className={mode === 'videos' ? 'on' : ''} onClick={() => setMode('videos')}>Ролики</button>
            <button className={mode === 'dimension' ? 'on' : ''} onClick={() => setMode('dimension')}>Измерения</button>
          </div>
        }
      />
      {mode === 'videos' ? <VideoCompare live={live} media={media} /> : <DimensionCompare live={live} />}
    </>
  )
}

const DIMENSION_LABELS: Array<{ key: Dimension; label: string }> = [
  { key: 'model', label: 'Модель' },
  { key: 'platform', label: 'Платформа' },
  { key: 'contentPillar', label: 'Тема' },
  { key: 'format', label: 'Способ генерации' },
  { key: 'hook', label: 'Хук' },
  { key: 'contentTag', label: 'Тег содержания' },
  { key: 'trackEnergy', label: 'Энергия трека' },
  { key: 'tag', label: 'Тег' },
]

function DimensionCompare({ live }: { live: PostRecord[] }) {
  const [dimension, setDimension] = useState<Dimension>('model')
  const groups = useMemo(
    () => groupByDimension(live, dimension).filter((group) => group.items.length > 0),
    [live, dimension],
  )
  const maxMedian = Math.max(1, ...groups.map((group) => group.summary.medianViews || 0))
  return (
    <>
      <section className="panel selector-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">ИЗМЕРЕНИЕ</span>
            <h2>Сравнить по</h2>
          </div>
          <select value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}>
            {DIMENSION_LABELS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </div>
      </section>
      {groups.length ? (
        <>
        <section className="panel audience-card dim-bars">
          <div className="panel-title">
            <div>
              <span className="eyebrow">МЕДИАНА ПРОСМОТРОВ</span>
              <h2>Кто впереди</h2>
            </div>
          </div>
          <div className="audience-bars">
            {groups.map((group) => (
              <div key={group.name}>
                <div><span>{group.name}</span><strong>{formatNumber(group.summary.medianViews)}</strong></div>
                <div className="bar-track">
                  <span style={{ width: `${Math.max(2, ((group.summary.medianViews || 0) / maxMedian) * 100)}%` }} />
                </div>
                <small>{group.items.length} роликов · ER {formatPercent(group.summary.engagementRateByReach)}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel table-panel">
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Значение</th>
                  <th>Роликов</th>
                  <th>Медиана</th>
                  <th>Средние</th>
                  <th>ER</th>
                  <th>Share+Save</th>
                  <th>Подписки</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.name}>
                    <td><strong>{group.name}</strong></td>
                    <td className="numeric">{group.items.length}</td>
                    <td className="numeric">{formatNumber(group.summary.medianViews)}</td>
                    <td className="numeric">{formatNumber(group.summary.meanViews)}</td>
                    <td className="numeric">{formatPercent(group.summary.engagementRateByReach)}</td>
                    <td className="numeric">{formatPercent(group.summary.shareSaveRateByReach)}</td>
                    <td className="numeric">{formatNumber(group.summary.follows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </>
      ) : (
        <EmptyState title="Нет данных для сравнения" detail="Добавьте больше LIVE-роликов с заполненным измерением." />
      )}
    </>
  )
}

function VideoCompare({ live, media }: { live: PostRecord[]; media: MediaItem[] }) {
  const [selected, setSelected] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [rate, setRate] = useState(1)
  const [position, setPosition] = useState(0)
  const refs = useRef<Record<string, HTMLVideoElement | null>>({})
  const lastPosition = useRef(0)
  const chosen = selected.map((id) => live.find((post) => post.postId === id)).filter(Boolean) as PostRecord[]
  const maxDuration = Math.max(0, ...chosen.map((post) => post.duration || 0))
  // Per-metric winner across the chosen reels — for cross-platform A/B of a track/creative.
  const bestId = (getter: (post: PostRecord) => number | null) => {
    let id: string | null = null
    let top = -Infinity
    let count = 0
    chosen.forEach((post) => {
      const value = getter(post)
      if (value === null) return
      count += 1
      if (value > top) {
        top = value
        id = post.postId
      }
    })
    const allEqual = chosen.every((post) => (getter(post) ?? -Infinity) === top)
    return count >= 2 && !allEqual ? id : null
  }
  const winners = {
    views: bestId((post) => post.views),
    retention: bestId((post) => post.retentionRate),
    er: bestId((post) => post.engagementRateByReach),
    follows: bestId((post) => post.follows),
    completion: bestId((post) => (post.platform === 'Instagram' ? post.holdRate : post.completionRate)),
  }
  const crossPlatformCreatives = useMemo(
    () =>
      Array.from(
        live.reduce((groups, post) => {
          if (!post.creativeId) return groups
          groups.set(post.creativeId, [...(groups.get(post.creativeId) || []), post])
          return groups
        }, new Map<string, PostRecord[]>()),
      ).filter(([, items]) => new Set(items.map((post) => post.platform)).size > 1),
    [live],
  )

  const findMedia = (post: PostRecord) =>
    media.find((item) => item.bindingType === 'post' && item.bindingId === post.postId) ||
    media.find((item) => item.bindingType === 'creative' && item.bindingId === post.creativeId)

  function togglePost(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current,
    )
  }
  function togglePlay() {
    const next = !playing
    Object.values(refs.current).forEach((video) => {
      if (!video) return
      if (next) void video.play()
      else video.pause()
    })
    setPlaying(next)
  }
  function seek(value: number) {
    setPosition(value)
    Object.values(refs.current).forEach((video) => {
      if (video) video.currentTime = value
    })
  }
  function changeRate(value: number) {
    setRate(value)
    Object.values(refs.current).forEach((video) => {
      if (video) video.playbackRate = value
    })
  }

  return (
    <>
      <section className="panel selector-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">ВЫБОР РОЛИКОВ</span>
            <h2>{selected.length}/4 выбрано</h2>
          </div>
          {selected.length > 0 && (
            <button className="text-button" onClick={() => setSelected([])}>Очистить</button>
          )}
        </div>
        {crossPlatformCreatives.length > 0 && (
          <div className="creative-shortcuts">
            <span>Один Creative ID в Instagram + TikTok:</span>
            {crossPlatformCreatives.map(([creativeId, items]) => (
              <button key={creativeId} onClick={() => setSelected(items.slice(0, 4).map((post) => post.postId))}>
                {creativeTitle(items, creativeId)}
              </button>
            ))}
          </div>
        )}
        <div className="post-picker">
          {live.map((post) => (
            <button
              className={selected.includes(post.postId) ? 'selected' : ''}
              onClick={() => togglePost(post.postId)}
              key={post.postId}
            >
              <PlatformBadge platform={post.platform} />
              <strong>{displayTitle(post)}</strong>
              <small>{post.creativeId || 'без Creative ID'} · {formatNumber(post.views)} просмотров</small>
              {selected.includes(post.postId) && <Check size={16} />}
            </button>
          ))}
        </div>
        {!live.length && <EmptyState title="Нет LIVE-роликов" detail="Добавьте ролики, чтобы их сравнивать." />}
      </section>
      {chosen.length >= 2 ? (
        <>
          <section className="compare-controls panel">
            <button className="button primary compact" onClick={togglePlay}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
              {playing ? 'Пауза' : 'Воспроизвести'}
            </button>
            <label className="seek">
              <input
                type="range"
                aria-label="Перемотка"
                min="0"
                max={maxDuration || 1}
                step="0.1"
                value={position}
                onChange={(e) => seek(Number(e.target.value))}
              />
              <span>{position.toFixed(1)} сек</span>
            </label>
            <label>
              Скорость
              <select value={rate} onChange={(e) => changeRate(Number(e.target.value))}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                  <option value={value} key={value}>{value}×</option>
                ))}
              </select>
            </label>
            <button className={`toggle ${loop ? 'on' : ''}`} onClick={() => setLoop(!loop)}>
              Повтор {loop ? 'вкл' : 'выкл'}
            </button>
          </section>
          <section className={`compare-grid count-${chosen.length}`}>
            {chosen.map((post) => {
              const file = findMedia(post)
              return (
                <article className="compare-card panel" key={post.postId}>
                  {file ? (
                    <video
                      ref={(node) => {
                        refs.current[post.postId] = node
                      }}
                      src={mediaUrl(file.id)}
                      poster={file.thumbnailFile ? thumbnailUrl(file.id) : undefined}
                      loop={loop}
                      muted
                      playsInline
                      onTimeUpdate={(e) => {
                        if (post.postId !== chosen[0].postId) return
                        const time = e.currentTarget.currentTime
                        if (Math.abs(time - lastPosition.current) < 0.1) return
                        lastPosition.current = time
                        setPosition(time)
                      }}
                    />
                  ) : (
                    <div className="compare-placeholder">
                      <Film size={28} />
                      <span>Нет видео</span>
                    </div>
                  )}
                  <div className="compare-title">
                    <PlatformBadge platform={post.platform} />
                    <strong>{displayTitle(post)}</strong>
                    <small>{post.postId} · {post.creativeId || 'без Creative ID'}</small>
                  </div>
                  <dl>
                    <div><dt>Просмотры</dt><dd className={winners.views === post.postId ? 'win' : ''}>{formatNumber(post.views)}</dd></div>
                    <div><dt>VTR</dt><dd className={winners.retention === post.postId ? 'win' : ''}>{formatPercent(post.retentionRate)}</dd></div>
                    <div><dt>ER</dt><dd className={winners.er === post.postId ? 'win' : ''}>{formatPercent(post.engagementRateByReach)}</dd></div>
                    <div><dt>Подписки</dt><dd className={winners.follows === post.postId ? 'win' : ''}>{formatNumber(post.follows)}</dd></div>
                    <div>
                      <dt>{post.platform === 'Instagram' ? 'Hold rate' : 'Completion'}</dt>
                      <dd className={winners.completion === post.postId ? 'win' : ''}>{formatPercent(post.platform === 'Instagram' ? post.holdRate : post.completionRate)}</dd>
                    </div>
                    <div className="compare-track">
                      <dt>Трек</dt>
                      <dd>{trackSummary(post.track) || '—'}</dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </section>
        </>
      ) : (
        <EmptyState title="Выберите минимум два ролика" detail="Можно сравнить до четырёх публикаций одновременно." />
      )}
    </>
  )
}

// ---- Creatives ----

type CreativeGroup = { name: string; items: PostRecord[]; summary: ReturnType<typeof summarize> }

const latestDate = (group: CreativeGroup) =>
  group.items.reduce((latest, post) => (post.publishedAt > latest ? post.publishedAt : latest), '')
const leaderCompletion = (group: CreativeGroup) => {
  const leader = [...group.items].sort((a, b) => (b.views || 0) - (a.views || 0))[0]
  return leader ? (leader.platform === 'Instagram' ? leader.holdRate : leader.completionRate) : null
}

function CreativeAB({ tt, ig }: { tt: PostRecord; ig: PostRecord }) {
  const rows: Array<{ label: string; tt: number | null; ig: number | null; fmt: (v: number | null) => string }> = [
    { label: 'Просмотры', tt: tt.views, ig: ig.views, fmt: formatNumber },
    { label: 'VTR', tt: tt.retentionRate, ig: ig.retentionRate, fmt: formatPercent },
    { label: 'Досмотр / Hold', tt: tt.completionRate, ig: ig.holdRate, fmt: formatPercent },
    { label: 'ER', tt: tt.engagementRateByReach, ig: ig.engagementRateByReach, fmt: formatPercent },
    { label: 'Подписки', tt: tt.follows, ig: ig.follows, fmt: formatNumber },
  ]
  const scored = rows.map((row) => {
    const a = row.tt ?? 0
    const b = row.ig ?? 0
    const winner = a === b ? null : a > b ? 'tt' : 'ig'
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return { ...row, winner, delta: lo > 0 ? hi / lo - 1 : null }
  })
  const headline = [...scored].filter((row) => row.delta !== null).sort((a, b) => (b.delta || 0) - (a.delta || 0))[0]
  const trackLine =
    tt.track?.energyTier || ig.track?.energyTier
      ? `Трек: TT — ${trackSummary(tt.track) || '—'} · IG — ${trackSummary(ig.track) || '—'}`
      : ''
  return (
    <div className="cc-ab">
      <span className="eyebrow">A/B ПО ПЛАТФОРМАМ</span>
      {headline && headline.winner && (
        <div className="cc-ab-winner">
          {headline.winner === 'tt' ? 'TikTok' : 'Instagram'} сильнее по «{headline.label}» (+
          {Math.round((headline.delta || 0) * 100)}%)
        </div>
      )}
      <div className="cc-ab-table">
        <div className="cc-ab-row head">
          <span />
          <span className="tt">TT</span>
          <span className="ig">IG</span>
          <span>Δ</span>
        </div>
        {scored.map((row) => (
          <div className="cc-ab-row" key={row.label}>
            <span className="cc-ab-label">{row.label}</span>
            <span className={`cc-ab-val tt${row.winner === 'tt' ? ' win' : ''}`}>{row.fmt(row.tt)}</span>
            <span className={`cc-ab-val ig${row.winner === 'ig' ? ' win' : ''}`}>{row.fmt(row.ig)}</span>
            <span className="cc-ab-delta">
              {row.delta !== null ? `+${Math.round(row.delta * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
      {trackLine && <p className="cc-ab-track">{trackLine}</p>}
    </div>
  )
}

function CreativeCard({
  group,
  live,
  media,
  index,
}: {
  group: CreativeGroup
  live: PostRecord[]
  media: MediaItem[]
  index: number
}) {
  const leader = [...group.items].sort((a, b) => (b.views || 0) - (a.views || 0))[0]
  if (!leader) return null
  const verdict = classifyCreative(group.items, live)
  const title = creativeTitle(group.items, group.name, index)
  const platforms = Array.from(new Set(group.items.map((post) => post.platform)))
  const ratio = leader && leader.views !== null ? leader.views / 571 : null
  const tt = group.items.find((post) => post.platform === 'TikTok')
  const ig = group.items.find((post) => post.platform === 'Instagram')
  const completion = leaderCompletion(group)
  return (
    <article className="creative-card panel">
      <div className="cc-head">
        <Link className="cc-thumb-link" to={`/posts/${encodeURIComponent(leader.postId)}`}>
          <PostThumb media={media} post={leader} w={56} h={56} />
        </Link>
        <div className="cc-title">
          <Link to={`/posts/${encodeURIComponent(leader.postId)}`}>
            <strong>{title}</strong>
          </Link>
          <span className="cc-slug">
            {group.name} · {platforms.map((p) => (p === 'TikTok' ? 'TT' : 'IG')).join('+')}
          </span>
        </div>
        <span className="cc-count">
          {group.items.length} {pluralReels(group.items.length)}
        </span>
      </div>
      {verdict.flag !== 'baseline' && (
        <div className={`cc-flag ${verdict.tone}`}>
          <span className="cc-flag-tag">{verdict.label}</span>
          <span className="cc-flag-why">{verdict.cause}</span>
        </div>
      )}
      <div className="mini-metrics">
        <div>
          <span>Просмотры</span>
          <strong>{formatNumber(group.summary.views)}</strong>
        </div>
        <div>
          <span>×к медиане</span>
          <strong className={ratio && ratio >= 1 ? 'pos' : 'neg'}>
            {ratio ? `×${ratio.toFixed(1).replace('.', ',')}` : '—'}
          </strong>
        </div>
        <div>
          <span>{leader?.platform === 'Instagram' ? 'Hold' : 'Досмотр'}</span>
          <strong>{formatPercent(completion)}</strong>
        </div>
        <div>
          <span>Подписки</span>
          <strong>{formatNumber(group.summary.follows)}</strong>
        </div>
      </div>
      {tt && ig && <CreativeAB tt={tt} ig={ig} />}
    </article>
  )
}

const CREATIVE_SORTS: Array<{ key: string; label: string }> = [
  { key: 'views', label: 'По просмотрам' },
  { key: 'date', label: 'По дате' },
  { key: 'er', label: 'По ER' },
  { key: 'completion', label: 'По досмотру' },
  { key: 'anomaly', label: 'Сначала аномалии' },
]
const FLAG_ORDER: Record<string, number> = {
  breakout: 0,
  fyp_throttled: 1,
  long_low_completion: 2,
  underperform: 3,
  baseline: 4,
}

function CreativesPage({ posts, media }: { posts: PostRecord[]; media: MediaItem[] }) {
  const live = useMemo(() => posts.filter((post) => post.recordType === 'LIVE'), [posts])
  const [sortKey, setSortKey] = useState('views')
  const groups = useMemo(() => {
    const base = groupPosts(live.filter((post) => post.creativeId), 'creativeId') as CreativeGroup[]
    const withFlag =
      sortKey === 'anomaly'
        ? new Map(base.map((group) => [group.name, classifyCreative(group.items, live).flag]))
        : null
    return [...base].sort((a, b) => {
      if (sortKey === 'date') return latestDate(b).localeCompare(latestDate(a))
      if (sortKey === 'er') return (b.summary.engagementRateByReach || 0) - (a.summary.engagementRateByReach || 0)
      if (sortKey === 'completion') return (leaderCompletion(b) || 0) - (leaderCompletion(a) || 0)
      if (sortKey === 'anomaly')
        return (
          (FLAG_ORDER[withFlag!.get(a.name) || 'baseline'] - FLAG_ORDER[withFlag!.get(b.name) || 'baseline']) ||
          b.summary.views - a.summary.views
        )
      return b.summary.views - a.summary.views
    })
  }, [live, sortKey])

  return (
    <>
      <PageHeading
        eyebrow="КРЕАТИВЫ"
        title="Результаты креативов"
        detail="Один креатив объединяет публикации Instagram и TikTok. Превью, аномалии с причиной и A/B по платформам."
        action={
          <label className="sort-select">
            Сортировка
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {CREATIVE_SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <div className="cards-grid">
        {groups.map((group, index) => (
          <CreativeCard key={group.name} group={group} live={live} media={media} index={index} />
        ))}
      </div>
      {!groups.length && (
        <EmptyState title="Нет креативов" detail="Добавьте LIVE-публикации с заполненным Creative ID." />
      )}
    </>
  )
}

// ---- Models ----

function ModelCard({ group, media }: { group: CreativeGroup; media: MediaItem[] }) {
  const sorted = [...group.items].sort((a, b) => (b.views || 0) - (a.views || 0))
  const top = sorted.slice(0, 4)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  const tt = group.items.filter((post) => post.platform === 'TikTok')
  const ig = group.items.filter((post) => post.platform === 'Instagram')
  return (
    <article className="group-card panel model-card">
      <div className="group-title">
        <div>
          <span className="eyebrow">МОДЕЛЬ</span>
          <h2>{group.name}</h2>
        </div>
        <span>
          {group.items.length} {pluralReels(group.items.length)}
        </span>
      </div>
      <div className="mini-metrics">
        <div>
          <span>Просмотры</span>
          <strong>{formatNumber(group.summary.views)}</strong>
        </div>
        <div>
          <span>Медиана</span>
          <strong>{formatNumber(group.summary.medianViews)}</strong>
        </div>
        <div>
          <span>ER</span>
          <strong>{formatPercent(group.summary.engagementRateByReach)}</strong>
        </div>
        <div>
          <span>Подписки</span>
          <strong>{formatNumber(group.summary.follows)}</strong>
        </div>
      </div>
      <div className="model-split">
        <span className="tt">
          TikTok: {tt.length} · медиана {formatNumber(median(tt.map((post) => post.views)))}
        </span>
        <span className="ig">
          Instagram: {ig.length} · медиана {formatNumber(median(ig.map((post) => post.views)))}
        </span>
      </div>
      <div className="group-posts with-thumbs">
        {top.map((post) => (
          <Link to={`/posts/${encodeURIComponent(post.postId)}`} key={post.postId}>
            <PostThumb media={media} post={post} w={28} h={36} />
            <PlatformBadge platform={post.platform} />
            <span>{displayTitle(post)}</span>
            <b>{formatNumber(post.views)}</b>
          </Link>
        ))}
      </div>
      {best && (
        <div className="model-bestworst">
          <div className="bw pos">
            <Trophy size={13} /> Лучший: {displayTitle(best)} — {formatNumber(best.views)}
          </div>
          {worst && worst.postId !== best.postId && (
            <div className="bw neg">
              ▼ Слабее всех: {displayTitle(worst)} — {formatNumber(worst.views)}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function ModelsPage({ posts, media }: { posts: PostRecord[]; media: MediaItem[] }) {
  const live = posts.filter((post) => post.recordType === 'LIVE')
  const groups = groupPosts(live, 'model') as CreativeGroup[]
  return (
    <>
      <PageHeading
        eyebrow="МОДЕЛИ"
        title="Результаты моделей"
        detail="Агрегаты по модели, её реальный топ роликов (по просмотрам), сплит TikTok/Instagram и лучший/худший ролик."
      />
      <div className="cards-grid">
        {groups.map((group) => (
          <ModelCard key={group.name} group={group} media={media} />
        ))}
      </div>
      {!groups.length && (
        <EmptyState title="Нет данных для группировки" detail="Добавьте LIVE-публикации с указанной моделью." />
      )}
    </>
  )
}

// ---- Audience (weighted by absolutes) ----

function AudienceDimensionCard({ dim, totalSelected }: { dim: AudienceDimensionAgg; totalSelected: number }) {
  const [showTail, setShowTail] = useState(false)
  const main = dim.segments.filter((seg) => seg.share >= 0.02)
  const tail = dim.segments.filter((seg) => seg.share < 0.02)
  const visible = showTail ? dim.segments : main.length ? main : dim.segments.slice(0, 5)
  const tailAbs = tail.reduce((sum, seg) => sum + seg.abs, 0)
  const tailShare = tail.reduce((sum, seg) => sum + seg.share, 0)
  return (
    <section className="panel audience-card">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ПО ОХВАТУ</span>
          <h2>{dim.dimension}</h2>
        </div>
        <div className="dim-meta">
          <div>≈ {compactCount(dim.dimTotal)} зрителей</div>
          <div>
            <b>{dim.contributingReels}</b> из {totalSelected} {pluralReels(totalSelected)}
          </div>
          {dim.fallbackReels > 0 && (
            <div className="fallback-note" title="У этих роликов нет охвата — взяты просмотры как приближение">
              ⚠ {dim.fallbackReels} по просмотрам
            </div>
          )}
        </div>
      </div>
      <div className="audience-bars">
        {visible.map((seg) => (
          <div className={seg.weak ? 'weak' : ''} key={seg.segment}>
            <div className="aud-row-head">
              <span className="seg-name">{seg.segment}</span>
              <strong className="seg-pct">{formatPercent(seg.share)}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${Math.min(seg.share * 100, 100)}%` }} />
            </div>
            <div className="aud-row-foot">
              <span className="seg-abs">~{compactCount(seg.abs)} зрителей</span>
              <span className={`seg-reels${seg.weak ? ' weak' : ''}`}>
                · {seg.reels} {pluralReels(seg.reels)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {tail.length > 0 && (
        <button className="aud-tail-toggle" onClick={() => setShowTail((v) => !v)}>
          {showTail
            ? 'Свернуть мелкие сегменты'
            : `Показать ещё ${tail.length} ${pluralSegments(tail.length)} менее 2% · ~${compactCount(tailAbs)} зрителей (${formatPercent(tailShare)})`}
        </button>
      )}
    </section>
  )
}

function AudiencePage({ posts, audience }: Pick<DashboardData, 'posts' | 'audience'>) {
  const live = useMemo(() => posts.filter((post) => post.recordType === 'LIVE'), [posts])
  const models = useMemo(() => Array.from(new Set(live.map((post) => post.model).filter(Boolean))), [live])
  const [platform, setPlatform] = useState('')
  const [model, setModel] = useState('')
  const [picker, setPicker] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)

  const base = useMemo(
    () => live.filter((post) => (!platform || post.platform === platform) && (!model || post.model === model)),
    [live, platform, model],
  )
  const selected = useMemo(
    () => (selectedIds ? base.filter((post) => selectedIds.includes(post.postId)) : base),
    [base, selectedIds],
  )
  const dims = useMemo(() => buildAudience(selected, audience), [selected, audience])
  const totalReels = selected.length

  const toggleReel = (id: string) =>
    setSelectedIds((current) => {
      const set = new Set(current ?? base.map((post) => post.postId))
      if (set.has(id)) set.delete(id)
      else set.add(id)
      // Collapse back to "all" when every reel ends up selected, so the chip reads honestly.
      return set.size === base.length ? null : Array.from(set)
    })

  return (
    <>
      <PageHeading
        eyebrow="АУДИТОРИЯ"
        title="Кто реально смотрит"
        detail="Доли взвешены по охвату каждого ролика: ролик с большим охватом весит сильнее, чем маленький. Это ближе к реальному числу людей, чем простое среднее по роликам."
      />
      <section className="audience-filter-bar">
        <div className="filter-chips">
          {['', 'TikTok', 'Instagram'].map((value) => (
            <button
              key={value || 'all'}
              className={`seg-chip${platform === value ? ` on ${value.toLowerCase()}` : ''}`}
              onClick={() => setPlatform(value)}
            >
              {value || 'Все платформы'}
            </button>
          ))}
        </div>
        {models.length > 1 && (
          <select className="aud-model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Все модели</option>
            {models.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <div className="reel-multiselect">
          <button className="seg-chip" onClick={() => setPicker((v) => !v)}>
            Ролики: {selectedIds ? `${selected.length} из ${base.length}` : `все (${base.length})`}
            <ChevronDown size={13} />
          </button>
          {selectedIds && (
            <button className="text-button" onClick={() => setSelectedIds(null)}>
              Сбросить
            </button>
          )}
          {picker && (
            <div className="reel-popover">
              {base.map((post) => {
                const checked = selectedIds ? selectedIds.includes(post.postId) : true
                return (
                  <button
                    key={post.postId}
                    className={`reel-pop-item${checked ? ' on' : ''}`}
                    onClick={() => toggleReel(post.postId)}
                  >
                    {checked ? <Check size={13} /> : <span className="box" />}
                    <span>{displayTitle(post)}</span>
                    <small>{formatNumber(post.views)}</small>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {totalReels > 0 && (
        <div className="aud-method">
          <Info size={16} />
          <div>
            <p>Считаем по абсолютам: доля сегмента × охват ролика, суммируем по выбранным роликам.</p>
            <p className="sub">
              Поэтому % здесь точнее простого среднего, но это всё ещё оценка — рядом с каждой долей
              стоит примерное число зрителей и сколько роликов её формируют.
            </p>
          </div>
          <span className="pill">
            {totalReels} {pluralReels(totalReels)} в расчёте
          </span>
        </div>
      )}
      {totalReels === 1 && (
        <div className="aud-warn">
          В расчёте 1 ролик — это просто его собственная разбивка, без взвешивания. Добавьте ролики для
          честной картины.
        </div>
      )}

      {totalReels === 0 ? (
        <EmptyState
          title="Под фильтр ничего не попало"
          detail="Сбросьте платформу/модель или верните ролики в мультивыбор."
          action={
            <button
              className="button secondary"
              onClick={() => {
                setPlatform('')
                setModel('')
                setSelectedIds(null)
              }}
            >
              Сбросить фильтры
            </button>
          }
        />
      ) : dims.length ? (
        <div className="cards-grid">
          {dims.map((dim) => (
            <AudienceDimensionCard key={dim.dimension} dim={dim} totalSelected={totalReels} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Нет данных аудитории"
          detail="У выбранных роликов нет разбивки по аудитории и нет демографии в extraMetrics."
        />
      )}
    </>
  )
}

// ---- Insights ----

const INSIGHT_METRIC_BADGE: Record<InsightMetric, string> = {
  medianViews: 'Медиана просмотров',
  completion: 'Досмотр',
  retention: 'VTR',
  follows: 'Подписки',
  comments: 'Комментарии',
  engagement: 'Вовлечённость',
  shareSave: 'Репосты + сохранения',
  fyp: 'FYP / Рекомендации',
  crossPlatform: 'Платформа',
}

function InsightMeta({ insight }: { insight: Insight }) {
  return (
    <div className="insight-meta">
      <span className="metric-badge" data-metric={insight.metric}>
        {INSIGHT_METRIC_BADGE[insight.metric]}
      </span>
      {insight.effect !== null && (
        <span className={`effect-badge ${insight.effect >= 0 ? 'pos' : 'neg'}`}>
          {insight.effect >= 0 ? '+' : ''}
          {Math.round(insight.effect * 100)}%
        </span>
      )}
      <span className="sample-pill">N={insight.sampleSize}</span>
    </div>
  )
}

function ReelChips({ reels }: { reels: Insight['reels'] }) {
  if (!reels.length) return null
  return (
    <div className="reel-chips">
      {reels.map((reel) => (
        <Link
          key={reel.postId}
          className="reel-chip"
          data-platform={reel.platform}
          title={reel.postId}
          to={`/posts/${encodeURIComponent(reel.postId)}`}
        >
          <span className="dot" />
          {reel.title}
        </Link>
      ))}
    </div>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <article className={`insight-card ${insight.tone}`}>
      <InsightMeta insight={insight} />
      <h3>{insight.title}</h3>
      <p>{insight.detail}</p>
      <div className="reco">
        <ArrowRight size={13} />
        <span>{insight.recommendation}</span>
      </div>
      <ReelChips reels={insight.reels} />
    </article>
  )
}

function HeroInsight({ insight }: { insight: Insight }) {
  return (
    <article className={`insight-hero ${insight.tone}`}>
      <span className="eyebrow">САМЫЙ СИЛЬНЫЙ СИГНАЛ</span>
      <InsightMeta insight={insight} />
      <h2>{insight.title}</h2>
      <p>{insight.detail}</p>
      <div className="reco">
        <ArrowRight size={14} />
        <span>{insight.recommendation}</span>
      </div>
      <ReelChips reels={insight.reels} />
    </article>
  )
}

function InsightsPage({ posts, filters }: { posts: PostRecord[]; filters: Filters }) {
  const filtered = filterPosts(posts, filters)
  const all = createInsights(filtered)
  const hero = all.find((insight) => insight.tone !== 'neutral')
  const positive = all.filter((insight) => insight.tone === 'positive' && insight.id !== hero?.id)
  const negative = all.filter((insight) => insight.tone === 'negative' && insight.id !== hero?.id)
  const neutral = all.filter((insight) => insight.tone === 'neutral')

  return (
    <>
      <PageHeading
        eyebrow="ИНСАЙТЫ"
        title="Что повторять и что чинить дальше"
        detail="Сигналы по текущей выборке — не причинные выводы. У каждого есть метрика-источник и конкретный ход на следующие ролики, чтобы поднять охваты, VTR и подписки."
      />
      <div className="sample-banner">
        <BarChart3 size={18} />
        <div>
          <strong>
            Текущая выборка: {filtered.length} {pluralReels(filtered.length)}
          </strong>
          <span>Ранжируем по силе сигнала (эффект × размер выборки), без «вирального скора».</span>
        </div>
      </div>
      {hero && <HeroInsight insight={hero} />}
      {all.length > 0 && (
        <>
          <section className="insight-section">
            <header className="insight-section__head pos">
              <CheckCircle2 size={15} />
              <h2>Что усиливать</h2>
              <span className="count">{positive.length}</span>
            </header>
            {positive.length ? (
              positive.map((insight) => <InsightCard key={insight.id} insight={insight} />)
            ) : (
              <p className="section-empty">Пока нет усиливающих сигналов на ≥20% выше медианы.</p>
            )}
          </section>
          <section className="insight-section">
            <header className="insight-section__head neg">
              <AlertTriangle size={15} />
              <h2>Что чинить</h2>
              <span className="count">{negative.length}</span>
            </header>
            {negative.length ? (
              negative.map((insight) => <InsightCard key={insight.id} insight={insight} />)
            ) : (
              <p className="section-empty">Просадок ниже медианы на ≥20% не нашлось — это хорошо.</p>
            )}
          </section>
          {neutral.length > 0 && (
            <section className="insight-section muted-section">
              <header className="insight-section__head">
                <Info size={15} />
                <h2>Нужно больше данных</h2>
              </header>
              {neutral.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </section>
          )}
        </>
      )}
      {!all.length && (
        <EmptyState
          title={filtered.length < 3 ? 'Недостаточно данных' : 'Выраженных закономерностей нет'}
          detail={
            filtered.length < 3
              ? 'Для любого инсайта нужно минимум 3 ролика в выборке.'
              : 'Текущие группы не отличаются от общей медианы минимум на 20%.'
          }
        />
      )}
    </>
  )
}

function SyncPage({ data }: { data: DashboardData }) {
  const live = data.posts.filter((post) => post.recordType === 'LIVE')
  return (
    <>
      <PageHeading eyebrow="ИСТОЧНИК ДАННЫХ" title="Откуда берутся ролики" detail="Все ролики, видео и скриншоты хранятся на сервере, вне репозитория. Внешних источников нет — дашборд работает автономно." />
      <div className="sync-grid">
        <section className="panel status-card">
          <span className={`status-dot ${data.sync.state === 'error' ? 'error' : 'ok'}`} />
          <span className="eyebrow">СОСТОЯНИЕ</span>
          <h2>{data.sync.state === 'error' ? 'Ошибка чтения данных' : 'Данные на месте'}</h2>
          <p>{data.sync.error || 'Дашборд работает на серверных данных — без внешних зависимостей.'}</p>
        </section>
        <section className="panel sync-facts">
          <div><span>Последнее обновление</span><strong>{data.sync.lastSuccessAt ? new Date(data.sync.lastSuccessAt).toLocaleString('ru-RU') : '—'}</strong></div>
          <div><span>LIVE-публикации</span><strong>{live.length}</strong></div>
          <div><span>Демо-строки</span><strong>{data.posts.length - live.length}</strong></div>
          <div><span>Строк аудитории</span><strong>{data.audience.filter((row) => row.recordType === 'LIVE').length}</strong></div>
          <div><span>Видео в хранилище</span><strong>{data.media.length}</strong></div>
        </section>
      </div>
      <section className="panel separation-note">
        <h2>Контуры данных</h2>
        <div><span>Записи владельца</span><p>Создаются прямо в дашборде, хранятся в entries.json вне репозитория и переживают деплои.</p></div>
        <div><span>Сид-публикации</span><p>Стартовый набор роликов из manual-intake.json — грузится вместе с кодом, только на чтение.</p></div>
        <div><span>Приватное хранилище</span><p>Видео (MP4/MOV/WebM), скриншоты, превью-кадры, длительность и разрешение.</p></div>
      </section>
    </>
  )
}

function OwnerUnlock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { unlock } = useOwner()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) return null
  async function submit() {
    setBusy(true)
    setError('')
    try {
      await unlock(token.trim())
      setToken('')
      onClose()
    } catch {
      setError('Токен не подошёл')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Режим владельца</h2>
        <p>Введите токен владельца, чтобы добавлять и редактировать ролики. Он сохранится только в этом браузере.</p>
        <input
          type="password"
          value={token}
          autoFocus
          placeholder="ADMIN_TOKEN"
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {error && <div className="error-box">{error}</div>}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>Отмена</button>
          <button className="button primary" onClick={submit} disabled={busy || !token.trim()}>
            {busy ? 'Проверяю…' : 'Войти'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Dashboard({
  data,
  entries,
  reload,
}: {
  data: DashboardData
  entries: Entry[]
  reload: () => Promise<void> | void
}) {
  const { isOwner, lock } = useOwner()
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [mobileNav, setMobileNav] = useState(false)
  const [unlockOpen, setUnlockOpen] = useState(false)

  return (
    <div className="app-shell">
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Zap size={19} /></div>
          <div>
            <strong>AI Dash</strong>
            <span>INSHIN LAB</span>
          </div>
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Закрыть меню">
            <X size={20} />
          </button>
        </div>
        <nav>
          {baseNav.map(({ to, label, icon: Icon }) => (
            <NavLink end={to === '/'} to={to} key={to} onClick={() => setMobileNav(false)}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
          {isOwner && (
            <NavLink to="/add" onClick={() => setMobileNav(false)}>
              <Plus size={18} />
              <span>Добавить</span>
            </NavLink>
          )}
          {isOwner && (
            // Standalone mobile wizard (separate page, not an SPA route).
            <a href="/ai-dash/complete" onClick={() => setMobileNav(false)}>
              <CheckCircle2 size={18} />
              <span>Досбор данных</span>
            </a>
          )}
          {isOwner && (
            <a href="/ai-dash/integrations" onClick={() => setMobileNav(false)}>
              <Plug size={18} />
              <span>Интеграции</span>
            </a>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-mini">
            <span className={`status-dot ${data.sync.state}`} />
            <div>
              <strong>{data.sync.stale ? 'Кэш устарел' : 'Данные на месте'}</strong>
              <small>{data.sync.lastSuccessAt ? formatDate(data.sync.lastSuccessAt) : 'Ручные данные'}</small>
            </div>
          </div>
        </div>
      </aside>
      {mobileNav && <button className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Закрыть меню" />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Открыть меню">
            <Menu size={20} />
          </button>
          <div><span className="live-dot" /> Открытый доступ</div>
          <div className="topbar-actions">
            <ThemeToggle />
            {isOwner ? (
              <button className="sync-button" onClick={lock}>
                <Lock size={15} />
                <span>Владелец</span>
              </button>
            ) : (
              <button className="sync-button" onClick={() => setUnlockOpen(true)}>
                <KeyRound size={15} />
                <span>Войти</span>
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Overview posts={data.posts} filters={filters} setFilters={setFilters} exampleCount={data.posts.filter((post) => post.recordType === 'EXAMPLE').length} media={data.media} />} />
            <Route path="/posts" element={<PostsPage posts={data.posts} filters={filters} setFilters={setFilters} media={data.media} />} />
            <Route path="/posts/:postId" element={<PostDetail data={data} entries={entries} reload={reload} />} />
            <Route path="/posts/:postId/edit" element={<EditReelPage posts={data.posts} entries={entries} reload={reload} />} />
            <Route path="/add" element={<AddReelPage posts={data.posts} reload={reload} />} />
            <Route path="/compare" element={<ComparePage posts={data.posts} media={data.media} />} />
            <Route path="/creatives" element={<CreativesPage posts={data.posts} media={data.media} />} />
            <Route path="/models" element={<ModelsPage posts={data.posts} media={data.media} />} />
            <Route path="/audience" element={<AudiencePage posts={data.posts} audience={data.audience} />} />
            <Route path="/insights" element={<InsightsPage posts={data.posts} filters={filters} />} />
            <Route path="/sync" element={<SyncPage data={data} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <OwnerUnlock open={unlockOpen} onClose={() => setUnlockOpen(false)} />
    </div>
  )
}

function AppInner() {
  const { isOwner } = useOwner()
  const [data, setData] = useState<DashboardData | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setError('')
    setData(await api.data())
  }, [])

  const loadEntries = useCallback(async () => {
    if (!ownerToken.has()) {
      setEntries([])
      return
    }
    try {
      setEntries((await api.listEntries()).entries)
    } catch {
      setEntries([])
    }
  }, [])

  const reload = useCallback(async () => {
    await Promise.all([loadData(), loadEntries()])
  }, [loadData, loadEntries])

  useEffect(() => {
    void loadData().catch((err) => setError(err instanceof Error ? err.message : 'Сервис недоступен'))
  }, [loadData])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries, isOwner])

  if (!data) {
    return (
      <div className="app-loader">
        <RefreshCw className={error ? '' : 'spin'} />
        <span>{error ? 'Не удалось загрузить сервис' : 'Загружаем данные…'}</span>
        {error && (
          <>
            <div className="error-box">{error}</div>
            <button className="button primary" onClick={() => void loadData().catch((err) => setError(err instanceof Error ? err.message : 'Сервис недоступен'))}>
              Повторить
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <BrowserRouter basename="/ai-dash">
      <Dashboard data={data} entries={entries} reload={reload} />
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <OwnerProvider>
        <AppInner />
      </OwnerProvider>
    </ThemeProvider>
  )
}
