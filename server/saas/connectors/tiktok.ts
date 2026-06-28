// TikTok connector — Login Kit + Display API. The Display API exposes only basic counts
// (views/likes/comments/shares) and video metadata for a connected creator; depth metrics
// (avg watch time, completion, retention, reach, saves, traffic, demographics, follows
// from video) are NOT in the API and are screenshot-assisted in AI Dash. The mappers below
// emit exactly what the documented response contains — nothing inferred.

import type {
  AuthorizationCallbackInput,
  AuthorizationContext,
  CanonicalMetricValue,
  ConnectedSocialAccount,
  ConnectionCredentials,
  ConnectorCapabilities,
  ConnectorContentItem,
  ContentSyncPage,
  PlatformFetcher,
  SocialConnector,
} from './types.js'

export interface TikTokConnectorConfig {
  clientKey: string
  redirectUri: string
  fetcher: PlatformFetcher
}

const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list']

interface TtVideo {
  id: string
  title?: string
  video_description?: string
  duration?: number
  cover_image_url?: string
  share_url?: string
  embed_link?: string
  view_count?: number
  like_count?: number
  comment_count?: number
  share_count?: number
  create_time?: number
}
interface TtVideoPage {
  data?: { videos?: TtVideo[]; cursor?: number; has_more?: boolean }
  error?: { code?: string; message?: string }
}

// view_count etc. -> canonical key (all are simple counts).
const VIDEO_METRIC_MAP: Record<string, string> = {
  view_count: 'views',
  like_count: 'likes',
  comment_count: 'comments',
  share_count: 'shares',
}

// ---- pure mappers (exported for contract tests) ----

export function mapTtVideos(payload: TtVideoPage, accountId: string): { items: ConnectorContentItem[]; nextCursor: string | null } {
  const videos = payload.data?.videos || []
  const items = videos.map((v): ConnectorContentItem => ({
    platformId: v.id,
    platform: 'tiktok',
    accountId,
    creativeId: null,
    caption: v.video_description || v.title || '',
    permalink: v.share_url || '',
    shareUrl: v.share_url || '',
    mediaType: 'VIDEO',
    publishedAt: typeof v.create_time === 'number' ? new Date(v.create_time * 1000).toISOString() : '',
    durationSec: typeof v.duration === 'number' ? v.duration : null,
    thumbnailUrl: v.cover_image_url || null,
    raw: v,
  }))
  const nextCursor = payload.data?.has_more && payload.data.cursor != null ? String(payload.data.cursor) : null
  return { items, nextCursor }
}

export function mapTtVideoMetrics(video: TtVideo, observedAt: string): CanonicalMetricValue[] {
  const out: CanonicalMetricValue[] = []
  for (const [field, key] of Object.entries(VIDEO_METRIC_MAP)) {
    const raw = (video as unknown as Record<string, unknown>)[field]
    out.push({
      metricKey: key,
      segment: null,
      value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
      unit: 'count',
      source: 'tiktok_api',
      period: 'since_publish',
      observedAt,
      confidence: 1,
    })
  }
  return out
}

interface TtUserPayload {
  data?: { user?: Record<string, unknown> }
}

export function mapTtUser(payload: TtUserPayload): ConnectedSocialAccount | null {
  const u = payload.data?.user
  if (!u) return null
  return {
    platform: 'tiktok',
    platformAccountId: String(u.open_id ?? u.union_id ?? ''),
    username: String(u.display_name ?? ''),
    displayName: String(u.display_name ?? ''),
    accountType: 'CREATOR',
    avatarUrl: (u.avatar_url as string) || null,
    followerCount: typeof u.follower_count === 'number' ? u.follower_count : null,
  }
}

export class TikTokConnector implements SocialConnector {
  readonly platform = 'tiktok' as const
  private readonly cfg: TikTokConnectorConfig

