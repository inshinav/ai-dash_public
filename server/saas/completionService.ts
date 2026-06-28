// Glue between the existing dashboard data (merged PostRecords) and the requirement
// engine. It computes, per reel, which canonical metrics are ALREADY known (from the
// legacy manual/seed values AND from confirmed snapshots) so the engine only asks for what
// is genuinely missing — and rebuilds account-level audience tasks once per account.
//
// workspaceId is hard-wired to the single owner workspace today; the same code becomes
// per-tenant when auth lands (docs/adr/002-saas-architecture.md).

import type { PostRecord } from '../types.js'
import { derivePost, type DeriveInput } from '../derive.js'
import {
  computeAccountTask,
  computeContentTask,
  contentCompleteness,
  prioritizeTasks,
  type AccountForCompletion,
  type CompletionOptions,
  type CompletionTask,
  type ContentForCompletion,
} from './completion.js'
import { metricDef, type SocialPlatform } from './metrics.js'
import { foldSnapshotsToMetrics, presentMetricKeys, type MetricSnapshot } from './snapshots.js'

export const OWNER_WORKSPACE = 'owner'

const toPlatform = (p: string): SocialPlatform => (p === 'TikTok' ? 'tiktok' : 'instagram')
const accountIdFor = (post: PostRecord): string => post.account || `${toPlatform(post.platform)}:default`

// PostRecord field -> canonical key, for the scalar metrics the legacy schema carries.
const POST_FIELD_TO_CANON: Array<[keyof PostRecord, string]> = [
  ['views', 'views'],
  ['reach', 'reach'],
  ['likes', 'likes'],
  ['comments', 'comments'],
  ['shares', 'shares'],
  ['saves', 'saves'],
  ['follows', 'follows'],
  ['profileVisits', 'profile_visits'],
  ['averageWatchTime', 'average_watch_time'],
  ['totalPlayTime', 'total_play_time'],
  ['skipRate', 'skip_rate'],
  ['completionRate', 'completion_rate'],
  ['duration', 'duration'],
  ['totalEngagements', 'total_engagements'],
  ['retentionRate', 'retention_rate'],
  ['holdRate', 'hold_rate'],
]

// Which canonical metrics a reel already has, from its legacy non-null values + its
// confirmed snapshots. Distribution metrics count as present when any segment exists.
export function presentKeysForPost(post: PostRecord, snapshots: MetricSnapshot[]): Set<string> {
  const present = new Set<string>()
  for (const [field, key] of POST_FIELD_TO_CANON) {
    if (post[field] !== null && post[field] !== undefined) present.add(key)
  }
  const extra = post.extraMetrics || {}
  const hasPrefix = (...prefixes: string[]) =>
    Object.keys(extra).some((k) => prefixes.some((p) => k.startsWith(p)))
  if (hasPrefix('traffic_')) present.add('traffic_sources')
  if (hasPrefix('gender_')) present.add('viewer_gender')
  if (hasPrefix('age_')) present.add('viewer_age')
  if (hasPrefix('geo_')) present.add('viewer_geo')
  if (extra.new_viewers_pct !== undefined || extra.returning_viewers_pct !== undefined) present.add('viewer_type')
  if (extra.followers_pct !== undefined || extra.nonfollowers_pct !== undefined) present.add('follower_status')
  for (const key of presentMetricKeys(snapshots, post.postId)) present.add(key)
  return present
}

function contentFromPost(post: PostRecord): ContentForCompletion {
  return {
    contentId: post.postId,
    workspaceId: OWNER_WORKSPACE,
    accountId: accountIdFor(post),
    platform: toPlatform(post.platform),
    publishedAt: post.publishedAt || '',
    caption: post.description || post.caption || post.textOnVideo || post.postId,
    thumbnailUrl: null,
    model: post.model,
  }
}

export interface CompletionServiceOptions {
  now?: string
  connectedPlatforms?: SocialPlatform[]
  minContentAgeHours?: number
}

