import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'
import { readJsonFileSafe, writeJsonFileAtomic } from './jsonFile.js'
import { ValidationError } from './errors.js'
import { derivePost, emptyContentAnalysis, type DeriveMetrics } from './derive.js'
import type {
  ContentAnalysis,
  Entry,
  EntriesFile,
  EntryMetrics,
  EntryScreenshot,
  MediaItem,
  PostRecord,
  Platform,
  ScreenshotItem,
  TrackProfile,
} from './types.js'

const SCHEMA_VERSION = 1

const emptyMetrics = (): EntryMetrics => ({
  views: null,
  reach: null,
  likes: null,
  comments: null,
  reposts: null,
  shares: null,
  saves: null,
  follows: null,
  profileVisits: null,
  averageWatchTimeSec: null,
  totalPlayTimeSec: null,
  skipRate: null,
  completionRate: null,
})

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const cleanTags = (value: unknown): string[] => {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of list) {
    const tag = str(raw).slice(0, 40)
    const key = tag.toLowerCase()
    if (tag && !seen.has(key)) {
      seen.add(key)
      tags.push(tag)
    }
    if (tags.length >= 24) break
  }
  return tags
}

const normalizeContent = (value: unknown): ContentAnalysis => {
  const input = (value || {}) as Record<string, unknown>
  const base = emptyContentAnalysis()
  for (const key of Object.keys(base) as Array<keyof ContentAnalysis>) {
    base[key] = str(input[key]).slice(0, 1000)
  }
  return base
}

const hasContent = (content: ContentAnalysis, contentTags: string[]) =>
  contentTags.length > 0 || Object.values(content).some((value) => value.trim())

const normalizeMetrics = (value: unknown): EntryMetrics => {
  const input = (value || {}) as Record<string, unknown>
  const base = emptyMetrics()
  for (const key of Object.keys(base) as Array<keyof EntryMetrics>) {
    base[key] = numOrNull(input[key])
  }
  return base
}

const TRACK_ENERGY: TrackProfile['energyTier'][] = ['low', 'mid', 'high']
const normalizeTrack = (value: unknown): TrackProfile => {
  const input = (value || {}) as Record<string, unknown>
  const tier = str(input.energyTier)
  return {
    name: str(input.name).slice(0, 200),
    energyTier: (TRACK_ENERGY as string[]).includes(tier) ? (tier as TrackProfile['energyTier']) : '',
    loudnessMeanDb: numOrNull(input.loudnessMeanDb),
    loudnessMaxDb: numOrNull(input.loudnessMaxDb),
    beat: str(input.beat).slice(0, 40),
    bass: str(input.bass).slice(0, 40),
    vocal: str(input.vocal).slice(0, 40),
    mood: str(input.mood).slice(0, 120),
    source: str(input.source).slice(0, 120),
  }
}

const normalizeExtra = (value: unknown): Record<string, number> => {
  const input = (value || {}) as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(input)) {
    const name = str(key).slice(0, 60)
    const num = numOrNull(raw)
    if (name && num !== null) out[name] = num
  }
  return out
}

const PLATFORMS: Platform[] = ['Instagram', 'TikTok']
const normalizePlatform = (value: unknown): Platform =>
  PLATFORMS.includes(str(value) as Platform) ? (str(value) as Platform) : 'Instagram'

// Validate + normalize untrusted client input into a stored Entry shape. No file
// paths are ever taken from the client; only typed scalar fields.
function normalizeInput(input: Record<string, unknown>) {
  const postId = str(input.postId).slice(0, 80)
  return {
    postId,
    creativeId: str(input.creativeId).slice(0, 80),
    platform: normalizePlatform(input.platform),
    account: str(input.account).slice(0, 80),
    model: str(input.model).slice(0, 80),
    postUrl: str(input.postUrl).slice(0, 500),
    publishedAt: str(input.publishedAt).slice(0, 40),
    durationSec: numOrNull(input.durationSec),
    contentPillar: str(input.contentPillar).slice(0, 80),
    format: str(input.format).slice(0, 80),
    hookType: str(input.hookType).slice(0, 200),
    textOnVideo: str(input.textOnVideo).slice(0, 500),
    caption: str(input.caption).slice(0, 5000),
    note: str(input.note).slice(0, 5000),
    tags: cleanTags(input.tags),
    followersAtPublish: numOrNull(input.followersAtPublish),
    contentAnalysis: normalizeContent(input.contentAnalysis),
    contentTags: cleanTags(input.contentTags),
    track: normalizeTrack(input.track),
    recordType: str(input.recordType) === 'EXAMPLE' ? ('EXAMPLE' as const) : ('LIVE' as const),
    metrics: normalizeMetrics(input.metrics),
    extraMetrics: normalizeExtra(input.extraMetrics),
  }
}

