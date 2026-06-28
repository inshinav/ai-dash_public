// Instagram connector — "Instagram API with Instagram Login" (Business/Creator).
// The OAuth-URL builder and the canonical mappers are REAL and tested; the HTTP calls go
// through an injected PlatformFetcher so the whole flow runs against fixtures with no
// credentials, and swaps to a live fetcher unchanged. See docs/social-api-feasibility.md
// and docs/platform-app-setup.md for the verified field/scopes/review details.

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

export interface InstagramConnectorConfig {
  appId: string
  redirectUri: string
  fetcher: PlatformFetcher
  graphVersion?: string
}

const SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights']

const REEL_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'shares',
  'saved',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
]

// platform insight name -> { canonical key, scale to base unit }
const INSIGHT_MAP: Record<string, { key: string; scale: number }> = {
  views: { key: 'views', scale: 1 },
  reach: { key: 'reach', scale: 1 },
  likes: { key: 'likes', scale: 1 },
  comments: { key: 'comments', scale: 1 },
  shares: { key: 'shares', scale: 1 },
  saved: { key: 'saves', scale: 1 },
  total_interactions: { key: 'total_engagements', scale: 1 },
  ig_reels_avg_watch_time: { key: 'average_watch_time', scale: 1 / 1000 }, // ms -> s
  ig_reels_video_view_total_time: { key: 'total_play_time', scale: 1 / 1000 }, // ms -> s
}

const UNIT: Record<string, CanonicalMetricValue['unit']> = {
  average_watch_time: 'seconds',
  total_play_time: 'seconds',
}

interface IgMediaNode {
  id: string
  caption?: string
  media_type?: string
  media_product_type?: string
  permalink?: string
  timestamp?: string
  thumbnail_url?: string
}
interface IgMediaPage {
  data?: IgMediaNode[]
  paging?: { cursors?: { after?: string }; next?: string }
}
interface IgInsightItem {
  name: string
  period?: string
  values?: Array<{ value?: number }>
}
interface IgInsightPayload {
  data?: IgInsightItem[]
}

// ---- pure mappers (exported for contract tests) ----

export function mapIgMedia(payload: IgMediaPage, accountId: string): { items: ConnectorContentItem[]; nextCursor: string | null } {
  const items = (payload.data || []).map((node): ConnectorContentItem => ({
    platformId: node.id,
    platform: 'instagram',
    accountId,
    creativeId: null,
    caption: node.caption || '',
    permalink: node.permalink || '',
    shareUrl: node.permalink || '',
    mediaType: node.media_product_type || node.media_type || 'VIDEO',
    publishedAt: node.timestamp ? new Date(node.timestamp).toISOString() : '',
    durationSec: null, // not in /media; filled from ffprobe or insights elsewhere
    thumbnailUrl: node.thumbnail_url || null,
    raw: node,
  }))
  // Only advance the cursor when the API says there's a next page.
  const nextCursor = payload.paging?.next ? payload.paging?.cursors?.after || null : null
  return { items, nextCursor }
}

export function mapIgReelInsights(
  payload: IgInsightPayload,
  content: ConnectorContentItem,
  observedAt: string,
): CanonicalMetricValue[] {
  const out: CanonicalMetricValue[] = []
  for (const item of payload.data || []) {
    const map = INSIGHT_MAP[item.name]
    if (!map) continue
    const raw = item.values?.[0]?.value
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw * map.scale : null
    out.push({
      metricKey: map.key,
      segment: null,
      value,
      unit: UNIT[map.key] || 'count',
      source: 'instagram_api',
      period: 'lifetime',
      observedAt,
      confidence: 1,
    })
  }
  return out
}

interface IgAudiencePayload {
  data?: Array<{
    name: string
    total_value?: {
      breakdowns?: Array<{
        dimension_keys?: string[]
        results?: Array<{ dimension_values?: string[]; value?: number }>
      }>
    }
  }>
}

const GENDER_SEG: Record<string, string> = { M: 'male', F: 'female', U: 'other' }

