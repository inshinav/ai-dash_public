import 'dotenv/config'
import path from 'node:path'

const isProduction = process.env.NODE_ENV === 'production'
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5173/ai-dash'

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

// The owner token gates every write (entries, media, notes). ADMIN_TOKEN is the
// preferred name; CODEX_ADMIN_TOKEN is kept as an alias so existing production
// environment files keep working without an edit.
const ownerToken = process.env.ADMIN_TOKEN || process.env.CODEX_ADMIN_TOKEN || ''

export const config = {
  isProduction,
  port: positiveInt(process.env.PORT, 4310),
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
  ownerToken,
  // Back-compat alias for older references.
  codexAdminToken: ownerToken,
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  maxUploadBytes: positiveInt(process.env.MAX_UPLOAD_MB, 500) * 1024 * 1024,
  maxScreenshotBytes: positiveInt(process.env.MAX_SCREENSHOT_MB, 12) * 1024 * 1024,
  maxScreenshotFiles: positiveInt(process.env.MAX_SCREENSHOT_FILES, 12),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  // Optional AI video analysis (Stage 3). Inert unless a key is set.
  // Provider auto-detects: OpenAI if OPENAI_API_KEY is set, else Anthropic.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  analyzeProvider: process.env.ANALYZE_PROVIDER || '',
  analyzeModel: process.env.ANALYZE_MODEL || '',
}

export function validateConfig() {
  if (config.ownerToken.length < 32) {
    throw new Error('ADMIN_TOKEN (or CODEX_ADMIN_TOKEN) must contain at least 32 characters')
  }
}
