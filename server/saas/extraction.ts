// Screenshot extraction pipeline (parsing + normalization layer). The multimodal read
// itself is delegated to a ScreenshotExtractor (the production one reuses the existing
// vision call in server/analyze.ts); THIS module owns the deterministic, fully tested part:
// turning the messy on-screen text ("12,5 тыс.", "34.7%", "6.8s", "1:23") into a normalized
// value with the right unit, scoped to exactly the metrics a given stat screen can yield,
// and never inventing a value it cannot read.

import {
  expectedScreenshotMetrics,
  metricDef,
  metricsForScreen,
  type ScreenType,
  type SocialPlatform,
} from './metrics.js'
import { guideFor } from './guides.js'

export const EXTRACTION_VERSION = 'v1'

// ---- locale-aware number parsing ----

const SPACE = /\s/g // \s already matches NBSP and thin/narrow spaces in JS

// Parse a single decimal token where '.' or ',' may be the decimal OR grouping separator,
// and spaces are grouping. Returns the numeric value or null.
export function parseDecimalToken(raw: string): number | null {
  let s = raw.trim().toLowerCase().replace(SPACE, '')
  if (!s) return null
  const negative = s.startsWith('-')
  if (negative) s = s.slice(1)
  s = s.replace(/[^0-9.,]/g, '')
  if (!s || !/[0-9]/.test(s)) return null

  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  let normalized = s
  if (hasDot && hasComma) {
    // The LAST separator is the decimal point; the other is grouping.
    const decSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const grpSep = decSep === '.' ? ',' : '.'
    normalized = s.split(grpSep).join('').replace(decSep, '.')
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ','
    const parts = s.split(sep)
    if (parts.length > 2) {
      // Multiple identical separators => grouping (e.g. 1.234.567).
      normalized = parts.join('')
    } else {
      // One separator: 3 trailing digits => grouping (12,500); 1-2 => decimal (12,5).
      normalized = parts[1].length === 3 ? parts.join('') : `${parts[0]}.${parts[1]}`
    }
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

const SUFFIXES: Array<[RegExp, number]> = [
  [/(млрд|billion|b)\.?$/i, 1e9],
  [/(млн|million|m|кк|mln)\.?$/i, 1e6],
  [/(тыс|тысяч|thousand|k|к)\.?$/i, 1e3],
]

// Parse a compact count like "12.5K", "12,5 тыс.", "1.2M", "12 500", "1 250".
export function parseCompactNumber(raw: string): number | null {
  if (raw == null) return null
  let s = String(raw).trim().toLowerCase()
  if (!s) return null
  let multiplier = 1
  for (const [re, mult] of SUFFIXES) {
    if (re.test(s)) {
      multiplier = mult
      s = s.replace(re, '').trim()
      break
    }
  }
  const base = parseDecimalToken(s)
  if (base === null) return null
  const value = base * multiplier
  return multiplier > 1 ? Math.round(value) : value
}

// Parse a percent value, returning the WHOLE-percent number (34.7%, "34,7 %" -> 34.7).
export function parsePercent(raw: string): number | null {
  if (raw == null) return null
  const s = String(raw).replace('%', ' ').trim()
  return parseDecimalToken(s)
}

// Parse a duration to SECONDS. Handles "6.8s", "6,8 с", "1:23" (m:ss), "1:02:03" (h:mm:ss),
// "1m 23s", "2 мин 5 сек", and a bare number (assumed seconds).
export function parseDuration(raw: string): number | null {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null

  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p.replace(/[^0-9]/g, '')))
    if (parts.some((n) => !Number.isFinite(n))) return null
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return null
  }

  const min = s.match(/(\d+(?:[.,]\d+)?)\s*(?:m|min|мин|минут)/)
  const sec = s.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|с|сек|секунд)/)
  if (min || sec) {
    const m = min ? parseDecimalToken(min[1]) || 0 : 0
    const sc = sec ? parseDecimalToken(sec[1]) || 0 : 0
    return m * 60 + sc
  }
  // bare number => seconds
  return parseDecimalToken(s)
}

// ---- extraction result model ----

export interface ExtractedMetric {
  metricKey: string
  segment: string | null
  // Normalized to the metric's base unit (count / seconds / fraction / whole-percent).
  value: number | null
  unit: string
  confidence: number
  rawText: string
}

export interface ExtractionResult {
  platform: SocialPlatform
  screenType: ScreenType
  taskId: string | null
  metrics: ExtractedMetric[]
  warnings: string[]
  unrecognizedFields: string[]
  extractionVersion: string
}

// A raw candidate the multimodal model proposed for a screen.
export interface ExtractionCandidate {
  metricKey: string
  segment?: string | null
  rawText: string
  modelConfidence: number
}

// Convert a raw on-screen text to the metric's base unit, by metric kind.
function normalizeValue(metricKey: string, rawText: string): { value: number | null; unit: string } {
  const def = metricDef(metricKey)
  if (!def) return { value: null, unit: 'count' }
  switch (def.kind) {
    case 'count':
      return { value: parseCompactNumber(rawText), unit: 'count' }
    case 'duration':
      return { value: parseDuration(rawText), unit: 'seconds' }
    case 'rate': {
      const pct = parsePercent(rawText)
      return { value: pct === null ? null : Math.round((pct / 100) * 10000) / 10000, unit: 'fraction' }
    }
    case 'percent':
    case 'distribution':
      return { value: parsePercent(rawText), unit: 'percent' }
    default:
      return { value: null, unit: 'count' }
  }
}

