import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Request, Response } from 'express'
import multer from 'multer'
import { config } from './config.js'
import { ValidationError } from './errors.js'
import type { EntryScreenshot, MediaItem } from './types.js'

const allowedVideoMime = new Map([
  ['video/mp4', '.mp4'],
  ['video/quicktime', '.mov'],
  ['video/webm', '.webm'],
])

const allowedImageMime = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])

export const upload = multer({
  dest: path.join(config.storageDir, 'tmp'),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedVideoMime.has(file.mimetype)) {
      callback(new Error('Поддерживаются MP4, MOV и WebM'))
      return
    }
    callback(null, true)
  },
})

export const screenshotUpload = multer({
  dest: path.join(config.storageDir, 'tmp'),
  limits: { fileSize: config.maxScreenshotBytes, files: config.maxScreenshotFiles },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageMime.has(file.mimetype)) {
      callback(new Error('Поддерживаются JPG, PNG и WebP'))
      return
    }
    callback(null, true)
  },
})

// Bound concurrent ffprobe/ffmpeg processes so a burst of uploads cannot exhaust CPU.
let activeProbes = 0
const probeQueue: Array<() => void> = []
function acquireProbeSlot() {
  if (activeProbes < 2) {
    activeProbes += 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => probeQueue.push(resolve))
}
function releaseProbeSlot() {
  activeProbes -= 1
  const next = probeQueue.shift()
  if (next) {
    activeProbes += 1
    next()
  }
}

