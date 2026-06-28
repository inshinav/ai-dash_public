// Builds connectors from environment config. A connector is "enabled" only when its app
// credentials are present, so the rest of the app degrades cleanly when live OAuth isn't
// configured yet. Tests inject a fixture fetcher to exercise the full flow with no env.

import { InstagramConnector } from '../connectors/instagram.js'
import { TikTokConnector } from '../connectors/tiktok.js'
import type { AuthorizationContext, PlatformFetcher, SocialConnector, SocialPlatform } from '../connectors/types.js'
import { InstagramLiveFetcher, TikTokLiveFetcher } from './liveFetcher.js'

export interface IgConfig { appId: string; appSecret: string; redirectUri: string }
export interface TtConfig { clientKey: string; clientSecret: string; redirectUri: string }

export function igConfig(): IgConfig | null {
  const { IG_APP_ID, IG_APP_SECRET, IG_REDIRECT_URI } = process.env
  if (IG_APP_ID && IG_APP_SECRET && IG_REDIRECT_URI) {
    return { appId: IG_APP_ID, appSecret: IG_APP_SECRET, redirectUri: IG_REDIRECT_URI }
  }
  return null
}

export function ttConfig(): TtConfig | null {
  const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI } = process.env
  if (TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET && TIKTOK_REDIRECT_URI) {
    return { clientKey: TIKTOK_CLIENT_KEY, clientSecret: TIKTOK_CLIENT_SECRET, redirectUri: TIKTOK_REDIRECT_URI }
  }
  return null
}

export function connectorsEnabled(): Record<SocialPlatform, boolean> {
  return { instagram: Boolean(igConfig()), tiktok: Boolean(ttConfig()) }
}

export function redirectUriFor(platform: SocialPlatform): string | null {
  return platform === 'instagram' ? igConfig()?.redirectUri || null : ttConfig()?.redirectUri || null
}

export interface BuildOptions {
  accessToken?: string
  // Inject a fetcher (tests / fixtures); otherwise a live fetcher is built from env.
  fetcher?: PlatformFetcher
}

export function buildConnector(platform: SocialPlatform, opts: BuildOptions = {}): SocialConnector {
  if (platform === 'instagram') {
    const cfg = igConfig()
    if (!cfg && !opts.fetcher) throw new Error('Instagram connector is not configured (IG_APP_ID/IG_APP_SECRET/IG_REDIRECT_URI)')
    const fetcher = opts.fetcher || new InstagramLiveFetcher({ ...cfg!, accessToken: opts.accessToken })
    return new InstagramConnector({ appId: cfg?.appId || '', redirectUri: cfg?.redirectUri || '', fetcher })
  }
  const cfg = ttConfig()
  if (!cfg && !opts.fetcher) throw new Error('TikTok connector is not configured (TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET/TIKTOK_REDIRECT_URI)')
  const fetcher = opts.fetcher || new TikTokLiveFetcher({ ...cfg!, accessToken: opts.accessToken })
  return new TikTokConnector({ clientKey: cfg?.clientKey || '', redirectUri: cfg?.redirectUri || '', fetcher })
}

export function authorizationUrl(platform: SocialPlatform, context: AuthorizationContext): string {
  return buildConnector(platform).getAuthorizationUrl(context)
}