// Schema-guided normalization: keep only metrics this screen is ALLOWED to yield, parse
// each, drop the rest into unrecognizedFields, and never fabricate an unreadable value
// (it stays null with a warning).
export function buildExtractionResult(
  platform: SocialPlatform,
  screenType: ScreenType,
  candidates: ExtractionCandidate[],
  taskId: string | null = null,
): ExtractionResult {
  const allowed = new Set(metricsForScreen(screenType).map((m) => m.key))
  const metrics: ExtractedMetric[] = []
  const warnings: string[] = []
  const unrecognizedFields: string[] = []

  for (const c of candidates) {
    if (!allowed.has(c.metricKey)) {
      unrecognizedFields.push(`${c.metricKey}="${c.rawText}" (не относится к экрану ${screenType})`)
      continue
    }
    const { value, unit } = normalizeValue(c.metricKey, c.rawText)
    let confidence = Math.max(0, Math.min(1, c.modelConfidence))
    if (value === null) {
      confidence = 0
      warnings.push(`Не удалось распознать значение «${c.rawText}» для ${c.metricKey}`)
    }
    metrics.push({
      metricKey: c.metricKey,
      segment: c.segment ?? null,
      value,
      unit,
      confidence,
      rawText: c.rawText,
    })
  }

  return { platform, screenType, taskId, metrics, warnings, unrecognizedFields, extractionVersion: EXTRACTION_VERSION }
}

// Below this confidence the value must be human-confirmed before it becomes a snapshot.
export const CONFIRM_THRESHOLD = 0.9

export function needsConfirmation(metric: ExtractedMetric, threshold = CONFIRM_THRESHOLD): boolean {
  return metric.value === null || metric.confidence < threshold
}

export function splitByConfidence(result: ExtractionResult, threshold = CONFIRM_THRESHOLD) {
  const confident: ExtractedMetric[] = []
  const review: ExtractedMetric[] = []
  for (const m of result.metrics) {
    if (needsConfirmation(m, threshold)) review.push(m)
    else confident.push(m)
  }
  return { confident, review }
}

// ---- extractor boundary ----

export interface ExtractorImage {
  data: string // base64
  mime: string
}
export interface ExtractInput {
  images: ExtractorImage[]
  platform: SocialPlatform
  screenType: ScreenType
  taskId?: string | null
}
export interface ScreenshotExtractor {
  extract(input: ExtractInput): Promise<ExtractionResult>
}

// ---- post-upload validation (right screen? all data present?) ----

export type ValidationStatus = 'ok' | 'incomplete' | 'wrong_screen'

export interface ExtractionValidation {
  screenType: ScreenType
  screenTitle: string
  expected: string[] // metric keys this screen should yield on this platform
  found: string[] // expected keys that came back with a value
  missing: string[] // expected keys still missing
  screenMatch: boolean // does it look like the right screen at all?
  complete: boolean // all expected metrics present
  status: ValidationStatus
  message: string // human-readable RU verdict for the wizard
}

// Immediate feedback after an upload: is this the screen we asked for, and did we get
// everything? Used to tell the user right away to retake / scroll / switch tab.
export function validateExtraction(result: ExtractionResult): ExtractionValidation {
  const screenType = result.screenType
  const title = guideFor(screenType)?.title || screenType
  const expected = expectedScreenshotMetrics(screenType, result.platform).map((m) => m.key)
  const label = (key: string) => metricDef(key)?.label || key

  if (!expected.length) {
    return { screenType, screenTitle: title, expected, found: [], missing: [], screenMatch: true, complete: true, status: 'ok', message: `Это экран «${title}».` }
  }

  const foundSet = new Set(result.metrics.filter((m) => m.value !== null).map((m) => m.metricKey))
  const found = expected.filter((k) => foundSet.has(k))
  const missing = expected.filter((k) => !foundSet.has(k))
  const screenMatch = found.length > 0
  const complete = screenMatch && missing.length === 0
  // "AI read something" = it returned metrics or rejected off-screen fields. If nothing was
  // read at all (no vision key / unreadable image), don't claim the wrong screen.
  const readSomething = result.metrics.length > 0 || result.unrecognizedFields.length > 0

  let status: ValidationStatus
  let message: string
  if (found.length === 0 && readSomething) {
    status = 'wrong_screen'
    message = `Не похоже на экран «${title}»: распознанные цифры к нему не относятся. Проверьте, что открыли нужную вкладку и блок с цифрами попал в кадр.`
  } else if (found.length === 0) {
    status = 'incomplete'
    message = `Автоматически ничего не считалось — заполните значения вручную ниже (или переснимите экран «${title}» чётче / при ярком свете).`
  } else if (complete) {
    status = 'ok'
    message = `Это экран «${title}». Нашли все ожидаемые показатели (${found.length}).`
  } else {
    status = 'incomplete'
    message = `Экран «${title}», нашли ${found.length} из ${expected.length}. Не хватает: ${missing.map(label).join(', ')}. Доскриньте/прокрутите и добавьте ещё кадр.`
  }
  return { screenType, screenTitle: title, expected, found, missing, screenMatch, complete, status, message }
}

// Deterministic extractor for tests / no-API-key environments. Returns a preset set of
// candidates run through the real normalization, so the whole confirm flow is exercisable
// without a vision model.
export class FixtureExtractor implements ScreenshotExtractor {
  constructor(private readonly candidatesByScreen: Partial<Record<ScreenType, ExtractionCandidate[]>>) {}
  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const candidates = this.candidatesByScreen[input.screenType] || []
    return buildExtractionResult(input.platform, input.screenType, candidates, input.taskId ?? null)
  }
}
