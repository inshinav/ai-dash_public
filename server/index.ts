import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import helmet from 'helmet'
import { config, validateConfig } from './config.js'
import { MetadataStore } from './store.js'
import {
  deleteMediaFiles,
  deleteScreenshotFile,
  ensureThumbnail,
  finalizeScreenshot,
  finalizeUpload,
  screenshotUpload,
  streamVideo,
  streamVideoFile,
  thumbnailPathFor,
  upload,
} from './media.js'
import { ManualIntake } from './manualIntake.js'
import { EntriesStore } from './entries.js'
import { analyzeAvailable, analyzeReel } from './analyze.js'
import { ValidationError } from './errors.js'
import { dedupMedia, mergePostsByPostId } from './merge.js'
import type { EntryScreenshot, MediaItem, PostRecord } from './types.js'
import { SnapshotStore } from './saas/store.js'
import { applySnapshotsToPosts, buildTasks, completenessForPost } from './saas/completionService.js'
import { SCREEN_GUIDES, guideFor } from './saas/guides.js'
import { metricDef, metricLabelMap, type ScreenType, type SocialPlatform } from './saas/metrics.js'
import { EXTRACTION_VERSION, validateExtraction } from './saas/extraction.js'
import { VisionExtractor } from './saas/visionExtractor.js'
import type { MetricPeriod, SnapshotInput } from './saas/snapshots.js'
import { ConnectionsStore, toConnectionView } from './saas/connect/connections.js'
import { authorizationUrl, buildConnector, connectorsEnabled, redirectUriFor } from './saas/connect/registry.js'
import { connectorKey, decryptToken, encryptToken } from './saas/connect/crypto.js'
import { pkcePair, randomState } from './saas/connect/oauth.js'
import { syncConnectionFull, tokenNeedsRefresh } from './saas/connect/sync.js'
import { ContentStore } from './saas/connect/contentStore.js'

validateConfig()
await fs.mkdir(config.storageDir, { recursive: true })

const app = express()
const store = new MetadataStore()
const manual = new ManualIntake()
const entries = new EntriesStore()
const snapshots = new SnapshotStore()
const connections = new ConnectionsStore()
const content = new ContentStore()
const extractor = new VisionExtractor()
await Promise.all([store.init(), manual.init(), entries.init(), snapshots.init(), connections.init(), content.init()])

const OWNER_WS = 'owner'
const isConnPlatform = (value: string): value is SocialPlatform => value === 'instagram' || value === 'tiktok'

// Current merged posts: seed + owner entries + API-imported reels (deduped by postId).
const currentPosts = (): PostRecord[] =>
  mergePostsByPostId(mergePostsByPostId(manual.getPosts(), entries.toPosts()), content.toPosts())

// All data is server-side: owner entries layered over the read-only manual-intake
// seed (no external sources). Owner analysis notes and raw stat screenshots stay
// private — attached only for a valid owner; the public read view shows the clean
// dashboard and video playback, never the raw source captures or notes.
function buildDashboardData(ownerView: boolean) {
  const now = new Date().toISOString()
  return {
    // Overlay confirmed completion + API snapshots onto the merged posts so screenshot/API
    // values flow into the existing dashboard + analytics unchanged.
    posts: applySnapshotsToPosts(currentPosts(), snapshots.all()),
    audience: manual.getAudience(),
    media: dedupMedia([...entries.listMedia(), ...store.listMedia(), ...manual.listMedia()]),
    screenshots: ownerView ? [...manual.listScreenshots(), ...entries.listScreenshots()] : [],
    notes: ownerView ? store.listNotes() : {},
    syncedAt: now,
    source: 'manual-intake' as const,
    sync: {
      state: 'ok' as const,
      lastAttemptAt: null,
      lastSuccessAt: now,
      error: null,
      stale: false,
      source: 'manual-intake' as const,
    },
  }
}

