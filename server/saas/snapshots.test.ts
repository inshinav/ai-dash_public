import { describe, expect, it } from 'vitest'
import {
  currentValues,
  foldSnapshotsToMetrics,
  presentMetricKeys,
  selectCurrent,
  type MetricSnapshot,
} from './snapshots'

let counter = 0
const snap = (over: Partial<MetricSnapshot>): MetricSnapshot => ({
  id: `s${counter++}`,
  workspaceId: 'w1',
  accountId: 'a1',
  contentId: 'c1',
  metricKey: 'views',
  segment: null,
  value: 100,
  unit: 'count',
  source: 'screenshot',
  period: 'since_publish',
  observedAt: '2026-06-27T10:00:00.000Z',
  collectedAt: '2026-06-27T10:00:00.000Z',
  confidence: 0.9,
  confirmed: true,
  screenshotId: null,
  extractionVersion: null,
  rawPayloadRef: null,
  ...over,
})

describe('selectCurrent', () => {
  it('prefers the later observation among confirmed values', () => {
    const a = snap({ value: 12000, observedAt: '2026-06-27T10:00:00.000Z' })
    const b = snap({ value: 18500, observedAt: '2026-06-27T18:00:00.000Z' })
    expect(selectCurrent([a, b])?.value).toBe(18500)
  })

  it('prefers a non-null value over a later null', () => {
    const real = snap({ value: 18500, observedAt: '2026-06-27T18:00:00.000Z' })
    const blank = snap({ value: null, observedAt: '2026-06-28T10:00:00.000Z' })
    expect(selectCurrent([real, blank])?.value).toBe(18500)
  })

  it('confirmed beats a newer unconfirmed value by default', () => {
    const confirmed = snap({ value: 18500, confirmed: true, observedAt: '2026-06-27T18:00:00.000Z' })
    const fresh = snap({ value: 27000, confirmed: false, observedAt: '2026-06-28T10:00:00.000Z' })
    expect(selectCurrent([confirmed, fresh])?.value).toBe(18500)
  })

  it('can pick the latest unconfirmed when explicitly allowed and none are confirmed', () => {
    const old = snap({ value: 12000, confirmed: false, observedAt: '2026-06-27T10:00:00.000Z' })
    const fresh = snap({ value: 27000, confirmed: false, observedAt: '2026-06-28T10:00:00.000Z' })
    expect(selectCurrent([old, fresh], { allowUnconfirmed: true })?.value).toBe(27000)
    expect(selectCurrent([old, fresh])).toBeNull() // none confirmed, default policy
  })

  it('breaks ties on source trust (manual correction wins)', () => {
    const shot = snap({ value: 100, source: 'screenshot', confidence: 1 })
    const manual = snap({ value: 90, source: 'manual', confidence: 1 })
    expect(selectCurrent([shot, manual])?.source).toBe('manual')
  })

  it('keeps 0 distinct from null', () => {
    const zero = snap({ value: 0, observedAt: '2026-06-28T10:00:00.000Z' })
    const nullv = snap({ value: null, observedAt: '2026-06-27T10:00:00.000Z' })
    expect(selectCurrent([zero, nullv])?.value).toBe(0)
  })
})

describe('currentValues / presentMetricKeys', () => {
  it('resolves one current value per metric slot', () => {
    const snaps = [
      snap({ metricKey: 'views', value: 100 }),
      snap({ metricKey: 'views', value: 250, observedAt: '2026-06-28T10:00:00.000Z' }),
      snap({ metricKey: 'reach', value: 80 }),
    ]
    const current = currentValues(snaps)
    expect(current.size).toBe(2)
  })

  it('reports only confirmed, non-null keys as present', () => {
    const snaps = [
      snap({ metricKey: 'views', value: 250 }),
      snap({ metricKey: 'reach', value: null }),
      snap({ metricKey: 'likes', value: 9, confirmed: false }),
    ]
    const present = presentMetricKeys(snaps, 'c1')
    expect([...present].sort()).toEqual(['views'])
  })
})

describe('foldSnapshotsToMetrics', () => {
  it('projects snapshots back into EntryMetrics + extraMetrics with provenance', () => {
    const snaps = [
      snap({ metricKey: 'views', value: 18500, source: 'tiktok_api' }),
      snap({ metricKey: 'average_watch_time', value: 6.8, source: 'screenshot' }),
      snap({ metricKey: 'traffic_sources', segment: 'foryou', value: 72, source: 'screenshot', unit: 'percent' }),
    ]
    const folded = foldSnapshotsToMetrics(snaps, 'c1')
    expect(folded.metrics.views).toBe(18500)
    expect(folded.metrics.averageWatchTimeSec).toBe(6.8)
    expect(folded.extraMetrics.traffic_foryou_pct).toBe(72)
    expect(folded.provenance.views).toBe('tiktok_api')
    expect(folded.provenance.traffic_foryou_pct).toBe('screenshot')
  })
})
