// Connector abstraction. The UI and analytics engine must NEVER import a platform
// payload — they speak only canonical types. Each platform implements SocialConnector;
// the mock/fixture implementations make the whole flow testable with zero credentials,
// and the live implementations swap in the real fetcher behind the same interface.

import type { MetricSource, MetricUnit, SocialPlatform } from '../metrics.js'
import type { MetricPeriod } from '../snapshots.js'

export type { SocialPlatform } from '../metrics.js'

// A normalized metric value emitted by a connector; the sync layer wraps it into a
// MetricSnapshot (adding ids/timestamps/workspace).
export interface CanonicalMetricValue {
  metricKey: string
  segment: string | null
  value: number | null
  unit: MetricUnit
  source: MetricSource
  period: MetricPeriod
  observedAt: string
  confidence: number
}

// A piece of content (Reel/TikTok) normalized across platforms.
export interface ConnectorContentItem {
  platformId: string
  platform: SocialPlatform
  accountId: string
  // Creative ID is an AI Dash concept (links the same creative across platforms); the
  // connector leaves it null and the app assigns/links it.
  creativeId: string | null
  caption: string
  permalink: string
  shareUrl: string
  mediaType: string
  publishedAt: string
  durationSec: number | null
  thumbnailUrl: string | null
  // The exact raw payload, stored verbatim so a value can be re-derived later.
  raw: unknown
}

export interface ContentSyncPage {
  items: ConnectorContentItem[]
  nextCursor: string | null
  raw: unknown
}

export interface ConnectedSocialAccount {
  platform: SocialPlatform
  platformAccountId: string
  username: string
  displayName: string
  accountType: string
  avatarUrl: string | null
  followerCount: number | null
}

export interface AuthorizationContext {
  workspaceId: string
  redirectUri: string
  state: string
  // PKCE — required by TikTok, recommended for IG.
  codeChallenge?: string
}

export interface AuthorizationCallbackInput {
  code: string
  redirectUri: string
  codeVerifier?: string
}

export interface ConnectionCredentials {
  accessToken: string
  refreshToken: string | null
  // ISO timestamp; null when the platform issues non-expiring/very-long tokens.
  expiresAt: string | null
  scope: string[]
  platformUserId: string
}

export interface ConnectorCapabilities {
  platform: SocialPlatform
  // Canonical keys the API can deliver for a connected creator.
  apiContentMetrics: string[]
  apiAccountMetrics: string[]
  apiAudience: boolean
  // Canonical keys that must come from screenshots on this platform.
  screenshotMetrics: string[]
  contentBackfill: boolean
  incrementalSync: boolean
  webhook: boolean
  // Token lifetime in seconds (for the refresh scheduler), or null if non-expiring.
  accessTokenTtlSec: number | null
  refreshTokenTtlSec: number | null
  oauthPkce: boolean
}

// The HTTP boundary. Tests inject a fixture fetcher; production injects a real one that
// performs the documented requests. Keeping it abstract is what makes the connector
// testable without live credentials.
export interface PlatformFetcher {
  // GET a platform resource; the connector knows the path/fields, the fetcher knows auth.
  get(path: string, query: Record<string, string>): Promise<unknown>
  exchangeCode(input: AuthorizationCallbackInput): Promise<ConnectionCredentials>
  refresh(refreshToken: string): Promise<ConnectionCredentials>
  revoke(accessToken: string): Promise<void>
}

export interface SocialConnector {
  readonly platform: SocialPlatform
  getCapabilities(): ConnectorCapabilities
  getAuthorizationUrl(context: AuthorizationContext): string
  exchangeAuthorizationCode(input: AuthorizationCallbackInput): Promise<ConnectionCredentials>
  refreshConnection(refreshToken: string): Promise<ConnectionCredentials>
  revokeConnection(accessToken: string): Promise<void>
  listAccounts(credentials: ConnectionCredentials): Promise<ConnectedSocialAccount[]>
  syncContent(accountId: string, cursor?: string): Promise<ContentSyncPage>
  syncContentMetrics(content: ConnectorContentItem): Promise<CanonicalMetricValue[]>
  syncAccountMetrics(accountId: string): Promise<CanonicalMetricValue[]>
  // Audience snapshots are modeled as account-level distribution metric values.
  syncAudience(accountId: string): Promise<CanonicalMetricValue[]>
}