// Resolve a media id to its item plus the absolute path of its source video, across
// all three media sources. Used by the self-healing thumbnail route.
function resolveMedia(id: string): { item: MediaItem; videoPath: string } | null {
  const manualItem = manual.getMedia(id)
  if (manualItem) return { item: manualItem, videoPath: manual.filePathFor(manualItem) }
  const item = store.getMedia(id) || entries.getMedia(id)
  if (item) {
    return { item, videoPath: path.join(config.storageDir, 'videos', path.basename(item.fileName)) }
  }
  return null
}

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'same-origin' },
  }),
)
app.use(express.json({ limit: '256kb' }))
app.use('/ai-dash/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

// Lightweight in-memory per-IP rate limit for the write surface. The owner token is
// the real gate; this is defence-in-depth against brute force and upload floods.
const RATE_WINDOW_MS = 5 * 60 * 1000
const rateHits = new Map<string, number[]>()
// Reclaim keys whose timestamps have all aged out so the Map can't grow unbounded
// (a spoofed X-Forwarded-For could otherwise mint a fresh key per request).
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS
  for (const [key, hits] of rateHits) {
    if (hits.every((time) => time <= cutoff)) rateHits.delete(key)
  }
}, RATE_WINDOW_MS).unref()

function rateLimit(maxHits: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown'
    const now = Date.now()
    const hits = (rateHits.get(key) || []).filter((time) => now - time < windowMs)
    hits.push(now)
    rateHits.set(key, hits)
    if (hits.length > maxHits) {
      res.status(429).json({ error: 'Слишком много запросов, попробуйте чуть позже' })
      return
    }
    next()
  }
}
const writeLimiter = rateLimit(120, RATE_WINDOW_MS)

function hasValidOwnerToken(req: Request) {
  const provided = req.get('x-ai-dash-admin-token') || ''
  const providedHash = crypto.createHash('sha256').update(provided).digest()
  const expectedHash = crypto.createHash('sha256').update(config.ownerToken).digest()
  return crypto.timingSafeEqual(providedHash, expectedHash)
}

function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!hasValidOwnerToken(req)) {
    res.status(401).json({ error: 'Нужен токен владельца' })
    return
  }
  next()
}

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next)

app.get('/ai-dash/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    stores: { entries: entries.status(), metadata: store.status(), snapshots: snapshots.status(), connections: connections.status(), content: content.status() },
    features: { aiAnalyze: analyzeAvailable(), completion: true, connectors: connectorsEnabled() },
  })
})

// Confirms the owner token without exposing any data — used by the UI unlock.
app.post('/ai-dash/api/auth/check', writeLimiter, requireOwner, (_req, res) => {
  res.json({ ok: true })
})

app.get('/ai-dash/api/data', (req, res) => {
  res.json(buildDashboardData(hasValidOwnerToken(req)))
})

// ---- Owner-authored reels (writable entries store) ----

// Owner-only: raw entries (with ids + raw metrics) so the UI can pre-fill the edit form.
app.get('/ai-dash/api/entries', writeLimiter, requireOwner, (_req, res) => {
  res.json({ entries: entries.list() })
})

app.post(
  '/ai-dash/api/entries',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const entry = await entries.create(req.body || {})
    res.status(201).json({ entry })
  }),
)

app.patch(
  '/ai-dash/api/entries/:id',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const entry = await entries.update(String(req.params.id), req.body || {})
    res.json({ entry })
  }),
)

app.delete(
  '/ai-dash/api/entries/:id',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const entry = await entries.remove(String(req.params.id))
    if (!entry) {
      res.status(404).json({ error: 'Ролик не найден' })
      return
    }
    if (entry.video) await deleteMediaFiles(entry.video)
    await Promise.all(entry.screenshots.map((shot) => deleteScreenshotFile(shot.fileName)))
    res.json({ deleted: true })
  }),
)

