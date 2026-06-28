export type Platform = 'Instagram' | 'TikTok'

// What actually happens in the reel — the content-first layer the analysis is built on.
export interface ContentAnalysis {
  hook: string
  scene: string
  action: string
  subject: string
  pacing: string
  ending: string
  whyItWorked: string
}

// The audio/track behind the reel. The same creative is reposted across platforms
// with DIFFERENT tracks, so the track is a first-class, per-platform dimension.
// We profile the audio (energy/beat/bass/mood) rather than identify a song title.
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
  // Owner-captured extras the platform exposes but the core schema doesn't: traffic
  // sources (traffic_foryou_pct…), demographics (gender_*_pct, age_*_pct, geo_*_pct),
  // viewer/follower split. Whole-percent values (0..100). Empty {} for sources that
  // don't provide them. Surfaced on the reel page and folded into weighted Audience.
  extraMetrics: Record<string, number>
  recordType: 'LIVE' | 'EXAMPLE' | string
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

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'ok' | 'error'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  error: string | null
  stale: boolean
  source: 'manual-intake' | null
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

export interface MetadataFile {
  media: MediaItem[]
  notes: Record<string, ManualNotes>
}

// Metrics captured manually by the owner. Everything is optional: an empty
// field stays null and never inflates a denominator.
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

// A reel authored through the dashboard UI. Stored in STORAGE_DIR/entries.json
// (never inside the git repo) so deploys never overwrite owner data.
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

export interface EntriesFile {
  schemaVersion: number
  entries: Entry[]
}
