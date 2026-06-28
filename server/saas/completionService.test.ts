import { describe, expect, it } from 'vitest'
import { applySnapshotsToPosts } from './completionService'
import { derivePost, emptyContentAnalysis, emptyTrack, type DeriveMetrics } from '../derive'
import type { MetricSnapshot } from './snapshots'

const makePost = (postId: string, metrics: Partial<DeriveMetrics>) =>
  derivePost({
    postId,
    creativeId: 'CR_1',
    platform: 'TikTok',
    account: 'tt',
    model: 'Saya',
    postUrl: '',
    publishedAt: '2026-06-20',
    durationSec: 10,
    contentPillar: '',
    format: '',
    hookType: '',
    textOnVideo: '',
    caption: '',
    sourceNotes: '',
    tags: [],
    followersAtPublish: null,
    contentAnalysis: emptyContentAnalysis(),
    contentTags: [],
    track: emptyTrack(),
    recordType: 'LIVE',
    metrics: {
      views: null, reach: null, likes: null, comments: null, reposts: null, shares: null,
      saves: null, follows: null, profileVisits: null, averageWatchTimeSec: null,
      totalPlayTimeSec: null, skipRate: null, completionRate: null, ...metrics,
    },
  })

const snap = (over: Partial<MetricSnapshot>): MetricSnapshot => ({
  id: 's', workspaceId: 'owner', accountId: 'tt', contentId: 'TT_1', metricKey: 'reach',
  segment: null, value: 12500, unit: 'count', source: 'screenshot', period: 'since_publish',
  observedAt: '2026-06-21T00:00:00.000Z', collectedAt: '2026-06-21T00:00:00.000Z',
  confidence: 1, confirmed: true, screenshotId: null, extractionVersion: 'v1', rawPayloadRef: null, ...over,
})

describe('applySnapshotsToPosts', () => {
  it('overlays confirmed values and re-derives dependent rates', () => {
    const post = makePost('TT_1', { views: 10000 })
    const out = applySnapshotsToPosts([post], [
      snap({}),
      snap({ metricKey: 'average_watch_time', value: 6.8, unit: 'seconds' }),
      snap({ metricKey: 'traffic_sources', segment: 'foryou', value: 72, unit: 'percent' }),
    ])
    expect(out[0].reach).toBe(12500)
    expect(out[0].viewsPerReached).toBeCloseTo(0.8) // 10000 / 12500
    expect(out[0].averageWatchTime).toBe(6.8)
    expect(out[0].retentionRate).toBeCloseTo(0.68) // 6.8 / 10s, clamped
    expect(out[0].extraMetrics.traffic_foryou_pct).toBe(72)
  })

  it('leaves posts without snapshots untouched (same reference)', () => {
    const post = makePost('TT_1', { views: 10000 })
    const out = applySnapshotsToPosts([post], [snap({ contentId: 'OTHER' })])
    expect(out[0]).toBe(post)
  })

  it('a confirmed null never erases an existing real value', () => {
    const post = makePost('TT_1', { views: 5000, reach: 900 })
    const out = applySnapshotsToPosts([post], [snap({ value: null })])
    expect(out[0].reach).toBe(900)
  })
})