app.post(
  '/ai-dash/api/entries/:id/video',
  writeLimiter,
  requireOwner,
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Выберите видеофайл' })
      return
    }
    const entry = entries.get(String(req.params.id))
    if (!entry) {
      await fs.unlink(req.file.path).catch(() => undefined)
      res.status(404).json({ error: 'Ролик не найден' })
      return
    }
    try {
      const media = await finalizeUpload(req.file, 'post', entry.postId)
      const { previous } = await entries.attachVideo(entry.id, media)
      if (previous) await deleteMediaFiles(previous)
      res.status(201).json({ media })
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => undefined)
      throw error
    }
  }),
)

// Owner-only: force-regenerate the thumbnail for a reel from its stored video. The
// public thumbnail route already self-heals on read, so this is a manual override for
// a reel whose first frame is a poor poster.
app.post(
  '/ai-dash/api/entries/:id/thumbnail',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const entry = entries.get(String(req.params.id))
    if (!entry || !entry.video) {
      res.status(404).json({ error: 'У ролика нет загруженного видео' })
      return
    }
    await fs.unlink(thumbnailPathFor(entry.video.id)).catch(() => undefined)
    const videoPath = path.join(config.storageDir, 'videos', path.basename(entry.video.fileName))
    const made = await ensureThumbnail(entry.video.id, videoPath)
    res.json({ ok: Boolean(made), mediaId: made ? entry.video.id : null })
  }),
)

app.post(
  '/ai-dash/api/entries/:id/screenshots',
  writeLimiter,
  requireOwner,
  screenshotUpload.array('files'),
  asyncRoute(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) || []
    if (!files.length) {
      res.status(400).json({ error: 'Выберите хотя бы один скриншот' })
      return
    }
    const entry = entries.get(String(req.params.id))
    if (!entry) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)))
      res.status(404).json({ error: 'Ролик не найден' })
      return
    }
    const labelsRaw = req.body?.labels
    const labels = Array.isArray(labelsRaw) ? labelsRaw : labelsRaw ? [labelsRaw] : []
    const shots: EntryScreenshot[] = []
    try {
      for (let index = 0; index < files.length; index += 1) {
        shots.push(await finalizeScreenshot(files[index], labels[index] || `статистика ${index + 1}`))
      }
      const updated = await entries.addScreenshots(entry.id, shots)
      res.status(201).json({ entry: updated })
    } catch (error) {
      // Clean up both leftover tmp uploads and any screenshots already finalized
      // before the failure, so a partial batch never orphans files on disk.
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)))
      await Promise.all(shots.map((shot) => deleteScreenshotFile(shot.fileName)))
      throw error
    }
  }),
)

app.delete(
  '/ai-dash/api/entries/:id/screenshots/:screenshotId',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const shot = await entries.removeScreenshot(String(req.params.id), String(req.params.screenshotId))
    if (shot) await deleteScreenshotFile(shot.fileName)
    res.json({ deleted: Boolean(shot) })
  }),
)

// AI video analysis (Stage 3) — returns a draft for the owner to review, never auto-saves.
app.post(
  '/ai-dash/api/entries/:id/analyze',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const entry = entries.get(String(req.params.id))
    if (!entry) {
      res.status(404).json({ error: 'Ролик не найден' })
      return
    }
    if (!entry.video && !entry.screenshots.length) {
      res.status(400).json({ error: 'Загрузите видео или скриншоты статистики' })
      return
    }
    const post = entries.toPosts().find((item) => item.postId === entry.postId)
    if (!post) {
      res.status(400).json({ error: 'Нет данных ролика' })
      return
    }
    const draft = await analyzeReel(entry, post)
    res.json({ draft })
  }),
)

app.get('/ai-dash/api/media', (_req, res) => {
  res.json({ media: dedupMedia([...entries.listMedia(), ...store.listMedia(), ...manual.listMedia()]) })
})

