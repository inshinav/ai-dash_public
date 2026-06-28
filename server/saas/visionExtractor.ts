// Production ScreenshotExtractor — schema-guided multimodal extraction. It tells the model
// EXACTLY which metrics the given stat screen can yield (whitelisted from the registry),
// asks for the raw on-screen text per metric, then runs the deterministic normalization in
// extraction.ts. When no vision provider key is configured it returns an empty result with
// a warning, so the wizard degrades to manual confirmation rather than failing.

import { visionComplete } from '../analyze.js'
import { metricsForScreen, type ScreenType } from './metrics.js'
import { guideFor } from './guides.js'
import {
  buildExtractionResult,
  type ExtractInput,
  type ExtractionCandidate,
  type ExtractionResult,
  type ScreenshotExtractor,
} from './extraction.js'

function buildPrompt(screen: ScreenType): string {
  const allowed = metricsForScreen(screen)
  const guide = guideFor(screen)
  const lines = allowed.map((m) => {
    const seg = m.segments ? ` (segment ∈ {${m.segments.join(', ')}}; для geo — код страны)` : ''
    return `- ${m.key}: ${m.label}${seg}`
  })
  return [
    `На изображениях — скриншоты экрана статистики «${guide?.title || screen}» (${guide?.app || ''}).`,
    'Считай ТОЛЬКО перечисленные ниже показатели, строго как на экране, без догадок.',
    'Если показателя на экране нет или он нечитаем — НЕ включай его (не выдумывай).',
    'Числа возвращай ровно как написаны на экране (например "12,5 тыс.", "34.7%", "6.8s").',
    '',
    'Допустимые показатели (metricKey):',
    ...lines,
    '',
    'Верни ТОЛЬКО JSON без markdown:',
    '{ "metrics": [ { "metricKey": "...", "segment": null, "rawText": "...", "confidence": 0.0 } ] }',
  ].join('\n')
}

function parseCandidates(text: string): ExtractionCandidate[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const metrics = (parsed as { metrics?: unknown }).metrics
  if (!Array.isArray(metrics)) return []
  const out: ExtractionCandidate[] = []
  for (const raw of metrics) {
    const m = raw as Record<string, unknown>
    const metricKey = typeof m.metricKey === 'string' ? m.metricKey : ''
    const rawText = m.rawText == null ? '' : String(m.rawText)
    if (!metricKey || !rawText) continue
    const confidence = typeof m.confidence === 'number' ? m.confidence : 0.7
    out.push({
      metricKey,
      segment: typeof m.segment === 'string' ? m.segment : null,
      rawText,
      modelConfidence: confidence,
    })
  }
  return out
}

export class VisionExtractor implements ScreenshotExtractor {
  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const prompt = buildPrompt(input.screenType)
    const text = await visionComplete(
      prompt,
      input.images.map((i) => ({ data: i.data, mime: i.mime })),
    )
    if (text === null) {
      const empty = buildExtractionResult(input.platform, input.screenType, [], input.taskId ?? null)
      empty.warnings.push('ИИ-распознавание не настроено (нет ключа) — введите значения вручную.')
      return empty
    }
    const candidates = parseCandidates(text)
    return buildExtractionResult(input.platform, input.screenType, candidates, input.taskId ?? null)
  }
}
