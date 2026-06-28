import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { derivePost, emptyContentAnalysis, emptyTrack } from './derive.js'
import type {
  AudienceRecord,
  ContentAnalysis,
  MediaItem,
  Platform,
  PostRecord,
  ScreenshotItem,
  TrackProfile,
} from './types.js'

interface ManualPost {
  postId: string
  creativeId: string
  platform: Platform
  account: string | null
  model: string
  creationMethod: string
  durationSec: number | null
  publishedAt: string | null
  postUrl?: string | null
  textOnVideo: string | null
  caption: string | null
  description: string | null
  sourceNotes: string | null
  recordType: string
  contentPillar?: string | null
  hookType?: string | null
  contentAnalysis?: Partial<Record<keyof ContentAnalysis, string>> | null
  contentTags?: string[] | null
  track?: Partial<TrackProfile> | null
  metrics?: Record<string, number | null | undefined>
  extraMetrics?: Record<string, number | null | undefined> | null
}

interface ManualAudience {
  postId: string
  platform: Platform
  dimension: string
  segment: string
  percentage: number | null
  recordType: string
}

interface ManualAsset {
  postId: string
  type: 'video' | 'screenshot'
  label?: string
  path: string
  originalName: string
  sizeBytes: number
  mimeType?: string
}

interface ManualIntakeFile {
  posts: ManualPost[]
  audience: ManualAudience[]
  assets: ManualAsset[]
  updatedAt?: string
}

const metric = (post: ManualPost, key: string) => {
  const value = post.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const cleanText = (value: unknown, max = 1000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

// Seed posts may carry an optional content analysis; overlay any provided fields
// onto the empty shape so missing keys stay blank and unknown keys are dropped.
const contentAnalysisFromManual = (value: ManualPost['contentAnalysis']): ContentAnalysis => {
  const base = emptyContentAnalysis()
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>
    for (const key of Object.keys(base) as Array<keyof ContentAnalysis>) {
      base[key] = cleanText(input[key])
    }
  }
  return base
}

const contentTagsFromManual = (value: ManualPost['contentTags']): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    const tag = cleanText(raw, 40).toLowerCase()
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      out.push(tag)
    }
    if (out.length >= 24) break
  }
  return out
}

const numOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const extraFromManual = (value: ManualPost['extraMetrics']): Record<string, number> => {
  const out: Record<string, number> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value)) {
    const name = cleanText(key, 60)
    const num = numOrNull(raw)
    if (name && num !== null) out[name] = num
  }
  return out
}
const trackFromManual = (value: ManualPost['track']): TrackProfile => {
  const base = emptyTrack()
  if (!value || typeof value !== 'object') return base
  const v = value as Record<string, unknown>
  const tier = cleanText(v.energyTier, 8)
  return {
    name: cleanText(v.name, 200),
    energyTier: (['low', 'mid', 'high'] as string[]).includes(tier)
      ? (tier as TrackProfile['energyTier'])
      : '',
    loudnessMeanDb: numOrNull(v.loudnessMeanDb),
    loudnessMaxDb: numOrNull(v.loudnessMaxDb),
    beat: cleanText(v.beat, 40),
    bass: cleanText(v.bass, 40),
    vocal: cleanText(v.vocal, 40),
    mood: cleanText(v.mood, 120),
    source: cleanText(v.source, 120),
  }
}