// Codex automation path: bind an uploaded video to an arbitrary Post/Creative ID.
app.post(
  '/ai-dash/api/media',
  writeLimiter,
  requireOwner,
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Выберите видеофайл' })
      return
    }
    const bindingType = req.body.bindingType === 'creative' ? 'creative' : 'post'
    const bindingId = String(req.body.bindingId || '').trim()
    if (!bindingId) {
      await fs.unlink(req.file.path).catch(() => undefined)
      res.status(400).json({ error: 'Нужен Post ID или Creative ID' })
      return
    }
    try {
      const media = await finalizeUpload(req.file, bindingType, bindingId)
      await store.addMedia(media)
      const replaceId = String(req.body.replaceId || '')
      if (replaceId) {
        const old = await store.removeMedia(replaceId)
        if (old) await deleteMediaFiles(old)
      }
      res.status(201).json({ media })
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => undefined)
      throw error
    }
  }),
)

app.delete(
  '/ai-dash/api/media/:id',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const item = await store.removeMedia(String(req.params.id))
    if (!item) {
      res.status(404).json({ error: 'Видео не найдено' })
      return
    }
    await deleteMediaFiles(item)
    res.json({ deleted: true })
  }),
)

app.patch(
  '/ai-dash/api/notes/:postId',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const notes = await store.upsertNotes(String(req.params.postId), {
      works: String(req.body?.works || '').slice(0, 5000),
      doesntWork: String(req.body?.doesntWork || '').slice(0, 5000),
      hypothesis: String(req.body?.hypothesis || '').slice(0, 5000),
      changeNext: String(req.body?.changeNext || '').slice(0, 5000),
    })
    res.json({ notes })
  }),
)

app.get('/ai-dash/media/:id/video', (req, res) => {
  const id = String(req.params.id)
  const manualItem = manual.getMedia(id)
  if (manualItem) {
    streamVideoFile(manualItem, manual.filePathFor(manualItem), req, res)
    return
  }
  const item = store.getMedia(id) || entries.getMedia(id)
  if (!item) {
    res.status(404).end()
    return
  }
  streamVideo(item, req, res)
})

app.get(
  '/ai-dash/media/:id/thumbnail',
  asyncRoute(async (req, res) => {
    const resolved = resolveMedia(String(req.params.id))
    if (!resolved) {
      res.status(404).end()
      return
    }
    // Generates the frame on first request if it's missing (seed videos, or an upload
    // whose ffmpeg pass failed), then serves the cached file on every later hit.
    const thumbPath = await ensureThumbnail(resolved.item.id, resolved.videoPath)
    if (!thumbPath) {
      res.status(404).end()
      return
    }
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.sendFile(thumbPath)
  }),
)

app.get('/ai-dash/screenshots/:id', (req, res) => {
  const id = String(req.params.id)
  const manualShot = manual.getScreenshot(id)
  if (manualShot) {
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(manual.filePathFor(manualShot))
    return
  }
  const entryShot = entries.getScreenshot(id)
  if (!entryShot) {
    res.status(404).end()
    return
  }
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader('Content-Disposition', 'inline')
  res.sendFile(entries.screenshotPath(entryShot))
})

// ---- Manual Analytics Completion ("Досбор данных") ----
// All owner-only: these expose private analytics gaps and accept uploads.

const findTask = (id: string) => buildTasks(currentPosts(), snapshots.all()).find((task) => task.id === id) || null

// Read a finalized screenshot back to base64 for the extractor.
async function screenshotBase64(fileName: string): Promise<{ data: string; mime: string }> {
  const p = path.join(config.storageDir, 'screenshots', path.basename(fileName))
  const buf = await fs.readFile(p)
  const mime = /\.png$/i.test(fileName) ? 'image/png' : /\.webp$/i.test(fileName) ? 'image/webp' : 'image/jpeg'
  return { data: buf.toString('base64'), mime }
}

app.get('/ai-dash/api/completion/tasks', writeLimiter, requireOwner, (_req, res) => {
  const posts = currentPosts()
  const snaps = snapshots.all()
  const tasks = buildTasks(posts, snaps).map((task) => {
    if (task.level !== 'content' || !task.contentId) return task
    const post = posts.find((p) => p.postId === task.contentId)
    return { ...task, completeness: completenessForPost(post as PostRecord, snaps) }
  })
  res.json({ tasks })
})

