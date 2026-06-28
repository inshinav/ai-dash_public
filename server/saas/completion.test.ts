import { describe, expect, it } from 'vitest'
import {
  computeAccountTask,
  computeContentTask,
  contentCompleteness,
  expectedSourceFor,
  prioritizeTasks,
  type AccountForCompletion,
  type CompletionOptions,
  type ContentForCompletion,
} from './completion'
import { InstagramConnector } from './connectors/instagram'
import { TikTokConnector } from './connectors/tiktok'
import { FixtureFetcher } from './connectors/mockFetcher'

const igCaps = new InstagramConnector({ appId: 'x', redirectUri: 'y', fetcher: new FixtureFetcher() }).getCapabilities()
const ttCaps = new TikTokConnector({ clientKey: 'x', redirectUri: 'y', fetcher: new FixtureFetcher() }).getCapabilities()

const NOW = '2026-06-27T12:00:00.000Z'
const threeDaysAgo = '2026-06-24T12:00:00.000Z'
const twoHoursAgo = '2026-06-27T10:00:00.000Z'

const ttOpts = (over: Partial<CompletionOptions> = {}): CompletionOptions => ({
  now: NOW,
  hasApiConnector: true,
  capabilities: ttCaps,
  ...over,
})
const igOpts = (over: Partial<CompletionOptions> = {}): CompletionOptions => ({
  now: NOW,
  hasApiConnector: true,
  capabilities: igCaps,
  ...over,
})

const ttContent = (over: Partial<ContentForCompletion> = {}): ContentForCompletion => ({
  contentId: 'tt1',
  workspaceId: 'w1',
  accountId: 'a-tt',
  platform: 'tiktok',
  publishedAt: threeDaysAgo,
  caption: 'too hot',
  thumbnailUrl: null,
  model: 'Saya',
  ...over,
})

describe('expectedSourceFor', () => {
  it('routes TikTok depth metrics to screenshots, basic counts to the API', () => {
    expect(expectedSourceFor('views', 'tiktok', true, ttCaps)).toBe('api')
    expect(expectedSourceFor('reach', 'tiktok', true, ttCaps)).toBe('screenshot')
    expect(expectedSourceFor('average_watch_time', 'tiktok', true, ttCaps)).toBe('screenshot')
    expect(expectedSourceFor('completion_rate', 'tiktok', true, ttCaps)).toBe('screenshot')
  })
  it('routes Instagram Reel insights to the API and marks completion unsupported', () => {
    expect(expectedSourceFor('average_watch_time', 'instagram', true, igCaps)).toBe('api')
    expect(expectedSourceFor('reach', 'instagram', true, igCaps)).toBe('api')
    expect(expectedSourceFor('completion_rate', 'instagram', true, igCaps)).toBe('unsupported')
    expect(expectedSourceFor('follows', 'instagram', true, igCaps)).toBe('screenshot')
  })
  it('falls back to screenshot for API metrics when no connector is attached', () => {
    // With no connector, an API-capable metric is not auto-delivered: if it is also
    // screenshotable it becomes a screenshot task.
    expect(expectedSourceFor('views', 'tiktok', false, null)).toBe('screenshot')
    expect(expectedSourceFor('average_watch_time', 'instagram', false, null)).toBe('screenshot')
  })
})

