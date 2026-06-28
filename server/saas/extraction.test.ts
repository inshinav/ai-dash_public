import { describe, expect, it } from 'vitest'
import {
  buildExtractionResult,
  needsConfirmation,
  parseCompactNumber,
  parseDecimalToken,
  parseDuration,
  parsePercent,
  splitByConfidence,
  validateExtraction,
  type ExtractionCandidate,
} from './extraction'

describe('parseDecimalToken', () => {
  it('treats one separator with 1-2 trailing digits as decimal', () => {
    expect(parseDecimalToken('12,5')).toBe(12.5)
    expect(parseDecimalToken('12.5')).toBe(12.5)
    expect(parseDecimalToken('0,06')).toBe(0.06)
  })
  it('treats one separator with 3 trailing digits as grouping', () => {
    expect(parseDecimalToken('12,500')).toBe(12500)
    expect(parseDecimalToken('1.250')).toBe(1250)
  })
  it('treats multiple separators and spaces as grouping', () => {
    expect(parseDecimalToken('1.234.567')).toBe(1234567)
    expect(parseDecimalToken('1 250')).toBe(1250)
    expect(parseDecimalToken('12 500')).toBe(12500)
  })
  it('uses the last separator as decimal when both appear', () => {
    expect(parseDecimalToken('1,234.5')).toBe(1234.5)
    expect(parseDecimalToken('1.234,5')).toBe(1234.5)
  })
})

describe('parseCompactNumber', () => {
  it('parses the prompt examples', () => {
    expect(parseCompactNumber('12.5K')).toBe(12500)
    expect(parseCompactNumber('12,5K')).toBe(12500)
    expect(parseCompactNumber('12,5 тыс.')).toBe(12500)
    expect(parseCompactNumber('12 500')).toBe(12500)
    expect(parseCompactNumber('1.2M')).toBe(1200000)
    expect(parseCompactNumber('1,2 млн')).toBe(1200000)
  })
  it('parses plain and grouped integers', () => {
    expect(parseCompactNumber('980')).toBe(980)
    expect(parseCompactNumber('12,500')).toBe(12500)
    expect(parseCompactNumber('1 250')).toBe(1250)
  })
  it('returns null for unreadable text', () => {
    expect(parseCompactNumber('—')).toBeNull()
    expect(parseCompactNumber('')).toBeNull()
    expect(parseCompactNumber('n/a')).toBeNull()
  })
})

describe('parsePercent', () => {
  it('returns whole-percent values across locales', () => {
    expect(parsePercent('34.7%')).toBeCloseTo(34.7)
    expect(parsePercent('34,7 %')).toBeCloseTo(34.7)
    expect(parsePercent('8%')).toBe(8)
    expect(parsePercent('100%')).toBe(100)
  })
})

describe('parseDuration', () => {
  it('parses seconds notations', () => {
    expect(parseDuration('6.8s')).toBeCloseTo(6.8)
    expect(parseDuration('6,8 с')).toBeCloseTo(6.8)
    expect(parseDuration('6.8')).toBeCloseTo(6.8)
  })
  it('parses clock notations', () => {
    expect(parseDuration('1:23')).toBe(83)
    expect(parseDuration('0:06')).toBe(6)
    expect(parseDuration('1:02:03')).toBe(3723)
  })
  it('parses compound notations', () => {
    expect(parseDuration('1m 23s')).toBe(83)
    expect(parseDuration('2 мин 5 сек')).toBe(125)
  })
})