app.get('/ai-dash/api/completion/guides', writeLimiter, requireOwner, (_req, res) => {
  res.json({ guides: SCREEN_GUIDES })
})

app.get('/ai-dash/api/completion/tasks/:id', writeLimiter, requireOwner, (req, res) => {
  const task = findTask(String(req.params.id))
  if (!task) {
    res.status(404).json({ error: 'Задание не найдено' })
    return
  }
  const post = task.contentId ? currentPosts().find((p) => p.postId === task.contentId) || null : null
  const guides = task.screens.map((screen) => guideFor(screen)).filter(Boolean)
  res.json({
    task,
    guides,
    metricLabels: metricLabelMap(),
    post: post
      ? { postId: post.postId, platform: post.platform, shareUrl: post.postUrl, caption: post.caption, publishedAt: post.publishedAt, mediaId: post.postId }
      : null,
  })
})

// Upload stat screenshots for a task + a screenType, auto-extract metrics for confirmation.
app.post(
  '/ai-dash/api/completion/tasks/:id/screenshots',
  writeLimiter,
  requireOwner,
  screenshotUpload.array('files'),
  asyncRoute(async (req, res) => {
    const task = findTask(String(req.params.id))
    if (!task) {
      res.status(404).json({ error: 'Задание не найдено' })
      return
    }
    const screenType = String(req.body?.screenType || '') as ScreenType
    if (!task.screens.includes(screenType)) {
      res.status(400).json({ error: 'Неизвестный экран статистики для этого задания' })
      return
    }
    const files = (req.files as Express.Multer.File[] | undefined) || []
    if (!files.length) {
      res.status(400).json({ error: 'Выберите хотя бы один скриншот' })
      return
    }
    const shots: EntryScreenshot[] = []
    try {
      for (let i = 0; i < files.length; i += 1) shots.push(await finalizeScreenshot(files[i], `${screenType}-${i + 1}`))
      const images = await Promise.all(shots.map((shot) => screenshotBase64(shot.fileName)))
      const extraction = await extractor.extract({
        images,
        platform: task.platform as SocialPlatform,
        screenType,
        taskId: task.id,
      })
      // Immediate check: right screen? all expected data captured?
      const validation = validateExtraction(extraction)
      res.status(201).json({ extraction, validation, screenshotIds: shots.map((shot) => shot.id) })
    } catch (error) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)))
      await Promise.all(shots.map((shot) => deleteScreenshotFile(shot.fileName)))
      throw error
    }
  }),
)

// Confirm reviewed values -> append confirmed metric snapshots (provenance preserved).
app.post(
  '/ai-dash/api/completion/tasks/:id/confirm',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const task = findTask(String(req.params.id))
    if (!task) {
      res.status(404).json({ error: 'Задание не найдено' })
      return
    }
    const body = req.body || {}
    const observedAt = typeof body.observedAt === 'string' && body.observedAt ? body.observedAt : new Date().toISOString()
    const screenshotIds: string[] = Array.isArray(body.screenshotIds) ? body.screenshotIds.map(String) : []
    const incoming = Array.isArray(body.metrics) ? body.metrics : []
    const inputs: SnapshotInput[] = []
    for (const raw of incoming) {
      const def = metricDef(String(raw?.metricKey || ''))
      if (!def) continue
      const value = raw?.value === null || raw?.value === undefined || raw?.value === '' ? null : Number(raw.value)
      if (value !== null && !Number.isFinite(value)) continue
      inputs.push({
        workspaceId: task.workspaceId,
        accountId: task.accountId,
        contentId: def.level === 'account' ? null : task.contentId,
        metricKey: def.key,
        segment: typeof raw?.segment === 'string' ? raw.segment : null,
        value,
        unit: def.unit,
        source: screenshotIds.length ? 'screenshot' : 'manual',
        period: (def.level === 'account' ? 'lifetime' : 'since_publish') as MetricPeriod,
        observedAt,
        confidence: 1,
        confirmed: true,
        screenshotId: screenshotIds[0] || null,
        extractionVersion: screenshotIds.length ? EXTRACTION_VERSION : null,
        rawPayloadRef: null,
      })
    }
    const saved = await snapshots.append(inputs)
    const updated = findTask(String(req.params.id))
    res.json({ saved: saved.length, task: updated })
  }),
)