describe('computeContentTask (TikTok)', () => {
  it('asks only for the screenshot-assisted metrics and groups them by screen', () => {
    const present = new Set(['views', 'likes', 'comments', 'shares', 'duration'])
    const task = computeContentTask(ttContent(), present, ttOpts())
    expect(task.status).toBe('needs_screenshots')
    const missingKeys = task.missing.filter((m) => m.expectedSource === 'screenshot').map((m) => m.key)
    expect(missingKeys).toEqual(expect.arrayContaining(['reach', 'average_watch_time', 'completion_rate', 'follows', 'traffic_sources']))
    expect(missingKeys).not.toContain('views') // delivered by API
    expect(missingKeys).not.toContain('profile_visits') // unsupported on TikTok
    expect(task.screens.sort()).toEqual(['tt_post_overview', 'tt_post_viewers'])
    expect(task.screenshotCount).toBe(2)
    expect(task.priority).toBeGreaterThan(0)
  })

  it('schedules instead of asking when the reel is too young', () => {
    const present = new Set(['views', 'likes', 'comments', 'shares'])
    const task = computeContentTask(ttContent({ publishedAt: twoHoursAgo }), present, ttOpts())
    expect(task.status).toBe('scheduled')
  })

  it('marks partial when some screenshot metrics already exist', () => {
    const present = new Set(['views', 'likes', 'comments', 'shares', 'reach', 'average_watch_time'])
    const task = computeContentTask(ttContent(), present, ttOpts())
    expect(task.status).toBe('partially_completed')
  })
})

describe('computeContentTask (Instagram)', () => {
  it('only asks for what the IG API cannot deliver', () => {
    const present = new Set([
      'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'total_engagements',
      'average_watch_time', 'total_play_time',
    ])
    const task = computeContentTask(
      { contentId: 'ig1', workspaceId: 'w1', accountId: 'a-ig', platform: 'instagram', publishedAt: threeDaysAgo, caption: 'x', thumbnailUrl: null, model: 'Saya' },
      present,
      igOpts(),
    )
    const missingKeys = task.missing.filter((m) => m.expectedSource === 'screenshot').map((m) => m.key)
    expect(missingKeys).toEqual(expect.arrayContaining(['profile_visits', 'follows', 'traffic_sources']))
    expect(missingKeys).not.toContain('average_watch_time')
    expect(missingKeys).not.toContain('completion_rate') // unsupported on IG, never asked
  })
})

describe('computeAccountTask', () => {
  it('asks for TikTok follower demographics when never collected', () => {
    const account: AccountForCompletion = { accountId: 'a-tt', workspaceId: 'w1', platform: 'tiktok', username: 'saya', lastAudienceAt: null }
    const task = computeAccountTask(account, new Set(), ttOpts())
    expect(task.level).toBe('account')
    expect(task.status).toBe('needs_screenshots')
    expect(task.screens).toContain('tt_account_followers')
  })

  it('does not re-ask fresh IG audience that the API already covers', () => {
    const account: AccountForCompletion = { accountId: 'a-ig', workspaceId: 'w1', platform: 'instagram', username: 'saya', lastAudienceAt: NOW }
    const present = new Set(['follower_count', 'follower_gender', 'follower_age', 'follower_geo'])
    const task = computeAccountTask(account, present, igOpts())
    expect(['completed', 'needs_screenshots']).toContain(task.status)
    // active-times is screenshot-only on IG; if asked, it must be that screen
    if (task.status === 'needs_screenshots') expect(task.screens).toContain('ig_audience')
  })
})

describe('prioritizeTasks', () => {
  it('puts actionable, higher-priority tasks first', () => {
    const a = computeContentTask(ttContent({ contentId: 'a' }), new Set(['views', 'likes', 'comments', 'shares']), ttOpts())
    const b = computeContentTask(ttContent({ contentId: 'b', publishedAt: twoHoursAgo }), new Set(['views', 'likes', 'comments', 'shares']), ttOpts())
    const [first] = prioritizeTasks([b, a])
    expect(first.contentId).toBe('a') // a is actionable now, b is scheduled
  })
})

describe('contentCompleteness', () => {
  it('weights critical metrics and lowers recommendation confidence when they are missing', () => {
    const present = new Set(['views', 'likes', 'comments', 'shares'])
    const c = contentCompleteness(ttContent(), present, ttOpts())
    expect(c.missingCritical).toEqual(expect.arrayContaining(['reach', 'average_watch_time', 'completion_rate', 'follows']))
    expect(c.missingCritical).not.toContain('profile_visits') // unsupported on TikTok
    expect(c.recommendationConfidence).toBe('low')
    expect(c.overall).toBeGreaterThan(0)
    expect(c.overall).toBeLessThan(1)
  })
})
