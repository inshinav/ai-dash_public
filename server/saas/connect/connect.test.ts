import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { decryptToken, encryptToken, loadKey } from './crypto'
import { pkcePair, randomState } from './oauth'
import { ConnectionsStore, type SocialConnection } from './connections'
import { tokenNeedsRefresh, syncAccount, syncContent, syncConnectionFull } from './sync'
import { matchExistingPost, normalizeUrl, type ContentStore } from './contentStore'
import type { PostRecord } from '../../types'
import { InstagramLiveFetcher, TikTokLiveFetcher } from './liveFetcher'
import { buildConnector } from './registry'
import { FixtureFetcher } from '../connectors/mockFetcher'
import type { SnapshotInput } from '../snapshots'
import type { SnapshotStore } from '../store'

const KEY = loadKey(Buffer.alloc(32, 7).toString('base64'))

describe('token crypto (AES-256-GCM)', () => {
  it('round-trips a token', () => {
    const blob = encryptToken('secret-access-token', KEY)
    expect(blob).not.toContain('secret-access-token')
    expect(decryptToken(blob, KEY)).toBe('secret-access-token')
  })
  it('fails to decrypt with the wrong key', () => {
    const blob = encryptToken('x', KEY)
    expect(() => decryptToken(blob, loadKey(Buffer.alloc(32, 9).toString('base64')))).toThrow()
  })
  it('detects tampering', () => {
    const blob = encryptToken('x', KEY)
    const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'B' : 'A') + '='
    expect(() => decryptToken(tampered, KEY)).toThrow()
  })
  it('rejects a wrong-size key', () => {
    expect(() => loadKey(Buffer.alloc(16).toString('base64'))).toThrow()
  })
})

describe('PKCE + state', () => {
  it('challenge is base64url(sha256(verifier))', () => {
    const { verifier, challenge } = pkcePair()
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(verifier).not.toMatch(/[+/=]/) // url-safe
  })
  it('state is non-empty and unique', () => {
    expect(randomState()).not.toBe(randomState())
    expect(randomState().length).toBeGreaterThan(10)
  })
})

describe('pending authorizations (CSRF state)', () => {
  it('is single-use and unknown states return null', () => {
    const store = new ConnectionsStore()
    store.createPending({ state: 's1', platform: 'tiktok', workspaceId: 'owner', redirectUri: 'r', codeVerifier: 'v' })
    const first = store.consumePending('s1')
    expect(first?.codeVerifier).toBe('v')
    expect(store.consumePending('s1')).toBeNull() // already consumed
    expect(store.consumePending('nope')).toBeNull()
  })
})

describe('tokenNeedsRefresh', () => {
  const now = Date.parse('2026-06-27T12:00:00.000Z')
  it('false when no expiry', () => expect(tokenNeedsRefresh(null, now)).toBe(false))
  it('false when far in the future', () => expect(tokenNeedsRefresh('2026-08-01T00:00:00.000Z', now)).toBe(false))
  it('true within the margin', () => expect(tokenNeedsRefresh('2026-06-28T00:00:00.000Z', now)).toBe(true))
  it('true when already expired', () => expect(tokenNeedsRefresh('2026-06-01T00:00:00.000Z', now)).toBe(true))
})

// Capture appended snapshots without touching disk.
function stubStore() {
  const appended: SnapshotInput[] = []
  const store = {
    append: async (inputs: SnapshotInput[]) => {
      appended.push(...inputs)
      return inputs.map((i, idx) => ({ ...i, id: `id${idx}`, collectedAt: 'now' }))
    },
  } as unknown as SnapshotStore
  return { store, appended }
}

const connection = (platform: 'instagram' | 'tiktok'): SocialConnection => ({
  id: 'c1', workspaceId: 'owner', platform, platformUserId: 'PU',
  accounts: [{ platform, platformAccountId: 'IG123', username: 'saya.moon', displayName: 'Saya', accountType: 'CREATOR', avatarUrl: null, followerCount: 4820 }],
  encAccessToken: 'enc', encRefreshToken: 'enc', expiresAt: null, scope: [], status: 'active',
  lastSyncAt: null, lastSync: null, createdAt: 'now', updatedAt: 'now',
})

describe('syncAccount (API -> snapshots)', () => {
  it('imports Instagram follower count + demographics with provenance', async () => {
    const connector = buildConnector('instagram', { fetcher: new FixtureFetcher() })
    const { store, appended } = stubStore()
    const summary = await syncAccount(connection('instagram'), connector, store)
    expect(summary.errors).toBe(0)
    expect(summary.imported).toBe(4) // follower_count + 3 follower_gender segments
    const keys = appended.map((a) => a.metricKey)
    expect(keys).toContain('follower_count')
    expect(keys.filter((k) => k === 'follower_gender').length).toBe(3)
    expect(appended.every((a) => a.source === 'instagram_api' && a.contentId === null && a.confirmed)).toBe(true)
    expect(appended.every((a) => a.accountId === 'IG123')).toBe(true)
  })

  it('imports TikTok follower count (no API audience)', async () => {
    const connector = buildConnector('tiktok', { fetcher: new FixtureFetcher() })
    const { store, appended } = stubStore()
    const summary = await syncAccount(connection('tiktok'), connector, store)
    expect(summary.imported).toBe(1)
    expect(appended[0].metricKey).toBe('follower_count')
    expect(appended[0].source).toBe('tiktok_api')
  })
})

