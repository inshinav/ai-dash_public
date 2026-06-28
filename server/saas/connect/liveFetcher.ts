// Live HTTP PlatformFetcher implementations for Instagram (graph.instagram.com) and
// TikTok (open.tiktokapis.com). The connectors are unchanged; only the HTTP boundary
// differs from the fixtures. `fetchImpl` is injectable so the plumbing is unit-tested
// without network. NOTE: shaped from the official docs but NOT yet exercised against the
// live APIs — harden field-by-field during the credentialed spike.

import type {
  AuthorizationCallbackInput,
  ConnectionCredentials,
  PlatformFetcher,
} from '../connectors/types.js'

type FetchImpl = typeof fetch

async function readJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  return res.json()
}

const expiryFrom = (expiresInSec: unknown): string | null => {
  const n = Number(expiresInSec)
  return Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 1000).toISOString() : null
}

// ---- Instagram ----

export interface InstagramLiveConfig {
  appId: string
  appSecret: string
  redirectUri: string
  accessToken?: string
  graphVersion?: string
  fetchImpl?: FetchImpl
}

export class InstagramLiveFetcher implements PlatformFetcher {
  private readonly cfg: Required<Omit<InstagramLiveConfig, 'accessToken'>> & { accessToken: string }
  private readonly fetchImpl: FetchImpl

  constructor(cfg: InstagramLiveConfig) {
    this.cfg = {
      ...cfg,
      graphVersion: cfg.graphVersion ?? 'v23.0',
      accessToken: cfg.accessToken ?? '',
      fetchImpl: cfg.fetchImpl ?? fetch,
    }
    this.fetchImpl = this.cfg.fetchImpl
  }

  async get(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://graph.instagram.com/${this.cfg.graphVersion}${path}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    url.searchParams.set('access_token', this.cfg.accessToken)
    return readJson(await this.fetchImpl(url, { headers: { accept: 'application/json' } }))
  }

  async exchangeCode(input: AuthorizationCallbackInput): Promise<ConnectionCredentials> {
    const form = new URLSearchParams({
      client_id: this.cfg.appId,
      client_secret: this.cfg.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code: input.code,
    })
    const short = (await readJson(
      await this.fetchImpl('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }),
    )) as { access_token?: string; user_id?: string | number; permissions?: string }

    // Exchange the 1-hour token for a 60-day long-lived token.
    const ll = new URL('https://graph.instagram.com/access_token')
    ll.searchParams.set('grant_type', 'ig_exchange_token')
    ll.searchParams.set('client_secret', this.cfg.appSecret)
    ll.searchParams.set('access_token', String(short.access_token || ''))
    const long = (await readJson(await this.fetchImpl(ll))) as { access_token?: string; expires_in?: number }

    return {
      accessToken: String(long.access_token || short.access_token || ''),
      // Instagram refreshes the access token itself; we store it as the "refresh" handle.
      refreshToken: String(long.access_token || short.access_token || ''),
      expiresAt: expiryFrom(long.expires_in),
      scope: (short.permissions || '').split(',').filter(Boolean),
      platformUserId: String(short.user_id || ''),
    }
  }

  async refresh(refreshToken: string): Promise<ConnectionCredentials> {
    const url = new URL('https://graph.instagram.com/refresh_access_token')
    url.searchParams.set('grant_type', 'ig_refresh_token')
    url.searchParams.set('access_token', refreshToken)
    const j = (await readJson(await this.fetchImpl(url))) as { access_token?: string; expires_in?: number }
    const token = String(j.access_token || refreshToken)
    return { accessToken: token, refreshToken: token, expiresAt: expiryFrom(j.expires_in), scope: [], platformUserId: '' }
  }

  async revoke(): Promise<void> {
    // Instagram has no programmatic token revoke; the user removes the app. We drop our
    // stored token on disconnect. (Optionally DELETE /me/permissions could be attempted.)
  }
}

// ---- TikTok ----

export interface TikTokLiveConfig {
  clientKey: string
  clientSecret: string
  redirectUri: string
  accessToken?: string
  fetchImpl?: FetchImpl
}

export class TikTokLiveFetcher implements PlatformFetcher {
  private readonly cfg: TikTokLiveConfig
  private readonly fetchImpl: FetchImpl

  constructor(cfg: TikTokLiveConfig) {
    this.cfg = cfg
    this.fetchImpl = cfg.fetchImpl || fetch
  }

  async get(path: string, query: Record<string, string>): Promise<unknown> {
    const base = 'https://open.tiktokapis.com'
    const auth = { authorization: `Bearer ${this.cfg.accessToken || ''}` }
    // video.list / video.query are POST with a JSON body; fields ride in the query string.
    if (path.includes('/video/list') || path.includes('/video/query')) {
      const url = new URL(base + path)
      if (query.fields) url.searchParams.set('fields', query.fields)
      const body: Record<string, unknown> = {}
      if (query.cursor) body.cursor = Number(query.cursor)
      if (query.max_count) body.max_count = Number(query.max_count)
      if (query.video_ids) body.filters = { video_ids: query.video_ids.split(',') }
      return readJson(
        await this.fetchImpl(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      )
    }
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return readJson(await this.fetchImpl(url, { headers: auth }))
  }

  private async token(form: URLSearchParams): Promise<ConnectionCredentials> {
    const j = (await readJson(
      await this.fetchImpl('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      }),
    )) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; open_id?: string }
    return {
      accessToken: String(j.access_token || ''),
      refreshToken: j.refresh_token ? String(j.refresh_token) : null,
      expiresAt: expiryFrom(j.expires_in),
      scope: (j.scope || '').split(',').filter(Boolean),
      platformUserId: String(j.open_id || ''),
    }
  }

  exchangeCode(input: AuthorizationCallbackInput): Promise<ConnectionCredentials> {
    const form = new URLSearchParams({
      client_key: this.cfg.clientKey,
      client_secret: this.cfg.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    })
    if (input.codeVerifier) form.set('code_verifier', input.codeVerifier)
    return this.token(form)
  }

  refresh(refreshToken: string): Promise<ConnectionCredentials> {
    return this.token(
      new URLSearchParams({
        client_key: this.cfg.clientKey,
        client_secret: this.cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    )
  }

  async revoke(accessToken: string): Promise<void> {
    await this.fetchImpl('https://open.tiktokapis.com/v2/oauth/revoke/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: this.cfg.clientKey, client_secret: this.cfg.clientSecret, token: accessToken }),
    }).catch(() => undefined)
  }
}