// Folds follower_demographics (lifetime, gender breakdown) into account-level distribution
// values as PERCENT shares (whole-percent, matching the extraMetrics convention).
export function mapIgAudience(payload: IgAudiencePayload, observedAt: string): CanonicalMetricValue[] {
  const out: CanonicalMetricValue[] = []
  const demo = (payload.data || []).find((d) => d.name === 'follower_demographics')
  const gender = demo?.total_value?.breakdowns?.find((b) => (b.dimension_keys || []).includes('gender'))
  if (gender?.results?.length) {
    const total = gender.results.reduce((sum, r) => sum + (r.value || 0), 0)
    if (total > 0) {
      for (const r of gender.results) {
        const seg = GENDER_SEG[(r.dimension_values || [])[0] || '']
        if (!seg) continue
        out.push({
          metricKey: 'follower_gender',
          segment: seg,
          value: Math.round(((r.value || 0) / total) * 1000) / 10, // whole-percent, 1 dp
          unit: 'percent',
          source: 'instagram_api',
          period: 'lifetime',
          observedAt,
          confidence: 1,
        })
      }
    }
  }
  return out
}

export class InstagramConnector implements SocialConnector {
  readonly platform = 'instagram' as const
  private readonly cfg: Required<InstagramConnectorConfig>

  constructor(config: InstagramConnectorConfig) {
    this.cfg = { graphVersion: 'v23.0', ...config }
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      platform: 'instagram',
      apiContentMetrics: ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'total_engagements', 'average_watch_time', 'total_play_time'],
      apiAccountMetrics: ['follower_count', 'account_reach', 'follower_gender', 'follower_age', 'follower_geo'],
      apiAudience: true,
      screenshotMetrics: ['profile_visits', 'follows', 'traffic_sources', 'viewer_gender', 'viewer_age', 'viewer_geo', 'hold_rate', 'skip_rate'],
      contentBackfill: true,
      incrementalSync: true,
      webhook: true,
      accessTokenTtlSec: 60 * 24 * 3600, // long-lived ~60 days
      refreshTokenTtlSec: null,
      oauthPkce: false,
    }
  }

  getAuthorizationUrl(context: AuthorizationContext): string {
    const params = new URLSearchParams({
      client_id: this.cfg.appId,
      redirect_uri: context.redirectUri || this.cfg.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(','),
      state: context.state,
    })
    return `https://www.instagram.com/oauth/authorize?${params.toString()}`
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
    const me = (await this.cfg.fetcher.get('/me', {
      fields: 'id,username,name,account_type,profile_picture_url,followers_count',
    })) as Record<string, unknown>
    return [
      {
        platform: 'instagram',
        platformAccountId: String(me.id ?? ''),
        username: String(me.username ?? ''),
        displayName: String(me.name ?? me.username ?? ''),
        accountType: String(me.account_type ?? 'CREATOR'),
        avatarUrl: (me.profile_picture_url as string) || null,
        followerCount: typeof me.followers_count === 'number' ? me.followers_count : null,
      },
    ]
  }

  async syncContent(accountId: string, cursor?: string): Promise<ContentSyncPage> {
    const query: Record<string, string> = {
      fields: 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url',
      limit: '25',
    }
    if (cursor) query.after = cursor
    const payload = (await this.cfg.fetcher.get('/me/media', query)) as IgMediaPage
    const { items, nextCursor } = mapIgMedia(payload, accountId)
    return { items, nextCursor, raw: payload }
  }

  async syncContentMetrics(content: ConnectorContentItem): Promise<CanonicalMetricValue[]> {
    const payload = (await this.cfg.fetcher.get(`/${content.platformId}/insights`, {
      metric: REEL_METRICS.join(','),
    })) as IgInsightPayload
    return mapIgReelInsights(payload, content, new Date().toISOString())
  }

  async syncAccountMetrics(): Promise<CanonicalMetricValue[]> {
    const me = (await this.cfg.fetcher.get('/me', { fields: 'followers_count' })) as Record<string, unknown>
    const value = typeof me.followers_count === 'number' ? me.followers_count : null
    return [
      {
        metricKey: 'follower_count',
        segment: null,
        value,
        unit: 'count',
        source: 'instagram_api',
        period: 'lifetime',
        observedAt: new Date().toISOString(),
        confidence: 1,
      },
    ]
  }

  async syncAudience(): Promise<CanonicalMetricValue[]> {
    const payload = (await this.cfg.fetcher.get('/me/insights', {
      metric: 'follower_demographics',
      period: 'lifetime',
      metric_type: 'total_value',
      breakdown: 'gender',
    })) as IgAudiencePayload
    return mapIgAudience(payload, new Date().toISOString())
  }
}