// ---- Social connections (OAuth) ----
// /start, /sync, list, disconnect are owner-only. The OAuth /callback cannot carry the
// owner header (it's a platform redirect in the browser), so it is gated by the single-use
// CSRF `state` minted by the owner-only /start.

app.get('/ai-dash/api/connections', writeLimiter, requireOwner, (_req, res) => {
  res.json({ connections: connections.list(OWNER_WS).map(toConnectionView), enabled: connectorsEnabled() })
})

app.post(
  '/ai-dash/api/connect/:platform/start',
  writeLimiter,
  requireOwner,
  (req, res) => {
    const platform = String(req.params.platform)
    if (!isConnPlatform(platform)) {
      res.status(400).json({ error: 'Неизвестная платформа' })
      return
    }
    if (!connectorsEnabled()[platform]) {
      res.status(400).json({ error: `Коннектор ${platform} не настроен (нет ключей приложения)` })
      return
    }
    const redirectUri = redirectUriFor(platform) as string
    const state = randomState()
    const pkce = platform === 'tiktok' ? pkcePair() : null
    connections.createPending({ state, platform, workspaceId: OWNER_WS, redirectUri, codeVerifier: pkce?.verifier ?? null })
    const url = authorizationUrl(platform, { workspaceId: OWNER_WS, redirectUri, state, codeChallenge: pkce?.challenge })
    res.json({ authorizeUrl: url })
  },
)

app.get(
  '/ai-dash/api/connect/:platform/callback',
  writeLimiter,
  asyncRoute(async (req, res) => {
    const platform = String(req.params.platform)
    const code = String(req.query.code || '')
    const state = String(req.query.state || '')
    const fail = (msg: string) => res.redirect(`/ai-dash/integrations?error=${encodeURIComponent(msg)}`)
    if (!isConnPlatform(platform) || !code || !state) return fail('bad_request')
    const pending = connections.consumePending(state)
    if (!pending || pending.platform !== platform) return fail('invalid_state')
    const key = connectorKey()
    if (!key) return fail('encryption_key_missing')
    try {
      const exchanger = buildConnector(platform)
      const creds = await exchanger.exchangeAuthorizationCode({ code, redirectUri: pending.redirectUri, codeVerifier: pending.codeVerifier ?? undefined })
      const connector = buildConnector(platform, { accessToken: creds.accessToken })
      const accounts = await connector.listAccounts(creds)
      await connections.upsert({
        workspaceId: pending.workspaceId,
        platform,
        platformUserId: creds.platformUserId || accounts[0]?.platformAccountId || '',
        accounts,
        encAccessToken: encryptToken(creds.accessToken, key),
        encRefreshToken: creds.refreshToken ? encryptToken(creds.refreshToken, key) : null,
        expiresAt: creds.expiresAt,
        scope: creds.scope,
        status: 'active',
        lastSyncAt: null,
        lastSync: null,
      })
      res.redirect(`/ai-dash/integrations?connected=${platform}`)
    } catch (error) {
      console.error('OAuth callback failed', error instanceof Error ? error.message : error)
      fail('exchange_failed')
    }
  }),
)

