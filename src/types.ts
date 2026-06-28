export type Platform = 'Instagram' | 'TikTok'

export interface ContentAnalysis {
  hook: string
  scene: string
  action: string
  subject: string
  pacing: string
  ending: string
  whyItWorked: string
}

export interface TrackProfile {
  name: string
  energyTier: '' | 'low' | 'mid' | 'high'
  loudnessMeanDb: number | null
  loudnessMaxDb: number | null
  beat: string
  bass: string
  vocal: string
  mood: string
  source: string
}

export interface PostRecord {
  postId: string
  creativeId: string
  platform: Platform
  account: string
  model: string
  postUrl: string
  publishedAt: string
  duration: number | null
  contentPillar: string
  format: string
  description: string
  firstFrame: string
  textOnVideo: string
  hookType: string
  caption: string
  cta: string
  hashtags: string
  location: string
  outfit: string
  sourceNotes: string
  tags: string[]
  followersAtPublish: number | null
  contentAnalysis: ContentAnalysis
  contentTags: string[]
  track: TrackProfile
  // Platform extras the core schema doesn't carry: traffic sources, demographics
  // (gender_*/age_*/geo_*_pct), viewer/follower split. Whole-percent (0..100).
  extraMetrics: Record<string, number>
  recordType: string
  views: number | null
  reach: number | null
  totalPlayTime: number | null
  averageWatchTime: number | null
  skipRate: number | null
  completionRate: number | null
  likes: number | null
  comments: number | null
  reposts: number | null
  shares: number | null
  saves: number | null
  profileVisits: number | null
  follows: number | null
  nativeLikeRate: number | null
  nativeCommentRate: number | null
  nativeRepostRate: number | null
  nativeShareRate: number | null
  nativeSaveRate: number | null
  followersRate: number | null
  nonFollowersRate: number | null
  retentionRate: number | null
  totalEngagements: number | null
  engagementRateByViews: number | null
  likeRate: number | null
  commentRate: number | null
  shareRate: number | null
  saveRate: number | null
  followConversion: number | null
  engagementsPerThousand: number | null
  followsPerThousand: number | null
  engagementRateByReach: number | null
  holdRate: number | null
  viewsPerReached: number | null
  profileVisitRate: number | null
  profileToFollowConversion: number | null
  followConversionByReach: number | null
}

export interface AudienceRecord {
  postId: string
  platform: Platform
  dimension: string
  segment: string
  percentage: number | null
  recordType: string
}

export interface MediaItem {
  id: string
  bindingType: 'post' | 'creative'
  bindingId: string
  originalName: string
  fileName: string
  thumbnailFile: string | null
  mimeType: string
  size: number
  duration: number | null
  width: number | null
  height: number | null
  createdAt: string
}

export interface ScreenshotItem {
  id: string
  postId: string
  label: string
  originalName: string
  path: string
  size: number
}

export interface ManualNotes {
  postId: string
  works: string
  doesntWork: string
  hypothesis: string
  changeNext: string
  updatedAt: string
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'ok' | 'error'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  error: string | null
  stale: boolean
  source: 'manual-intake' | null
}

export interface DashboardData {
  posts: PostRecord[]
  audience: AudienceRecord[]
  syncedAt: string
  source: string
  sync: SyncStatus
  media: MediaItem[]
  screenshots: ScreenshotItem[]
  notes: Record<string, ManualNotes>
}

export interface Filters {
  dateFrom: string
  dateTo: string
  platform: string
  account: string
  model: string
  format: string
  hook: string
  tag: string
  duration: string
}

export interface EntryMetrics {
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  reposts: number | null
  shares: number | null
  saves: number | null
  follows: number | null
  profileVisits: number | null
  averageWatchTimeSec: number | null
  totalPlayTimeSec: number | null
  skipRate: number | null
  completionRate: number | null
}

export interface EntryScreenshot {
  id: string
  fileName: string
  originalName: string
  label: string
  mimeType: string
  size: number
}

export interface Entry {
  id: string
  postId: string
  creativeId: string
  platform: Platform
  account: string
  model: string
  postUrl: string
  publishedAt: string
  durationSec: number | null
  contentPillar: string
  format: string
  hookType: string
  textOnVideo: string
  caption: string
  note: string
  tags: string[]
  followersAtPublish: number | null
  contentAnalysis: ContentAnalysis
  contentTags: string[]
  track: TrackProfile
  analyzedBy: '' | 'manual' | 'ai'
  analyzedAt: string
  recordType: 'LIVE' | 'EXAMPLE'
  metrics: EntryMetrics
  extraMetrics: Record<string, number>
  video: MediaItem | null
  screenshots: EntryScreenshot[]
  createdAt: string
  updatedAt: string
}

// The source metric an insight is built on — drives its badge + accent colour.
export type InsightMetric =
  | 'medianViews'
  | 'completion'
  | 'retention'
  | 'follows'
  | 'comments'
  | 'engagement'
  | 'shareSave'
  | 'fyp'
  | 'crossPlatform'

// A reel referenced by an insight, carrying a human title so chips never show raw IDs.
export interface InsightReel {
  postId: string
  title: string
  platform: Platform
}

export interface Insight {
  id: string
  title: string
  detail: string
  metric: InsightMetric
  direction: 'up' | 'down' | 'flat'
  // signed fraction, e.g. +0.26 / -0.57; null for neutral observations.
  effect: number | null
  // actionable next step — «что сделать в следующих роликах».
  recommendation: string
  sampleSize: number
  // |effect| × sample weight (0..1): ranks the strongest insight to the hero slot.
  score: number
  reels: InsightReel[]
  tone: 'positive' | 'negative' | 'neutral'
}