export class EntriesStore {
  private entries: Entry[] = []
  private corrupted = false
  private readonly filePath = path.join(config.storageDir, 'entries.json')
  private writeQueue = Promise.resolve()

  async init() {
    const result = await readJsonFileSafe<EntriesFile>(this.filePath)
    this.corrupted = result.status === 'corrupt'
    if (result.value && Array.isArray(result.value.entries)) {
      this.entries = result.value.entries.map(migrateEntry)
    } else {
      this.entries = []
      // Only create a fresh file on a genuine first run, never after corruption.
      if (result.status === 'missing') await this.persist()
    }
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonFileAtomic(this.filePath, {
        schemaVersion: SCHEMA_VERSION,
        entries: this.entries,
      } satisfies EntriesFile),
    )
    return this.writeQueue
  }

  status() {
    return { count: this.entries.length, corrupted: this.corrupted }
  }

  list() {
    return [...this.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string) {
    return this.entries.find((entry) => entry.id === id) || null
  }

  private requireEntry(id: string) {
    const entry = this.get(id)
    if (!entry) throw new ValidationError('Ролик не найден')
    return entry
  }

  // Deterministic postId so the same reel logged twice is easy to spot, while still
  // letting the owner override it.
  private buildPostId(model: string, platform: Platform, publishedAt: string, explicit: string) {
    if (explicit) return explicit
    const date = publishedAt.slice(0, 10).replace(/-/g, '') || 'nodate'
    const prefix = platform === 'TikTok' ? 'TT' : 'IG'
    const modelSlug = model.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '').slice(0, 18)
    let candidate = `${prefix}_${date}_${modelSlug || 'reel'}`
    let suffix = 1
    while (this.entries.some((entry) => entry.postId === candidate)) {
      candidate = `${prefix}_${date}_${modelSlug || 'reel'}_${++suffix}`
    }
    return candidate
  }

  async create(raw: Record<string, unknown>) {
    const input = normalizeInput(raw)
    if (!input.model) throw new ValidationError('Укажите модель')
    if (!input.publishedAt) throw new ValidationError('Укажите дату публикации')

    // Duplicate protection: same model + platform + date + a matching identifier.
    const duplicate = this.entries.find(
      (entry) =>
        entry.model.toLowerCase() === input.model.toLowerCase() &&
        entry.platform === input.platform &&
        entry.publishedAt.slice(0, 10) === input.publishedAt.slice(0, 10) &&
        ((input.postUrl && entry.postUrl === input.postUrl) ||
          (input.postId && entry.postId === input.postId) ||
          (!input.postUrl &&
            !input.postId &&
            (entry.metrics.views ?? -1) === (input.metrics.views ?? -2))),
    )
    if (duplicate && !raw.allowDuplicate) {
      throw new ValidationError(
        `Похоже, такой ролик уже есть (${duplicate.postId}). Откройте его или подтвердите добавление дубликата.`,
      )
    }

    const now = new Date().toISOString()
    const analyzed = hasContent(input.contentAnalysis, input.contentTags)
    const entry: Entry = {
      ...input,
      id: crypto.randomUUID(),
      postId: this.buildPostId(input.model, input.platform, input.publishedAt, input.postId),
      analyzedBy: analyzed ? 'manual' : '',
      analyzedAt: analyzed ? now : '',
      video: null,
      screenshots: [],
      createdAt: now,
      updatedAt: now,
    }
    this.entries.push(entry)
    await this.persist()
    return entry
  }

  async update(id: string, raw: Record<string, unknown>) {
    const entry = this.requireEntry(id)
    // An empty/blank incoming postId means "keep existing" — never persist a
    // reel without a postId (it would vanish from the merged dashboard).
    const input = normalizeInput({ ...entry, ...raw, postId: str(raw.postId) || entry.postId })
    if (!input.model) throw new ValidationError('Укажите модель')
    if (!input.publishedAt) throw new ValidationError('Укажите дату публикации')
    const now = new Date().toISOString()
    const analyzed = hasContent(input.contentAnalysis, input.contentTags)
    Object.assign(entry, input, {
      id: entry.id,
      analyzedBy: analyzed ? entry.analyzedBy || 'manual' : '',
      analyzedAt: analyzed ? entry.analyzedAt || now : '',
      updatedAt: now,
    })
    await this.persist()
    return entry
  }

  async remove(id: string) {
    const entry = this.get(id)
    if (!entry) return null
    this.entries = this.entries.filter((item) => item.id !== id)
    await this.persist()
    return entry
  }

  async attachVideo(id: string, video: MediaItem) {
    const entry = this.requireEntry(id)
    const previous = entry.video
    entry.video = { ...video, bindingType: 'post', bindingId: entry.postId }
    entry.updatedAt = new Date().toISOString()
    await this.persist()
    return { entry, previous }
  }

  async addScreenshots(id: string, shots: EntryScreenshot[]) {
    const entry = this.requireEntry(id)
    entry.screenshots = [...entry.screenshots, ...shots]
    entry.updatedAt = new Date().toISOString()
    await this.persist()
    return entry
  }

  async removeScreenshot(id: string, screenshotId: string) {
    const entry = this.requireEntry(id)
    const shot = entry.screenshots.find((item) => item.id === screenshotId) || null
    entry.screenshots = entry.screenshots.filter((item) => item.id !== screenshotId)
    entry.updatedAt = new Date().toISOString()
    await this.persist()
    return shot
  }

  // ---- projections consumed by the merged /api/data ----

  toPosts(): PostRecord[] {
    return this.entries.map((entry) => {
      const metrics: DeriveMetrics = { ...entry.metrics }
      return derivePost({
        postId: entry.postId,
        creativeId: entry.creativeId,
        platform: entry.platform,
        account: entry.account,
        model: entry.model,
        postUrl: entry.postUrl,
        publishedAt: entry.publishedAt,
        durationSec: entry.durationSec ?? entry.video?.duration ?? null,
        contentPillar: entry.contentPillar,
        format: entry.format,
        hookType: entry.hookType,
        textOnVideo: entry.textOnVideo,
        caption: entry.caption,
        sourceNotes: entry.note,
        tags: entry.tags,
        followersAtPublish: entry.followersAtPublish,
        contentAnalysis: entry.contentAnalysis,
        contentTags: entry.contentTags,
        track: entry.track,
        extraMetrics: entry.extraMetrics,
        recordType: entry.recordType,
        metrics,
      })
    })
  }

  listMedia(): MediaItem[] {
    return this.entries
      .filter((entry) => entry.video)
      .map((entry) => entry.video as MediaItem)
  }

  getMedia(mediaId: string) {
    for (const entry of this.entries) {
      if (entry.video?.id === mediaId) return entry.video
    }
    return null
  }

  listScreenshots(): ScreenshotItem[] {
    return this.entries.flatMap((entry) =>
      entry.screenshots.map((shot) => ({
        id: shot.id,
        postId: entry.postId,
        label: shot.label,
        originalName: shot.originalName,
        path: shot.fileName,
        size: shot.size,
      })),
    )
  }

  getScreenshot(screenshotId: string): ScreenshotItem | null {
    for (const entry of this.entries) {
      const shot = entry.screenshots.find((item) => item.id === screenshotId)
      if (shot) {
        return {
          id: shot.id,
          postId: entry.postId,
          label: shot.label,
          originalName: shot.originalName,
          path: shot.fileName,
          size: shot.size,
        }
      }
    }
    return null
  }

  // Resolve an entry-owned screenshot to an absolute path inside STORAGE_DIR. The
  // basename is always a server-generated UUID, but containment is asserted anyway.
  screenshotPath(item: ScreenshotItem) {
    const base = path.join(config.storageDir, 'screenshots')
    const target = path.join(base, path.basename(item.path))
    const rel = path.relative(base, target)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('screenshot path escapes storage')
    }
    return target
  }
}

