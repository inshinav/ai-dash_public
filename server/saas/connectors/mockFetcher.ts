// Fixture-backed PlatformFetcher. Lets the Instagram/TikTok connectors run the full flow
// (auth exchange, account discovery, paginated content sync, metric sync, refresh, revoke)
// with zero credentials, against the documented payload shapes in fixtures.ts. Production
// swaps in a real fetcher implementing the same PlatformFetcher interface.

import type {
  AuthorizationCallbackInput,
  ConnectionCredentials,
  PlatformFetcher,
} from './types.js'
import {
  igAudienceFixture,
  igMediaPage2Fixture,
  igMediaPageFixture,
  igReelInsightsFixture,
  igUserFixture,
  ttUserFixture,
  ttVideoPage2Fixture,
  ttVideoPageFixture,
} from './fixtures.js'

export interface FixtureFetcherOptions {
  // Force exchange/refresh to throw, to exercise error paths in tests.
  failAuth?: boolean
}

export class FixtureFetcher implements PlatformFetcher {
  revoked = false
  exchangeCalls = 0
  refreshCalls = 0
  private readonly opts: FixtureFetcherOptions

  constructor(opts: FixtureFetcherOptions = {}) {
    this.opts = opts
  }

  async get(path: string, query: Record<string, string>): Promise<unknown> {
    // ---- Instagram ----
    if (path === '/me') return igUserFixture
    if (path === '/me/media') return query.after ? igMediaPage2Fixture : igMediaPageFixture
    if (path === '/me/insights') return igAudienceFixture
    if (/^\/\d+\/insights$/.test(path)) {
      const id = path.split('/')[1]
      return (igReelInsightsFixture as Record<string, unknown>)[id] || { data: [] }
    }
    // ---- TikTok ----
    if (path === '/v2/user/info/') return ttUserFixture
    if (path === '/v2/video/list/') return query.cursor ? ttVideoPage2Fixture : ttVideoPageFixture
    if (path === '/v2/video/query/') {
      const ids = new Set((query.video_ids || '').split(','))
      const all = [
        ...(ttVideoPageFixture.data.videos || []),
        ...(ttVideoPage2Fixture.data.videos || []),
      ]
      return { data: { videos: all.filter((v) => ids.has(v.id)) }, error: { code: 'ok' } }
    }
    throw new Error(`FixtureFetcher: unhandled GET ${path}`)
  }

  async exchangeCode(input: AuthorizationCallbackInput): Promise<ConnectionCredentials> {
    this.exchangeCalls += 1
    if (this.opts.failAuth) throw new Error('invalid_grant')
    if (!input.code) throw new Error('missing authorization code')
    return {
      accessToken: 'fixture-access-token',
      refreshToken: 'fixture-refresh-token',
      expiresAt: '2026-08-26T00:00:00.000Z',
      scope: ['instagram_business_basic', 'instagram_business_manage_insights'],
      platformUserId: 'fixture-user',
    }
  }

  async refresh(refreshToken: string): Promise<ConnectionCredentials> {
    this.refreshCalls += 1
    if (this.opts.failAuth) throw new Error('invalid_grant')
    if (!refreshToken) throw new Error('missing refresh token')
    return {
      accessToken: 'fixture-access-token-refreshed',
      refreshToken,
      expiresAt: '2026-10-25T00:00:00.000Z',
      scope: ['instagram_business_basic', 'instagram_business_manage_insights'],
      platformUserId: 'fixture-user',
    }
  }

  async revoke(): Promise<void> {
    this.revoked = true
  }
}