// Mocked fetch to validate the HTTP plumbing of the live fetchers (not live-verified).
function mockFetch(responses: Array<{ match: string; body: unknown }>) {
  const calls: Array<{ url: string; method: string }> = []
  const impl = (async (input: unknown, init?: { method?: string }) => {
    const url = String(input)
    calls.push({ url, method: init?.method || 'GET' })
    const hit = responses.find((r) => url.includes(r.match))
    return new Response(JSON.stringify(hit?.body ?? {}), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('live fetchers (HTTP plumbing, mocked)', () => {
  it('Instagram exchangeCode does short->long token exchange', async () => {
    const { impl, calls } = mockFetch([
      { match: 'api.instagram.com/oauth/access_token', body: { access_token: 'short', user_id: 123, permissions: 'instagram_business_basic,instagram_business_manage_insights' } },
      { match: 'graph.instagram.com/access_token', body: { access_token: 'long', expires_in: 5184000 } },
    ])
    const f = new InstagramLiveFetcher({ appId: 'a', appSecret: 's', redirectUri: 'r', fetchImpl: impl })
    const creds = await f.exchangeCode({ code: 'c', redirectUri: 'r' })
    expect(creds.accessToken).toBe('long')
    expect(creds.platformUserId).toBe('123')
    expect(creds.scope).toContain('instagram_business_manage_insights')
    expect(creds.expiresAt).not.toBeNull()
    expect(calls[0].method).toBe('POST')
  })

  it('TikTok exchangeCode posts code + verifier and parses creds', async () => {
    const { impl, calls } = mockFetch([
      { match: '/v2/oauth/token/', body: { access_token: 'tt', refresh_token: 'rt', expires_in: 86400, scope: 'user.info.basic,video.list', open_id: 'oid' } },
    ])
    const f = new TikTokLiveFetcher({ clientKey: 'k', clientSecret: 's', redirectUri: 'r', fetchImpl: impl })
    const creds = await f.exchangeCode({ code: 'c', redirectUri: 'r', codeVerifier: 'v' })
    expect(creds.accessToken).toBe('tt')
    expect(creds.refreshToken).toBe('rt')
    expect(creds.platformUserId).toBe('oid')
    expect(calls[0].method).toBe('POST')
  })

  it('TikTok video.list is issued as POST', async () => {
    const { impl, calls } = mockFetch([{ match: '/v2/video/list/', body: { data: { videos: [], has_more: false } } }])
    const f = new TikTokLiveFetcher({ clientKey: 'k', clientSecret: 's', redirectUri: 'r', accessToken: 'tok', fetchImpl: impl })
    await f.get('/v2/video/list/', { fields: 'id', max_count: '20' })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toContain('/v2/video/list/')
    expect(calls[0].url).toContain('fields=id')
  })
})

function stubContent() {
  const upserts: Array<{ platformId: string; postId: string }> = []
  const store = {
    upsert: async (item: { platformId: string }, postId: string) => {
      upserts.push({ platformId: item.platformId, postId })
      return {}
    },
    toPosts: () => [],
  } as unknown as ContentStore
  return { store, upserts }
}

describe('content sync', () => {
  it('normalizeUrl strips protocol/www/query/trailing slash', () => {
    expect(normalizeUrl('https://www.TikTok.com/@x/video/9/?utm=1')).toBe('tiktok.com/@x/video/9')
  })

  it('matchExistingPost matches by normalized url / platform id', () => {
    const item = { platform: 'instagram', platformId: '17900000000000001', shareUrl: '', permalink: 'https://www.instagram.com/reel/AAAA1/' } as never
    const posts = [{ platform: 'Instagram', postId: 'M1', postUrl: 'instagram.com/reel/AAAA1' }] as unknown as PostRecord[]
    expect(matchExistingPost(item, posts)).toBe('M1')
    expect(matchExistingPost(item, [])).toBeNull()
  })

  it('discovers reels, imports unmatched, writes API metric snapshots', async () => {
    const connector = buildConnector('instagram', { fetcher: new FixtureFetcher() })
    const { store: snaps, appended } = stubStore()
    const { store: cstore, upserts } = stubContent()
    const res = await syncContent(connection('instagram'), connector, cstore, snaps, [])
    expect(res.discovered).toBe(3)
    expect(res.created).toBe(3)
    expect(res.matched).toBe(0)
    expect(res.metricsWritten).toBeGreaterThan(0)
    expect(upserts).toHaveLength(3)
    expect(appended.some((a) => a.contentId === 'IG_api_17900000000000001' && a.source === 'instagram_api')).toBe(true)
  })

  it('matches a reel to an existing manual post (no duplicate import)', async () => {
    const connector = buildConnector('instagram', { fetcher: new FixtureFetcher() })
    const { store: snaps, appended } = stubStore()
    const { store: cstore, upserts } = stubContent()
    const existing = [{ platform: 'Instagram', postId: 'MANUAL1', postUrl: 'https://www.instagram.com/reel/AAAA1/' }] as unknown as PostRecord[]
    const res = await syncContent(connection('instagram'), connector, cstore, snaps, existing)
    expect(res.matched).toBe(1)
    expect(res.created).toBe(2)
    expect(upserts.map((u) => u.postId)).not.toContain('MANUAL1')
    expect(appended.some((a) => a.contentId === 'MANUAL1')).toBe(true)
  })

  it('syncConnectionFull combines account + content', async () => {
    const connector = buildConnector('instagram', { fetcher: new FixtureFetcher() })
    const { store: snaps } = stubStore()
    const { store: cstore } = stubContent()
    const summary = await syncConnectionFull(connection('instagram'), connector, cstore, snaps, [])
    expect(summary.errors).toBe(0)
    expect(summary.imported).toBeGreaterThan(0)
    expect(summary.content?.discovered).toBe(3)
  })
})