describe('buildExtractionResult', () => {
  const candidates: ExtractionCandidate[] = [
    { metricKey: 'average_watch_time', rawText: '6.8s', modelConfidence: 0.98 },
    { metricKey: 'completion_rate', rawText: '34.7%', modelConfidence: 0.96 },
    { metricKey: 'saves', rawText: '11', modelConfidence: 0.92 },
    { metricKey: 'likes', rawText: '5130', modelConfidence: 0.99 }, // API metric, not on any screenshot screen
  ]

  it('whitelists by screen and normalizes by metric kind', () => {
    const result = buildExtractionResult('tiktok', 'tt_post_overview', candidates, 'task-1')
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.metricKey, m]))
    expect(byKey.average_watch_time.value).toBeCloseTo(6.8)
    expect(byKey.average_watch_time.unit).toBe('seconds')
    expect(byKey.completion_rate.value).toBeCloseTo(0.347) // percent -> fraction
    expect(byKey.completion_rate.unit).toBe('fraction')
    expect(byKey.saves.value).toBe(11)
    expect(byKey.saves.unit).toBe('count')
    expect(byKey.likes).toBeUndefined()
    expect(result.unrecognizedFields.some((f) => f.includes('likes'))).toBe(true)
    expect(result.taskId).toBe('task-1')
  })

  it('rejects a metric that belongs to a different screen (reach is on Viewers, not Overview)', () => {
    const overview = buildExtractionResult('tiktok', 'tt_post_overview', [{ metricKey: 'reach', rawText: '12,5 тыс.', modelConfidence: 0.9 }])
    expect(overview.metrics).toHaveLength(0)
    expect(overview.unrecognizedFields.some((f) => f.includes('reach'))).toBe(true)
    const viewers = buildExtractionResult('tiktok', 'tt_post_viewers', [{ metricKey: 'reach', rawText: '12,5 тыс.', modelConfidence: 0.9 }])
    expect(viewers.metrics[0].value).toBe(12500)
  })

  it('never fabricates an unreadable value — stays null with a warning', () => {
    const result = buildExtractionResult('tiktok', 'tt_post_overview', [
      { metricKey: 'average_watch_time', rawText: 'не видно', modelConfidence: 0.7 },
    ])
    expect(result.metrics[0].value).toBeNull()
    expect(result.metrics[0].confidence).toBe(0)
    expect(result.warnings.length).toBe(1)
    expect(needsConfirmation(result.metrics[0])).toBe(true)
  })

  it('splits confident vs review by threshold', () => {
    const result = buildExtractionResult('tiktok', 'tt_post_overview', [
      { metricKey: 'average_watch_time', rawText: '6.8s', modelConfidence: 0.99 },
      { metricKey: 'saves', rawText: '130', modelConfidence: 0.55 },
    ])
    const { confident, review } = splitByConfidence(result)
    expect(confident.map((m) => m.metricKey)).toEqual(['average_watch_time'])
    expect(review.map((m) => m.metricKey)).toEqual(['saves'])
  })
})

describe('validateExtraction', () => {
  it('flags a wrong screen when no expected metric is found', () => {
    const result = buildExtractionResult('tiktok', 'tt_post_overview', [
      { metricKey: 'reach', rawText: '12,5 тыс.', modelConfidence: 0.9 }, // wrong tab -> rejected
    ])
    const v = validateExtraction(result)
    expect(v.status).toBe('wrong_screen')
    expect(v.screenMatch).toBe(false)
  })

  it('flags incomplete when some expected metrics are missing', () => {
    const result = buildExtractionResult('tiktok', 'tt_post_overview', [
      { metricKey: 'average_watch_time', rawText: '6.8s', modelConfidence: 0.98 },
    ])
    const v = validateExtraction(result)
    expect(v.status).toBe('incomplete')
    expect(v.found).toContain('average_watch_time')
    expect(v.missing).toContain('completion_rate')
  })

  it('reports ok when every expected metric is present', () => {
    const result = buildExtractionResult('tiktok', 'tt_post_overview', [
      { metricKey: 'average_watch_time', rawText: '6.8s', modelConfidence: 1 },
      { metricKey: 'total_play_time', rawText: '2h:59m:45s', modelConfidence: 1 },
      { metricKey: 'completion_rate', rawText: '46.13%', modelConfidence: 1 },
      { metricKey: 'saves', rawText: '11', modelConfidence: 1 },
      { metricKey: 'follows', rawText: '43', modelConfidence: 1 },
      { metricKey: 'hold_rate', rawText: '1%', modelConfidence: 1 },
      { metricKey: 'skip_rate', rawText: '2%', modelConfidence: 1 },
      { metricKey: 'traffic_sources', segment: 'foryou', rawText: '95.1%', modelConfidence: 1 },
    ])
    const v = validateExtraction(result)
    expect(v.complete).toBe(true)
    expect(v.status).toBe('ok')
    expect(v.missing).toHaveLength(0)
  })
})
