import type { ContentAnalysis, PostRecord, TrackProfile } from './types.js'

export const emptyContentAnalysis = (): ContentAnalysis => ({
  hook: '',
  scene: '',
  action: '',
  subject: '',
  pacing: '',
  ending: '',
  whyItWorked: '',
})

export const emptyTrack = (): TrackProfile => ({
  name: '',
  energyTier: '',
  loudnessMeanDb: null,
  loudnessMaxDb: null,
  beat: '',
  bass: '',
  vocal: '',
  mood: '',
  source: '',
})

// Raw metrics shared by every manual data source (manual-intake.json seed and the
// writable entries store). Keeping the derivation in one place guarantees the
// dashboard computes the same rates regardless of where a reel came from.
export interface DeriveMetrics {
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

export interface DeriveInput {
  postId: string
  creativeId: string
  platform: PostRecord['platform']
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
  sourceNotes: string
  tags: string[]
  followersAtPublish: number | null
  contentAnalysis: ContentAnalysis
  contentTags: string[]
  track: TrackProfile
  extraMetrics?: Record<string, number>
  recordType: PostRecord['recordType']
  metrics: DeriveMetrics
}

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const divide = (numerator: number | null, denominator: number | null) =>
  numerator !== null && denominator && denominator > 0 ? numerator / denominator : null

const sumKnown = (values: Array<number | null>) =>
  values.some((value) => value !== null)
    ? values.reduce<number>((total, value) => total + (value || 0), 0)
    : null

// Average watched seconds can exceed the clip length on loop-heavy platforms.
// Retention is a share of the video, so clamp it to [0, 1].
const retention = (averageWatchTime: number | null, duration: number | null) => {
  const raw = divide(averageWatchTime, duration)
  return raw === null ? null : Math.min(1, Math.max(0, raw))
}

export function derivePost(input: DeriveInput): PostRecord {
  const m = input.metrics
  const views = finite(m.views)
  const reach = finite(m.reach)
  const duration = input.durationSec ?? null
  const averageWatchTime = finite(m.averageWatchTimeSec)
  const likes = finite(m.likes)
  const comments = finite(m.comments)
  const reposts = finite(m.reposts)
  const shares = finite(m.shares)
  const saves = finite(m.saves)
  const follows = finite(m.follows)
  const profileVisits = finite(m.profileVisits)
  const skipRate = finite(m.skipRate)
  const completionRate = finite(m.completionRate)
  const totalEngagements = sumKnown([likes, comments, reposts, shares, saves])
  // Engagement/reaction rates are taken over REACH (unique viewers), matching how
  // Instagram reports them and giving a consistent per-person base cross-platform.
  // Fall back to views when reach is missing so a rate is never spuriously null.
  const rateBase = reach ?? views

  return {
    postId: input.postId,
    creativeId: input.creativeId,
    platform: input.platform,
    account: input.account,
    model: input.model,
    postUrl: input.postUrl,
    publishedAt: input.publishedAt,
    duration,
    contentPillar: input.contentPillar,
    format: input.format,
    description: input.textOnVideo || input.caption || input.postId,
    firstFrame: '',
    textOnVideo: input.textOnVideo,
    hookType: input.hookType,
    caption: input.caption,
    cta: '',
    hashtags: '',
    location: '',
    outfit: '',
    sourceNotes: input.sourceNotes,
    tags: input.tags,
    followersAtPublish: finite(input.followersAtPublish),
    contentAnalysis: input.contentAnalysis,
    contentTags: input.contentTags,
    track: input.track,
    extraMetrics: input.extraMetrics || {},
    recordType: input.recordType || 'LIVE',
    views,
    reach,
    totalPlayTime: finite(m.totalPlayTimeSec),
    averageWatchTime,
    skipRate,
    completionRate,
    likes,
    comments,
    reposts,
    shares,
    saves,
    profileVisits,
    follows,
    nativeLikeRate: null,
    nativeCommentRate: null,
    nativeRepostRate: null,
    nativeShareRate: null,
    nativeSaveRate: null,
    followersRate: null,
    nonFollowersRate: null,
    retentionRate: retention(averageWatchTime, duration),
    totalEngagements,
    engagementRateByViews: divide(totalEngagements, views),
    likeRate: divide(likes, rateBase),
    commentRate: divide(comments, rateBase),
    shareRate: divide(shares, rateBase),
    saveRate: divide(saves, rateBase),
    followConversion: divide(follows, rateBase),
    engagementsPerThousand:
      views && totalEngagements !== null ? (totalEngagements / views) * 1000 : null,
    followsPerThousand: views && follows !== null ? (follows / views) * 1000 : null,
    engagementRateByReach: divide(totalEngagements, rateBase),
    holdRate: skipRate !== null ? Math.max(0, 1 - skipRate) : null,
    viewsPerReached: divide(views, reach),
    profileVisitRate: divide(profileVisits, views),
    profileToFollowConversion: divide(follows, profileVisits),
    followConversionByReach: divide(follows, reach),
  }
}