app.post(
  '/ai-dash/api/connections/:id/sync',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    let conn = connections.get(String(req.params.id))
    if (!conn) {
      res.status(404).json({ error: 'Подключение не найдено' })
      return
    }
    const key = connectorKey()
    if (!key) {
      res.status(400).json({ error: 'Не задан ключ шифрования токенов' })
      return
    }
    // Refresh the token a day before expiry; mark reconnect-required on failure.
    if (conn.encRefreshToken && tokenNeedsRefresh(conn.expiresAt, Date.now())) {
      try {
        const creds = await buildConnector(conn.platform).refreshConnection(decryptToken(conn.encRefreshToken, key))
        conn = (await connections.patch(conn.id, {
          encAccessToken: encryptToken(creds.accessToken, key),
          encRefreshToken: creds.refreshToken ? encryptToken(creds.refreshToken, key) : conn.encRefreshToken,
          expiresAt: creds.expiresAt,
          status: 'active',
        })) || conn
      } catch {
        await connections.patch(conn.id, { status: 'reconnect_required' })
        res.status(409).json({ error: 'Требуется переподключение', reconnect: true })
        return
      }
    }
    const connector = buildConnector(conn.platform, { accessToken: decryptToken(conn.encAccessToken, key) })
    const summary = await syncConnectionFull(conn, connector, content, snapshots, currentPosts())
    const updated = await connections.patch(conn.id, { lastSyncAt: summary.finishedAt, lastSync: summary })
    res.json({ summary, connection: updated ? toConnectionView(updated) : null })
  }),
)

app.delete(
  '/ai-dash/api/connections/:id',
  writeLimiter,
  requireOwner,
  asyncRoute(async (req, res) => {
    const conn = connections.get(String(req.params.id))
    if (!conn) {
      res.status(404).json({ error: 'Подключение не найдено' })
      return
    }
    const key = connectorKey()
    if (key) {
      // Best-effort revoke at the platform; we always drop our stored token.
      try {
        await buildConnector(conn.platform, { accessToken: decryptToken(conn.encAccessToken, key) }).revokeConnection(decryptToken(conn.encAccessToken, key))
      } catch {
        // ignore — disconnect proceeds regardless
      }
    }
    await connections.remove(conn.id)
    res.json({ deleted: true })
  }),
)

app.use('/ai-dash/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

// Standalone mobile completion wizard (plain HTML/CSS/JS, served from server/public).
// Isolated from the Vite SPA so it can't destabilize the dashboard, and CSP-compatible
// (external 'self' script, same-origin fetch). Registered before the SPA catch-all.
const wizardDir = path.resolve('server/public')
app.use('/ai-dash/complete/assets', express.static(path.join(wizardDir, 'assets'), { maxAge: 0 }))
app.get(['/ai-dash/complete', '/ai-dash/complete/'], (_req, res) => {
  res.sendFile(path.join(wizardDir, 'complete.html'))
})
app.use('/ai-dash/integrations/assets', express.static(path.join(wizardDir, 'assets'), { maxAge: 0 }))
app.get(['/ai-dash/integrations', '/ai-dash/integrations/'], (_req, res) => {
  res.sendFile(path.join(wizardDir, 'integrations.html'))
})

const clientDist = path.resolve('dist')
app.use(
  '/ai-dash/assets',
  express.static(path.join(clientDist, 'assets'), {
    maxAge: config.isProduction ? '1y' : 0,
    immutable: config.isProduction,
  }),
)
app.use(
  '/ai-dash',
  express.static(clientDist, {
    index: false,
    maxAge: 0,
  }),
)
app.get('/ai-dash/', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})
app.get('/ai-dash/*splat', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message })
    return
  }
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Файл слишком большой'
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Слишком много файлов'
          : 'Ошибка загрузки файла'
    res.status(413).json({ error: message })
    return
  }
  console.error(error)
  const message = error instanceof Error ? error.message : 'Внутренняя ошибка сервера'
  res.status(500).json({ error: config.isProduction ? 'Внутренняя ошибка сервера' : message })
})

app.listen(config.port, '127.0.0.1', () => {
  console.log(`AI Dash listening on http://127.0.0.1:${config.port}/ai-dash/`)
})