// Forward-only migration. Unknown/legacy entries are coerced into the current shape
// so older data is upgraded, never dropped.
function migrateEntry(raw: Entry): Entry {
  const now = new Date().toISOString()
  return {
    id: raw.id || crypto.randomUUID(),
    postId: raw.postId || '',
    creativeId: raw.creativeId || '',
    platform: normalizePlatform(raw.platform),
    account: raw.account || '',
    model: raw.model || '',
    postUrl: raw.postUrl || '',
    publishedAt: raw.publishedAt || '',
    durationSec: raw.durationSec ?? null,
    contentPillar: raw.contentPillar || '',
    format: raw.format || '',
    hookType: raw.hookType || '',
    textOnVideo: raw.textOnVideo || '',
    caption: raw.caption || '',
    note: raw.note || '',
    tags: cleanTags(raw.tags),
    followersAtPublish: numOrNull(raw.followersAtPublish),
    contentAnalysis: normalizeContent(raw.contentAnalysis),
    contentTags: cleanTags(raw.contentTags),
    track: normalizeTrack(raw.track),
    analyzedBy: raw.analyzedBy === 'ai' ? 'ai' : raw.analyzedBy === 'manual' ? 'manual' : '',
    analyzedAt: raw.analyzedAt || '',
    recordType: raw.recordType === 'EXAMPLE' ? 'EXAMPLE' : 'LIVE',
    metrics: normalizeMetrics(raw.metrics),
    extraMetrics: normalizeExtra(raw.extraMetrics),
    video: raw.video || null,
    screenshots: Array.isArray(raw.screenshots) ? raw.screenshots : [],
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  }
}
