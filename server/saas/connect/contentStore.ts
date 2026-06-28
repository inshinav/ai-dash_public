// Store for content discovered via the platform APIs (reels/videos imported on sync).
// Additive JSON sidecar (saas-content.json), separate from the owner's manual entries.json.
// Synced reels are matched to existing manual posts by URL where possible (so the same reel
// isn't duplicated); unmatched reels are imported under a stable api-derived postId.

import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../../config.js'
import { readJsonFileSafe, writeJsonFileAtomic } from '../../jsonFile.js'
import { derivePost, emptyContentAnalysis, emptyTrack } from '../../derive.js'
import type { PostRecord } from '../../types.js'
import type { ConnectorContentItem, SocialPlatform } from '../connectors/types.js'

const SCHEMA_VERSION = 1

export interface SyncedContent {
  id: string
  workspaceId: string
  accountId: string
  platform: SocialPlatform
  platformId: string
  postId: string // matched manual postId, or an api-derived one
  creativeId: string
  caption: string
  permalink: string
  shareUrl: string
  mediaType: string
  publishedAt: string
  durationSec: number | null
  thumbnailUrl: string | null
  firstSyncedAt: string
  lastSyncedAt: string
}

interface ContentFile {
  schemaVersion: number
  content: SyncedContent[]
}

// Normalize a URL for loose matching: drop protocol/www/query/trailing slash, lowercase.
export function normalizeUrl(url: string): string {
  return (url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

const platformLabel = (p: SocialPlatform) => (p === 'tiktok' ? 'TikTok' : 'Instagram')
const apiPostId = (p: SocialPlatform, platformId: string) => `${p === 'tiktok' ? 'TT' : 'IG'}_api_${platformId}`

export class ContentStore {
  private content: SyncedContent[] = []
  private corrupted = false
  private readonly filePath = path.join(config.storageDir, 'saas-content.json')
  private writeQueue = Promise.resolve()

  async init() {
    const result = await readJsonFileSafe<ContentFile>(this.filePath)
    this.corrupted = result.status === 'corrupt'
    this.content = Array.isArray(result.value?.content) ? result.value!.content : []
    if (result.status === 'missing') await this.persist()
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonFileAtomic(this.filePath, { schemaVersion: SCHEMA_VERSION, content: this.content } satisfies ContentFile),
    )
    return this.writeQueue
  }

  status() {
    return { count: this.content.length, corrupted: this.corrupted }
  }

  list(): SyncedContent[] {
    return this.content
  }

  getByPlatformId(platform: SocialPlatform, platformId: string): SyncedContent | null {
    return this.content.find((c) => c.platform === platform && c.platformId === platformId) || null
  }

  // Idempotent upsert keyed on (platform, platformId): re-syncing updates in place.
  async upsert(input: ConnectorContentItem, postId: string, workspaceId: string, now: string): Promise<SyncedContent> {
    const existing = this.getByPlatformId(input.platform, input.platformId)
    if (existing) {
      Object.assign(existing, {
        postId,
        caption: input.caption,
        permalink: input.permalink,
        shareUrl: input.shareUrl,
        mediaType: input.mediaType,
        publishedAt: input.publishedAt,
        durationSec: input.durationSec,
        thumbnailUrl: input.thumbnailUrl,
        lastSyncedAt: now,
      })
      await this.persist()
      return existing
    }
    const created: SyncedContent = {
      id: crypto.randomUUID(),
      workspaceId,
      accountId: input.accountId,
      platform: input.platform,
      platformId: input.platformId,
      postId,
      creativeId: input.creativeId || '',
      caption: input.caption,
      permalink: input.permalink,
      shareUrl: input.shareUrl,
      mediaType: input.mediaType,
      publishedAt: input.publishedAt,
      durationSec: input.durationSec,
      thumbnailUrl: input.thumbnailUrl,
      firstSyncedAt: now,
      lastSyncedAt: now,
    }
    this.content.push(created)
    await this.persist()
    return created
  }

  // Project synced content into PostRecords for the dashboard. Metric fields are null here;
  // applySnapshotsToPosts overlays the API-sourced values from the snapshot store.
  toPosts(): PostRecord[] {
    return this.content.map((c) =>
      derivePost({
        postId: c.postId,
        creativeId: c.creativeId,
        platform: platformLabel(c.platform),
        account: c.accountId,
        model: '',
        postUrl: c.shareUrl || c.permalink,
        publishedAt: c.publishedAt,
        durationSec: c.durationSec,
        contentPillar: '',
        format: 'api-import',
        hookType: '',
        textOnVideo: '',
        caption: c.caption,
        sourceNotes: '',
        tags: [],
        followersAtPublish: null,
        contentAnalysis: emptyContentAnalysis(),
        contentTags: [],
        track: emptyTrack(),
        extraMetrics: {},
        recordType: 'LIVE',
        metrics: {
          views: null, reach: null, likes: null, comments: null, reposts: null, shares: null,
          saves: null, follows: null, profileVisits: null, averageWatchTimeSec: null,
          totalPlayTimeSec: null, skipRate: null, completionRate: null,
        },
      }),
    )
  }
}

// Find an existing manual/seed post that is the same reel as the API item (match by URL or
// by the platform id appearing in the stored URL). Returns its postId, or null.
export function matchExistingPost(item: ConnectorContentItem, posts: PostRecord[]): string | null {
  const target = normalizeUrl(item.shareUrl || item.permalink)
  const wantPlatform = platformLabel(item.platform)
  for (const post of posts) {
    if (post.platform !== wantPlatform) continue
    const url = normalizeUrl(post.postUrl)
    if (!url) continue
    if (url === target) return post.postId
    if (item.platformId && url.includes(item.platformId)) return post.postId
  }
  return null
}

export { apiPostId }