  constructor(config: TikTokConnectorConfig) {
    this.cfg = config
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      platform: 'tiktok',
      apiContentMetrics: ['views', 'likes', 'comments', 'shares', 'duration'],
      apiAccountMetrics: ['follower_count'],
      apiAudience: false,
      screenshotMetrics: [
        'reach', 'average_watch_time', 'total_play_time', 'completion_rate', 'hold_rate',
        'skip_rate', 'saves', 'profile_visits', 'follows', 'traffic_sources', 'viewer_type',
        'follower_status', 'viewer_gender', 'viewer_age', 'viewer_geo',
      ],
      contentBackfill: true,
      incrementalSync: true,
      webhook: false,
      accessTokenTtlSec: 24 * 3600, // ~24h
      refreshTokenTtlSec: 365 * 24 * 3600, // ~365 days
      oauthPkce: true,
    }
  }

  getAuthorizationUrl(context: AuthorizationContext): string {
    const params = new URLSearchParams({
      client_key: this.cfg.clientKey,
      scope: SCOPES.join(','),
      response_type: 'code',
      redirect_uri: context.redirectUri || this.cfg.redirectUri,
      state: context.state,
    })
    if (context.codeChallenge) {
      params.set('code_challenge', context.codeChallenge)
      params.set('code_challenge_method', 'S256')
    }
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`
  }

  exchangeAuthorizationCode(input: AuthorizationCallbackInput): Promise<ConnectionCredentials> {
    return this.cfg.fetcher.exchangeCode(input)
  }

  refreshConnection(refreshToken: string): Promise<ConnectionCredentials> {
    return this.cfg.fetcher.refresh(refreshToken)
  }

  revokeConnection(accessToken: string): Promise<void> {
    return this.cfg.fetcher.revoke(accessToken)
  }

  async listAccounts(): Promise<ConnectedSocialAccount[]> {
    const payload = (await this.cfg.fetcher.get('/v2/user/info/', {
      fields: 'open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count',
    })) as TtUserPayload
    const account = mapTtUser(payload)
    return account ? [account] : []
  }

  async syncContent(accountId: string, cursor?: string): Promise<ContentSyncPage> {
    const query: Record<string, string> = {
      fields: 'id,title,video_description,duration,cover_image_url,share_url,embed_link,view_count,like_count,comment_count,share_count,create_time',
      max_count: '20',
    }
    if (cursor) query.cursor = cursor
    const payload = (await this.cfg.fetcher.get('/v2/video/list/', query)) as TtVideoPage
    const { items, nextCursor } = mapTtVideos(payload, accountId)
    return { items, nextCursor, raw: payload }
  }

  async syncContentMetrics(content: ConnectorContentItem): Promise<CanonicalMetricValue[]> {
    // The list response already carries counts; re-query the single video for a fresh
    // observation so each sync produces a new snapshot at this observedAt.
    const payload = (await this.cfg.fetcher.get('/v2/video/query/', {
      fields: 'id,view_count,like_count,comment_count,share_count',
      video_ids: content.platformId,
    })) as TtVideoPage
    const video = payload.data?.videos?.find((v) => v.id === content.platformId) || (content.raw as TtVideo)
    return mapTtVideoMetrics(video, new Date().toISOString())
  }

  async syncAccountMetrics(): Promise<CanonicalMetricValue[]> {
    const payload = (await this.cfg.fetcher.get('/v2/user/info/', { fields: 'follower_count' })) as TtUserPayload
    const value = payload.data?.user?.follower_count
    return [
      {
        metricKey: 'follower_count',
        segment: null,
        value: typeof value === 'number' ? value : null,
        unit: 'count',
        source: 'tiktok_api',
        period: 'lifetime',
        observedAt: new Date().toISOString(),
        confidence: 1,
      },
    ]
  }

  async syncAudience(): Promise<CanonicalMetricValue[]> {
    // Display API exposes no audience/demographics — these are screenshot-assisted.
    return []
  }
}