// Containment-safe resolution. Stored asset paths are trusted seed data today, but
// any '..' or absolute path that would escape STORAGE_DIR is rejected so the public
// screenshot/video routes can never read files outside the storage root.
const toStoredPath = (assetPath: string) => {
  const normalized = assetPath.replaceAll('\\', '/')
  const relative = normalized.startsWith('storage/') ? normalized.slice('storage/'.length) : normalized
  const target = path.resolve(config.storageDir, relative)
  const rel = path.relative(config.storageDir, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('asset path escapes storage')
  }
  return target
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function postFromManual(post: ManualPost): PostRecord {
  return derivePost({
    postId: post.postId,
    creativeId: post.creativeId,
    platform: post.platform,
    account: post.account || '',
    model: post.model || '',
    postUrl: post.postUrl || '',
    publishedAt: post.publishedAt || '',
    durationSec: post.durationSec ?? null,
    contentPillar: cleanText(post.contentPillar, 80),
    format: post.creationMethod || '',
    hookType: cleanText(post.hookType, 200) || post.textOnVideo || '',
    textOnVideo: post.textOnVideo || '',
    caption: post.caption || '',
    sourceNotes: post.sourceNotes || '',
    tags: [],
    followersAtPublish: null,
    contentAnalysis: contentAnalysisFromManual(post.contentAnalysis),
    contentTags: contentTagsFromManual(post.contentTags),
    track: trackFromManual(post.track),
    extraMetrics: extraFromManual(post.extraMetrics),
    recordType: post.recordType === 'EXAMPLE' ? 'EXAMPLE' : 'LIVE',
    metrics: {
      views: metric(post, 'views'),
      reach: metric(post, 'reach'),
      likes: metric(post, 'likes'),
      comments: metric(post, 'comments'),
      reposts: metric(post, 'reposts'),
      shares: metric(post, 'shares'),
      saves: metric(post, 'saves'),
      follows: metric(post, 'follows') ?? metric(post, 'newFollowers'),
      profileVisits: metric(post, 'profileVisits'),
      averageWatchTimeSec: metric(post, 'averageWatchTimeSec'),
      totalPlayTimeSec: metric(post, 'totalPlayTimeSec'),
      skipRate: metric(post, 'skipRate'),
      completionRate: metric(post, 'watchedFullVideoRate'),
    },
  })
}

function mediaFromAsset(asset: ManualAsset): MediaItem {
  const id = `manual-video-${slug(asset.postId)}`
  return {
    id,
    bindingType: 'post',
    bindingId: asset.postId,
    originalName: asset.originalName,
    fileName: asset.path,
    thumbnailFile: null,
    mimeType: asset.mimeType || 'video/mp4',
    size: asset.sizeBytes,
    duration: null,
    width: null,
    height: null,
    createdAt: new Date().toISOString(),
  }
}

function screenshotFromAsset(asset: ManualAsset, index: number): ScreenshotItem {
  return {
    // The trailing index keeps ids unique even if two screenshots share a label.
    id: `manual-shot-${slug(asset.postId)}-${slug(asset.label || asset.originalName)}-${index}`,
    postId: asset.postId,
    label: asset.label || 'screenshot',
    originalName: asset.originalName,
    path: asset.path,
    size: asset.sizeBytes,
  }
}

export class ManualIntake {
  private posts: PostRecord[] = []
  private audience: AudienceRecord[] = []
  private media: MediaItem[] = []
  private screenshots: ScreenshotItem[] = []
  private readonly filePath = path.resolve('data/manual-intake.json')

  async init() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as ManualIntakeFile
      this.posts = (raw.posts || []).map(postFromManual).filter((post) => post.postId)
      this.audience = (raw.audience || []).map((row) => ({
        postId: row.postId,
        platform: row.platform,
        dimension: row.dimension,
        segment: row.segment,
        percentage: row.percentage,
        recordType: row.recordType,
      }))
      const assets = raw.assets || []
      this.media = assets.filter((asset) => asset.type === 'video').map(mediaFromAsset)
      this.screenshots = assets.filter((asset) => asset.type === 'screenshot').map(screenshotFromAsset)
    } catch {
      this.posts = []
      this.audience = []
      this.media = []
      this.screenshots = []
    }
  }

  mergeSnapshot<T extends { postId: string }>(sheetRows: T[], manualRows: T[]) {
    const manualIds = new Set(manualRows.map((row) => row.postId))
    return [...sheetRows.filter((row) => !manualIds.has(row.postId)), ...manualRows]
  }

  getPosts() {
    return this.posts
  }

  getAudience() {
    return this.audience
  }

  listMedia() {
    return this.media
  }

  getMedia(id: string) {
    return this.media.find((item) => item.id === id) || null
  }

  listScreenshots() {
    return this.screenshots
  }

  getScreenshot(id: string) {
    return this.screenshots.find((item) => item.id === id) || null
  }

  filePathFor(item: MediaItem | ScreenshotItem) {
    return toStoredPath('path' in item ? item.path : item.fileName)
  }
}