function run(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${command}: ${code}`)),
    )
  })
}

// Read the first bytes and confirm the container signature matches the claimed mime,
// so a renamed non-media file is rejected even if its mime header was spoofed.
async function sniff(filePath: string, length = 16): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    return buffer
  } finally {
    await handle.close()
  }
}

function looksLikeVideo(buffer: Buffer, mime: string) {
  if (mime === 'video/webm') return buffer.subarray(0, 4).toString('hex') === '1a45dfa3'
  // mp4 / mov: 'ftyp' box at byte offset 4.
  return buffer.subarray(4, 8).toString('latin1') === 'ftyp'
}

function looksLikeImage(buffer: Buffer, mime: string) {
  const hex = buffer.subarray(0, 4).toString('hex')
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff')
  if (mime === 'image/png') return hex === '89504e47'
  if (mime === 'image/webp')
    return (
      buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buffer.subarray(8, 12).toString('latin1') === 'WEBP'
    )
  return false
}

async function inspectVideo(filePath: string, thumbnailPath: string) {
  let duration: number | null = null
  let width: number | null = null
  let height: number | null = null
  let thumbnailCreated = false

  await acquireProbeSlot()
  try {
    try {
      const { stdout } = await run(config.ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ])
      const probe = JSON.parse(stdout) as {
        streams?: Array<{ width?: number; height?: number }>
        format?: { duration?: string }
      }
      width = probe.streams?.[0]?.width || null
      height = probe.streams?.[0]?.height || null
      const parsedDuration = Number(probe.format?.duration)
      duration = Number.isFinite(parsedDuration) ? parsedDuration : null
    } catch {
      // Upload remains usable if ffprobe is unavailable.
    }

    try {
      await run(config.ffmpegPath, [
        '-y',
        '-ss',
        duration && duration > 2 ? '1' : '0',
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '3',
        thumbnailPath,
      ])
      thumbnailCreated = true
    } catch {
      // Browser still provides a video preview without a generated thumbnail.
    }
  } finally {
    releaseProbeSlot()
  }

  return { duration, width, height, thumbnailCreated }
}

// Pull a single representative frame from a video into a JPEG thumbnail. Best-effort:
// resolves false if ffmpeg is unavailable or fails, so callers degrade gracefully.
async function extractFrame(videoPath: string, thumbnailPath: string, duration: number | null) {
  await acquireProbeSlot()
  try {
    await run(config.ffmpegPath, [
      '-y',
      '-ss',
      duration && duration > 2 ? '1' : '0',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '3',
      thumbnailPath,
    ])
    return true
  } catch {
    return false
  } finally {
    releaseProbeSlot()
  }
}

// Thumbnails are named deterministically `<mediaId>.jpg` (finalizeUpload already does
// this). Self-healing: if the file is missing — seed videos that never got one, or an
// upload whose ffmpeg pass failed — regenerate it from the stored video on demand and
// cache it on disk. An in-flight lock collapses concurrent requests for the same id so
// a burst of public GETs can't spawn duplicate ffmpeg runs.
const thumbInFlight = new Map<string, Promise<string | null>>()

export function thumbnailPathFor(mediaId: string) {
  return path.join(config.storageDir, 'thumbnails', `${path.basename(mediaId)}.jpg`)
}

export async function ensureThumbnail(
  mediaId: string,
  videoPath: string,
): Promise<string | null> {
  const thumbPath = thumbnailPathFor(mediaId)
  if (fsSync.existsSync(thumbPath)) return thumbPath
  const existing = thumbInFlight.get(mediaId)
  if (existing) return existing
  const job = (async () => {
    if (!fsSync.existsSync(videoPath)) return null
    await fs.mkdir(path.dirname(thumbPath), { recursive: true })
    const ok = await extractFrame(videoPath, thumbPath, null)
    return ok && fsSync.existsSync(thumbPath) ? thumbPath : null
  })()
    .catch(() => null)
    .finally(() => thumbInFlight.delete(mediaId))
  thumbInFlight.set(mediaId, job)
  return job
}

export async function finalizeUpload(
  file: Express.Multer.File,
  bindingType: 'post' | 'creative',
  bindingId: string,
): Promise<MediaItem> {
  const signature = await sniff(file.path)
  if (!looksLikeVideo(signature, file.mimetype)) {
    await fs.unlink(file.path).catch(() => undefined)
    throw new ValidationError('Файл не похож на видео MP4, MOV или WebM')
  }
  const id = crypto.randomUUID()
  const extension = allowedVideoMime.get(file.mimetype) || '.mp4'
  const fileName = `${id}${extension}`
  const thumbnailFile = `${id}.jpg`
  const finalPath = path.join(config.storageDir, 'videos', fileName)
  const thumbnailPath = path.join(config.storageDir, 'thumbnails', thumbnailFile)
  await fs.rename(file.path, finalPath)
  // Metadata is best-effort: a valid video signature is enough to accept the file
  // even on a host without ffprobe; dimensions/duration stay null in that case.
  const details = await inspectVideo(finalPath, thumbnailPath)

  return {
    id,
    bindingType,
    bindingId,
    originalName: path.basename(file.originalname),
    fileName,
    thumbnailFile: details.thumbnailCreated ? thumbnailFile : null,
    mimeType: file.mimetype,
    size: file.size,
    duration: details.duration,
    width: details.width,
    height: details.height,
    createdAt: new Date().toISOString(),
  }
}

export async function finalizeScreenshot(
  file: Express.Multer.File,
  label: string,
): Promise<EntryScreenshot> {
  const signature = await sniff(file.path)
  if (!looksLikeImage(signature, file.mimetype)) {
    await fs.unlink(file.path).catch(() => undefined)
    throw new ValidationError('Файл не похож на изображение JPG, PNG или WebP')
  }
  const id = crypto.randomUUID()
  const extension = allowedImageMime.get(file.mimetype) || '.jpg'
  const fileName = `${id}${extension}`
  const finalPath = path.join(config.storageDir, 'screenshots', fileName)
  await fs.rename(file.path, finalPath)
  return {
    id,
    fileName,
    originalName: path.basename(file.originalname),
    label: (label || 'статистика').slice(0, 60),
    mimeType: file.mimetype,
    size: file.size,
  }
}

export async function deleteMediaFiles(item: MediaItem) {
  const results = await Promise.allSettled([
    fs.unlink(path.join(config.storageDir, 'videos', path.basename(item.fileName))),
    item.thumbnailFile
      ? fs.unlink(path.join(config.storageDir, 'thumbnails', path.basename(item.thumbnailFile)))
      : Promise.resolve(),
  ])
  for (const result of results) {
    if (result.status === 'rejected' && (result.reason as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`Failed to delete media file: ${String(result.reason)}`)
    }
  }
}

export async function deleteScreenshotFile(fileName: string) {
  await fs
    .unlink(path.join(config.storageDir, 'screenshots', path.basename(fileName)))
    .catch((error: NodeJS.ErrnoException) => {
      if (error?.code !== 'ENOENT') console.warn(`Failed to delete screenshot: ${String(error)}`)
    })
}

export function streamVideoFile(item: MediaItem, filePath: string, req: Request, res: Response) {
  if (!fsSync.existsSync(filePath)) {
    res.status(404).json({ error: 'Файл не найден' })
    return
  }
  const stat = fsSync.statSync(filePath)
  const range = req.headers.range
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', item.mimeType)
  res.setHeader('Cache-Control', 'private, max-age=3600')

  if (!range) {
    res.setHeader('Content-Length', stat.size)
    fsSync.createReadStream(filePath).pipe(res)
    return
  }
  const [startText, endText] = range.replace(/bytes=/, '').split('-')
  const start = Number(startText)
  // Clamp each response to a bounded chunk so a single range request cannot pull
  // the whole file in one shot.
  const requestedEnd = endText ? Number(endText) : start + 2 * 1024 * 1024
  const end = Math.min(requestedEnd, start + 4 * 1024 * 1024, stat.size - 1)
  if (!Number.isFinite(start) || start < 0 || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`)
    res.end()
    return
  }
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  res.setHeader('Content-Length', end - start + 1)
  fsSync.createReadStream(filePath, { start, end }).pipe(res)
}

export function streamVideo(item: MediaItem, req: Request, res: Response) {
  streamVideoFile(
    item,
    path.join(config.storageDir, 'videos', path.basename(item.fileName)),
    req,
    res,
  )
}
