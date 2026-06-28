import { describe, expect, it } from 'vitest'
import { InstagramConnector, mapIgMedia, mapIgReelInsights } from './instagram'
import { TikTokConnector, mapTtVideoMetrics, mapTtVideos } from './tiktok'
import { FixtureFetcher } from './mockFetcher'
import { igMediaPage2Fixture, igMediaPageFixture, igReelInsightsFixture, ttVideoPageFixture } from './fixtures'
import type { ConnectorContentItem } from './types'

const igConnector = () =>
  new InstagramConnector({ appId: 'APP_ID', redirectUri: 'https://app.test/cb', fetcher: new FixtureFetcher() })
const ttConnector = () =>
  new TikTokConnector({ clientKey: 'CLIENT_KEY', redirectUri: 'https://app.test/cb', fetcher: new FixtureFetcher() })

describe('Instagram connector', () => {
  it('builds a correct authorization URL', () => {
    const url = new URL(igConnector().getAuthorizationUrl({ workspaceId: 'w1', redirectUri: 'https://app.test/cb', state: 'xyz' }))
    expect(url.host).toBe('www.instagram.com')
    expect(url.pathname).toBe('/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('APP_ID')
    expect(url.searchParams.get('state')).toBe('xyz')
    expect(url.searchParams.get('scope')).toContain('instagram_business_manage_insights')
  })

  it('exchanges, lists the account, and refreshes', async () => {
    const fetcher = new FixtureFetcher()
    const ig = new InstagramConnector({ appId: 'APP_ID', redirectUri: 'https://app.test/cb', fetcher })
    const creds = await ig.exchangeAuthorizationCode({ code: 'abc', redirectUri: 'https://app.test/cb' })
    expect(creds.accessToken).toBe('fixture-access-token')
    const accounts = await ig.listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].username).toBe('saya.moon')
    expect(accounts[0].followerCount).toBe(4820)
    const refreshed = await ig.refreshConnection(creds.refreshToken as string)
    expect(refreshed.accessToken).toBe('fixture-access-token-refreshed')
    await ig.revokeConnection(creds.accessToken)
    expect(fetcher.revoked).toBe(true)
  })

  it('surfaces invalid_grant on a failed exchange', async () => {
    const ig = new InstagramConnector({ appId: 'APP_ID', redirectUri: 'https://app.test/cb', fetcher: new FixtureFetcher({ failAuth: true }) })
    await expect(ig.exchangeAuthorizationCode({ code: 'abc', redirectUri: 'https://app.test/cb' })).rejects.toThrow('invalid_grant')
  })

  it('paginates content with a cursor and stops at the end', async () => {
    const ig = igConnector()
    const page1 = await ig.syncContent('17841400000000000')
    expect(page1.items.map((i) => i.platformId)).toEqual(['17900000000000001', '17900000000000002'])
    expect(page1.items[0].platform).toBe('instagram')
    expect(page1.nextCursor).toBe('AFTER_CURSOR_PAGE2')
    const page2 = await ig.syncContent('17841400000000000', page1.nextCursor as string)
    expect(page2.items).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
  })

  it('maps Reel insights to canonical metrics, converting ms to seconds', async () => {
    const ig = igConnector()
    const page = await ig.syncContent('17841400000000000')
    const values = await ig.syncContentMetrics(page.items[0])
    const byKey = Object.fromEntries(values.map((v) => [v.metricKey, v]))
    expect(byKey.views.value).toBe(18540)
    expect(byKey.saves.value).toBe(130)
    expect(byKey.total_engagements.value).toBe(961)
    expect(byKey.average_watch_time.value).toBeCloseTo(6.8) // 6800ms
    expect(byKey.average_watch_time.unit).toBe('seconds')
    expect(byKey.total_play_time.value).toBeCloseTo(126000) // 126000000ms
    expect(byKey.views.source).toBe('instagram_api')
  })

  it('mapping is deterministic / idempotent for the same payload + observedAt', () => {
    const content = { platformId: '17900000000000001' } as ConnectorContentItem
    const at = '2026-06-27T00:00:00.000Z'
    const a = mapIgReelInsights(igReelInsightsFixture['17900000000000001'] as never, content, at)
    const b = mapIgReelInsights(igReelInsightsFixture['17900000000000001'] as never, content, at)
    expect(a).toEqual(b)
  })

  it('returns nextCursor null when paging.next is absent', () => {
    expect(mapIgMedia(igMediaPageFixture, 'acc').nextCursor).toBe('AFTER_CURSOR_PAGE2')
    expect(mapIgMedia(igMediaPage2Fixture, 'acc').nextCursor).toBeNull()
  })
})

describe('TikTok connector', () => {
  it('builds a PKCE authorization URL', () => {
    const url = new URL(
      ttConnector().getAuthorizationUrl({ workspaceId: 'w1', redirectUri: 'https://app.test/cb', state: 's', codeChallenge: 'CC' }),
    )
    expect(url.host).toBe('www.tiktok.com')
    expect(url.searchParams.get('client_key')).toBe('CLIENT_KEY')
    expect(url.searchParams.get('code_challenge')).toBe('CC')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('lists the account and paginates videos', async () => {
    const tt = ttConnector()
    const accounts = await tt.listAccounts()
    expect(accounts[0].followerCount).toBe(5130)
    const page1 = await tt.syncContent('tt-open-id-001')
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0].durationSec).toBe(12)
    expect(page1.items[0].publishedAt).toBe(
      new Date(ttVideoPageFixture.data.videos[0].create_time * 1000).toISOString(),
    )
    expect(page1.nextCursor).toBe('1750412200')
    const page2 = await tt.syncContent('tt-open-id-001', page1.nextCursor as string)
    expect(page2.nextCursor).toBeNull()
  })

  it('only emits the basic counts the Display API actually returns', async () => {
    const tt = ttConnector()
    const page = await tt.syncContent('tt-open-id-001')
    const values = await tt.syncContentMetrics(page.items[0])
    expect(values.map((v) => v.metricKey).sort()).toEqual(['comments', 'likes', 'shares', 'views'])
    expect(values.every((v) => v.source === 'tiktok_api')).toBe(true)
    const byKey = Object.fromEntries(values.map((v) => [v.metricKey, v]))
    expect(byKey.views.value).toBe(41200)
  })

  it('exposes no audience via the API', async () => {
    const tt = ttConnector()
    expect(tt.getCapabilities().apiAudience).toBe(false)
    expect(await tt.syncAudience('tt-open-id-001')).toEqual([])
  })

  it('mapTtVideos / mapTtVideoMetrics map raw payloads purely', () => {
    const { items, nextCursor } = mapTtVideos(ttVideoPageFixture, 'acc')
    expect(items).toHaveLength(2)
    expect(nextCursor).toBe('1750412200')
    const m = mapTtVideoMetrics(ttVideoPageFixture.data.videos[0], '2026-06-27T00:00:00.000Z')
    expect(m.find((v) => v.metricKey === 'views')?.value).toBe(41200)
  })
})
