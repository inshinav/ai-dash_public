import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { config } from './config.js'
import { emptyContentAnalysis } from './derive.js'
import { ValidationError } from './errors.js'
import type { ContentAnalysis, Entry, PostRecord } from './types.js'

type Provider = 'openai' | 'anthropic'
type Img = { data: string; mime: string }

const mimeFromName = (name: string) =>
  /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'

function provider(): Provider | null {
  const pref = config.analyzeProvider.toLowerCase()
  if (pref === 'openai' && config.openaiApiKey) return 'openai'
  if (pref === 'anthropic' && config.anthropicApiKey) return 'anthropic'
  if (config.openaiApiKey) return 'openai'
  if (config.anthropicApiKey) return 'anthropic'
  return null
}

const modelFor = (p: Provider) =>
  config.analyzeModel || (p === 'openai' ? 'gpt-5.5' : 'claude-sonnet-4-6')

export const analyzeAvailable = () => provider() !== null

export type VisionImage = Img

// Generic vision completion used by the screenshot-extraction pipeline (server/saas).
// Returns the model's raw text, or null when no provider key is configured so callers can
// degrade to manual entry instead of failing.
export async function visionComplete(prompt: string, images: Img[]): Promise<string | null> {
  const p = provider()
  if (!p) return null
  return p === 'openai' ? callOpenAI(prompt, images) : callAnthropic(prompt, images)
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg: ${code}`))))
  })
}

// Pull a handful of evenly-spaced frames so the model sees the hook, middle and end.
async function extractFrames(videoPath: string, duration: number | null, count = 6): Promise<Img[]> {
  const dir = path.join(config.storageDir, 'tmp', `frames-${crypto.randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  const fractions = Array.from({ length: count }, (_, i) => (i + 0.5) / count)
  const frames: Img[] = []
  try {
    for (let i = 0; i < count; i += 1) {
      const at = duration && duration > 0 ? (fractions[i] * duration).toFixed(2) : String(i)
      const out = path.join(dir, `f${i}.jpg`)
      try {
        await run(config.ffmpegPath, ['-y', '-ss', at, '-i', videoPath, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', out])
        frames.push({ data: Buffer.from(await fs.readFile(out)).toString('base64'), mime: 'image/jpeg' })
      } catch {
        // skip a frame that can't be grabbed (e.g. past the end)
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  return frames
}

// Read the entry's uploaded stat screenshots so the model can OCR the numbers.
async function loadScreenshots(entry: Entry): Promise<Img[]> {
  const out: Img[] = []
  for (const shot of entry.screenshots.slice(0, 8)) {
    try {
      const p = path.join(config.storageDir, 'screenshots', path.basename(shot.fileName))
      out.push({ data: Buffer.from(await fs.readFile(p)).toString('base64'), mime: mimeFromName(shot.fileName) })
    } catch {
      // skip a screenshot that can't be read
    }
  }
  return out
}

const PROMPT = `Тебе даны изображения двух видов:
A) КАДРЫ короткого вертикального видео (Reel/TikTok) по порядку от начала к концу;
B) СКРИНШОТЫ экрана статистики этого ролика (Instagram/TikTok Insights) с числами.

Сделай две вещи, строго по тому, что видно, без догадок:
1) По КАДРАМ ВИДЕО опиши содержание.
2) По СКРИНШОТАМ СТАТИСТИКИ считай числа (ровно как на экране; если метрики нет — null; проценты возвращай как число процентов, напр. 32.6, а не долю).

Верни ТОЛЬКО JSON (без markdown, без пояснений) на русском:
{
 "hook": "что в первых кадрах цепляет внимание",
 "scene": "обстановка/сеттинг",
 "action": "ключевое действие",
 "subject": "кто/что в кадре, крупность плана",
 "pacing": "динамика/смена планов",
 "ending": "чем заканчивается, есть ли призыв",
 "whyItWorked": "гипотеза, почему сработал/нет (учитывай метрики)",
 "contentTags": ["3-7 коротких тегов содержания"],
 "metrics": {
   "views": null, "reach": null, "likes": null, "comments": null,
   "reposts": null, "shares": null, "saves": null, "follows": null,
   "profileVisits": null, "averageWatchTimeSec": null,
   "skipRatePct": null, "completionRatePct": null, "durationSec": null
 }
}`

export interface DraftMetrics {
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  reposts: number | null
  shares: number | null
  saves: number | null
  follows: number | null
  profileVisits: number | null
  averageWatchTimeSec: number | null
  skipRate: number | null
  completionRate: number | null
  durationSec: number | null
}

const numOr = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[%,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}
const pctToFraction = (value: unknown): number | null => {
  const n = numOr(value)
  return n === null ? null : n / 100
}

function parseJson(text: string): {
  contentAnalysis: ContentAnalysis
  contentTags: string[]
  metrics: DraftMetrics
} {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Модель не вернула JSON')
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const str = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 1000) : '')
  const m = (raw.metrics || {}) as Record<string, unknown>
  return {
    contentAnalysis: {
      ...emptyContentAnalysis(),
      hook: str(raw.hook),
      scene: str(raw.scene),
      action: str(raw.action),
      subject: str(raw.subject),
      pacing: str(raw.pacing),
      ending: str(raw.ending),
      whyItWorked: str(raw.whyItWorked),
    },
    contentTags: Array.isArray(raw.contentTags)
      ? raw.contentTags.map((tag) => str(tag)).filter(Boolean).slice(0, 12)
      : [],
    metrics: {
      views: numOr(m.views),
      reach: numOr(m.reach),
      likes: numOr(m.likes),
      comments: numOr(m.comments),
      reposts: numOr(m.reposts),
      shares: numOr(m.shares),
      saves: numOr(m.saves),
      follows: numOr(m.follows),
      profileVisits: numOr(m.profileVisits),
      averageWatchTimeSec: numOr(m.averageWatchTimeSec),
      skipRate: pctToFraction(m.skipRatePct),
      completionRate: pctToFraction(m.completionRatePct),
      durationSec: numOr(m.durationSec),
    },
  }
}

async function callOpenAI(prompt: string, images: Img[]) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelFor('openai'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mime};base64,${img.data}` },
            })),
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 200)}`)
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return body.choices?.[0]?.message?.content || ''
}

async function callAnthropic(prompt: string, images: Img[]) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelFor('anthropic'),
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mime, data: img.data },
            })),
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 200)}`)
  }
  const body = (await response.json()) as { content?: Array<{ text?: string }> }
  return body.content?.map((part) => part.text || '').join('') || ''
}

// Send the reel's video frames AND its stat screenshots to a vision model
// (OpenAI GPT-5.5 by default) and return a draft: content + auto-read metrics.
export async function analyzeReel(entry: Entry, post: PostRecord) {
  const p = provider()
  if (!p) throw new ValidationError('ИИ-анализ не настроен: задайте OPENAI_API_KEY (или ANTHROPIC_API_KEY)')
  const videoPath = entry.video
    ? path.join(config.storageDir, 'videos', path.basename(entry.video.fileName))
    : null
  const frames = videoPath
    ? await extractFrames(videoPath, entry.video?.duration ?? entry.durationSec ?? null)
    : []
  const screenshots = await loadScreenshots(entry)
  const images = [...frames, ...screenshots]
  if (!images.length) {
    throw new ValidationError('Нужно видео или скриншоты статистики для анализа')
  }

  const context = `Контекст: платформа ${post.platform}, модель ${post.model || '—'}.`
  const prompt = `${PROMPT}\n\n${context}`
  const text = p === 'openai' ? await callOpenAI(prompt, images) : await callAnthropic(prompt, images)
  return parseJson(text)
}