// Build the full prioritized task list (content + one task per account) for the owner.
export function buildTasks(
  posts: PostRecord[],
  snapshots: MetricSnapshot[],
  options: CompletionServiceOptions = {},
): CompletionTask[] {
  const now = options.now || new Date().toISOString()
  const live = posts.filter((p) => p.recordType === 'LIVE' && p.publishedAt)
  const baseOpts: CompletionOptions = {
    now,
    hasApiConnector: false, // no live connector yet — manual/screenshot mode
    capabilities: null,
    minContentAgeHours: options.minContentAgeHours,
  }

  const contentTasks = live.map((post) =>
    computeContentTask(contentFromPost(post), presentKeysForPost(post, snapshots), baseOpts),
  )

  // One account task per (account, platform), audience presence from account snapshots.
  const accounts = new Map<string, AccountForCompletion>()
  for (const post of live) {
    const accountId = accountIdFor(post)
    if (accounts.has(accountId)) continue
    const accountSnaps = snapshots.filter((s) => s.accountId === accountId && s.contentId === null)
    const lastAudienceAt = accountSnaps
      .filter((s) => s.confirmed && metricDef(s.metricKey)?.kind === 'distribution')
      .map((s) => s.observedAt)
      .sort()
      .pop() || null
    accounts.set(accountId, {
      accountId,
      workspaceId: OWNER_WORKSPACE,
      platform: toPlatform(post.platform),
      username: post.account || toPlatform(post.platform),
      lastAudienceAt,
    })
  }
  const accountTasks = [...accounts.values()].map((account) => {
    const present = presentMetricKeys(snapshots.filter((s) => s.accountId === account.accountId), '')
    return computeAccountTask(account, present, baseOpts)
  })

  return prioritizeTasks([...contentTasks, ...accountTasks])
}

// Overlay confirmed snapshot values onto the merged posts and RE-DERIVE, so screenshot-
// and API-sourced metrics flow into the EXISTING dashboard/analytics unchanged. A snapshot
// only overrides when it carries a non-null value (a confirmed null never erases a real
// legacy value). Raw screenshots stay private; only the numbers surface — consistent with
// how entries.json values are already shown.
export function applySnapshotsToPosts(posts: PostRecord[], snapshots: MetricSnapshot[]): PostRecord[] {
  if (!snapshots.length) return posts
  const byContent = new Map<string, MetricSnapshot[]>()
  for (const s of snapshots) {
    if (!s.contentId) continue
    byContent.set(s.contentId, [...(byContent.get(s.contentId) || []), s])
  }
  if (!byContent.size) return posts

  return posts.map((post) => {
    const snaps = byContent.get(post.postId)
    if (!snaps || !snaps.length) return post
    const m = foldSnapshotsToMetrics(snaps, post.postId).metrics
    const pick = (key: string, fallback: number | null) =>
      m[key] !== undefined && m[key] !== null ? m[key] : fallback
    const input: DeriveInput = {
      postId: post.postId,
      creativeId: post.creativeId,
      platform: post.platform,
      account: post.account,
      model: post.model,
      postUrl: post.postUrl,
      publishedAt: post.publishedAt,
      durationSec: post.duration,
      contentPillar: post.contentPillar,
      format: post.format,
      hookType: post.hookType,
      textOnVideo: post.textOnVideo,
      caption: post.caption,
      sourceNotes: post.sourceNotes,
      tags: post.tags,
      followersAtPublish: post.followersAtPublish,
      contentAnalysis: post.contentAnalysis,
      contentTags: post.contentTags,
      track: post.track,
      extraMetrics: { ...post.extraMetrics, ...foldSnapshotsToMetrics(snaps, post.postId).extraMetrics },
      recordType: post.recordType,
      metrics: {
        views: pick('views', post.views),
        reach: pick('reach', post.reach),
        likes: pick('likes', post.likes),
        comments: pick('comments', post.comments),
        reposts: post.reposts,
        shares: pick('shares', post.shares),
        saves: pick('saves', post.saves),
        follows: pick('follows', post.follows),
        profileVisits: pick('profileVisits', post.profileVisits),
        averageWatchTimeSec: pick('averageWatchTimeSec', post.averageWatchTime),
        totalPlayTimeSec: pick('totalPlayTimeSec', post.totalPlayTime),
        skipRate: pick('skipRate', post.skipRate),
        completionRate: pick('completionRate', post.completionRate),
      },
    }
    return derivePost(input)
  })
}

// Per-reel completeness for the dashboard provenance/coverage badge.
export function completenessForPost(post: PostRecord, snapshots: MetricSnapshot[], now?: string) {
  return contentCompleteness(contentFromPost(post), presentKeysForPost(post, snapshots), {
    now: now || new Date().toISOString(),
    hasApiConnector: false,
    capabilities: null,
  })
}
