import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, ImagePlus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { api, screenshotUrl, thumbnailUrl, mediaUrl } from './api'
import type { Entry, Platform } from './types'

const METRIC_FIELDS: Array<[string, string]> = [
  ['views', 'Просмотры'],
  ['reach', 'Охват'],
  ['likes', 'Лайки'],
  ['comments', 'Комментарии'],
  ['shares', 'Репосты (shares)'],
  ['reposts', 'Реклипы (reposts)'],
  ['saves', 'Сохранения'],
  ['follows', 'Новые подписки'],
  ['profileVisits', 'Заходы в профиль'],
  ['averageWatchTimeSec', 'Ср. время просмотра, сек'],
]

const PERCENT_FIELDS: Array<[string, string]> = [
  ['skipRate', 'Skip rate, %'],
  ['completionRate', 'Досмотры до конца, %'],
]

const numOrEmpty = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const pctOrEmpty = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(Math.round(value * 1000) / 10)
const toNum = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

type FormState = Record<string, string>

function initialForm(entry?: Entry): FormState {
  const m = entry?.metrics
  return {
    model: entry?.model || '',
    platform: entry?.platform || 'Instagram',
    publishedAt: entry?.publishedAt?.slice(0, 10) || '',
    creativeId: entry?.creativeId || '',
    postUrl: entry?.postUrl || '',
    durationSec: numOrEmpty(entry?.durationSec),
    format: entry?.format || '',
    contentPillar: entry?.contentPillar || '',
    hookType: entry?.hookType || '',
    textOnVideo: entry?.textOnVideo || '',
    caption: entry?.caption || '',
    note: entry?.note || '',
    followersAtPublish: numOrEmpty(entry?.followersAtPublish),
    tags: (entry?.tags || []).join(', '),
    contentTags: (entry?.contentTags || []).join(', '),
    ch_hook: entry?.contentAnalysis?.hook || '',
    ch_scene: entry?.contentAnalysis?.scene || '',
    ch_action: entry?.contentAnalysis?.action || '',
    ch_subject: entry?.contentAnalysis?.subject || '',
    ch_pacing: entry?.contentAnalysis?.pacing || '',
    ch_ending: entry?.contentAnalysis?.ending || '',
    ch_why: entry?.contentAnalysis?.whyItWorked || '',
    views: numOrEmpty(m?.views),
    reach: numOrEmpty(m?.reach),
    likes: numOrEmpty(m?.likes),
    comments: numOrEmpty(m?.comments),
    shares: numOrEmpty(m?.shares),
    reposts: numOrEmpty(m?.reposts),
    saves: numOrEmpty(m?.saves),
    follows: numOrEmpty(m?.follows),
    profileVisits: numOrEmpty(m?.profileVisits),
    averageWatchTimeSec: numOrEmpty(m?.averageWatchTimeSec),
    skipRate: pctOrEmpty(m?.skipRate),
    completionRate: pctOrEmpty(m?.completionRate),
  }
}

export function EntryForm({
  mode,
  entry,
  models,
  formats,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit'
  entry?: Entry
  models: string[]
  formats: string[]
  onSaved: (postId: string) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(entry))
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([])
  const [removedShots, setRemovedShots] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState(false)

  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const existingShots = (entry?.screenshots || []).filter((shot) => !removedShots.includes(shot.id))

  const videoPreview = useMemo(
    () => (videoFile ? URL.createObjectURL(videoFile) : ''),
    [videoFile],
  )
  // Allocate one object URL per screenshot and revoke on change/unmount so the
  // preview never leaks blobs (it must not be recreated on every keystroke).
  const shotPreviews = useMemo(
    () => screenshotFiles.map((file) => URL.createObjectURL(file)),
    [screenshotFiles],
  )
  useEffect(() => () => shotPreviews.forEach((url) => URL.revokeObjectURL(url)), [shotPreviews])
  useEffect(
    () => () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview)
    },
    [videoPreview],
  )

  function buildPayload(allowDuplicate: boolean) {
    return {
      model: form.model.trim(),
      platform: form.platform as Platform,
      publishedAt: form.publishedAt,
      creativeId: form.creativeId.trim(),
      postUrl: form.postUrl.trim(),
      durationSec: toNum(form.durationSec),
      format: form.format.trim(),
      contentPillar: form.contentPillar.trim(),
      hookType: form.hookType.trim(),
      textOnVideo: form.textOnVideo.trim(),
      caption: form.caption.trim(),
      note: form.note.trim(),
      followersAtPublish: toNum(form.followersAtPublish),
      tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      contentTags: form.contentTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      contentAnalysis: {
        hook: form.ch_hook.trim(),
        scene: form.ch_scene.trim(),
        action: form.ch_action.trim(),
        subject: form.ch_subject.trim(),
        pacing: form.ch_pacing.trim(),
        ending: form.ch_ending.trim(),
        whyItWorked: form.ch_why.trim(),
      },
      recordType: 'LIVE' as const,
      allowDuplicate,
      metrics: {
        views: toNum(form.views),
        reach: toNum(form.reach),
        likes: toNum(form.likes),
        comments: toNum(form.comments),
        shares: toNum(form.shares),
        reposts: toNum(form.reposts),
        saves: toNum(form.saves),
        follows: toNum(form.follows),
        profileVisits: toNum(form.profileVisits),
        averageWatchTimeSec: toNum(form.averageWatchTimeSec),
        totalPlayTimeSec: null,
        skipRate: form.skipRate.trim() ? (toNum(form.skipRate) || 0) / 100 : null,
        completionRate: form.completionRate.trim() ? (toNum(form.completionRate) || 0) / 100 : null,
      },
    }
  }

  async function submit(allowDuplicate = false) {
    setError('')
    setDuplicate(false)
    if (!form.model.trim()) {
      setError('Укажите модель')
      return
    }
    if (!form.publishedAt) {
      setError('Укажите дату публикации')
      return
    }
    try {
      setBusy('Сохраняю запись…')
      const payload = buildPayload(allowDuplicate)
      const { entry: saved } =
        mode === 'create'
          ? await api.createEntry(payload)
          : await api.updateEntry(entry!.id, payload)

      if (mode === 'edit') {
        for (const shotId of removedShots) {
          await api.deleteScreenshot(saved.id, shotId).catch(() => undefined)
        }
      }
      if (videoFile) {
        setBusy('Загружаю видео…')
        await api.uploadVideo(saved.id, videoFile)
      }
      if (screenshotFiles.length) {
        setBusy('Загружаю скриншоты…')
        await api.uploadScreenshots(saved.id, screenshotFiles)
      }
      onSaved(saved.postId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить'
      setError(message)
      if (/дубликат|уже есть/i.test(message)) setDuplicate(true)
    } finally {
      setBusy('')
    }
  }

  async function analyze() {
    if (!entry) return
    setError('')
    setBusy('Распознаю видео и скриншоты…')
    try {
      const { draft } = await api.analyzeEntry(entry.id)
      const ca = draft.contentAnalysis
      const m = draft.metrics || {}
      const keepNum = (value: number | null | undefined, current: string) =>
        value !== null && value !== undefined ? String(value) : current
      const keepPct = (value: number | null | undefined, current: string) =>
        value !== null && value !== undefined ? String(Math.round(value * 1000) / 10) : current
      setForm((current) => ({
        ...current,
        ch_hook: ca.hook || current.ch_hook,
        ch_scene: ca.scene || current.ch_scene,
        ch_action: ca.action || current.ch_action,
        ch_subject: ca.subject || current.ch_subject,
        ch_pacing: ca.pacing || current.ch_pacing,
        ch_ending: ca.ending || current.ch_ending,
        ch_why: ca.whyItWorked || current.ch_why,
        contentTags: draft.contentTags.length ? draft.contentTags.join(', ') : current.contentTags,
        views: keepNum(m.views, current.views),
        reach: keepNum(m.reach, current.reach),
        likes: keepNum(m.likes, current.likes),
        comments: keepNum(m.comments, current.comments),
        shares: keepNum(m.shares, current.shares),
        reposts: keepNum(m.reposts, current.reposts),
        saves: keepNum(m.saves, current.saves),
        follows: keepNum(m.follows, current.follows),
        profileVisits: keepNum(m.profileVisits, current.profileVisits),
        averageWatchTimeSec: keepNum(m.averageWatchTimeSec, current.averageWatchTimeSec),
        skipRate: keepPct(m.skipRate, current.skipRate),
        completionRate: keepPct(m.completionRate, current.completionRate),
        durationSec: keepNum(m.durationSec, current.durationSec),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось распознать')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="panel entry-form">
      {error && (
        <div className="error-box entry-error">
          <CircleAlert size={15} /> {error}
          {duplicate && (
            <button type="button" className="text-button" onClick={() => void submit(true)}>
              Всё равно добавить
            </button>
          )}
        </div>
      )}

      <fieldset disabled={Boolean(busy)}>
        <div className="form-section">
          <span className="eyebrow">1 · Модель и платформа</span>
          <div className="form-grid">
            <label>
              Модель *
              <input
                list="entry-models"
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="Например, Saya Moon v1"
              />
              <datalist id="entry-models">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            <label>
              Платформа *
              <select value={form.platform} onChange={(e) => set('platform', e.target.value)}>
                <option>Instagram</option>
                <option>TikTok</option>
              </select>
            </label>
            <label>
              Дата публикации *
              <input
                type="date"
                value={form.publishedAt}
                onChange={(e) => set('publishedAt', e.target.value)}
              />
            </label>
            <label>
              Подписчиков на момент публикации
              <input
                inputMode="numeric"
                value={form.followersAtPublish}
                onChange={(e) => set('followersAtPublish', e.target.value)}
                placeholder="напр. 1200"
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <span className="eyebrow">2 · Видео</span>
          <div className="upload-row">
            <label className="file-drop">
              <Upload size={18} />
              <span>{videoFile ? videoFile.name : 'Выбрать видео (MP4, MOV, WebM)'}</span>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              />
            </label>
            {videoFile && (
              <button type="button" className="icon-button" onClick={() => setVideoFile(null)}>
                <X size={16} />
              </button>
            )}
          </div>
          {videoPreview && <video className="entry-video-preview" src={videoPreview} controls playsInline />}
          {!videoFile && entry?.video && (
            <video
              className="entry-video-preview"
              src={mediaUrl(entry.video.id)}
              poster={entry.video.thumbnailFile ? thumbnailUrl(entry.video.id) : undefined}
              controls
              playsInline
            />
          )}
        </div>

        <div className="form-section">
          <span className="eyebrow">3 · Скриншоты статистики</span>
          <label className="file-drop">
            <ImagePlus size={18} />
            <span>
              {screenshotFiles.length
                ? `${screenshotFiles.length} новых файлов`
                : 'Добавить скриншоты (JPG, PNG, WebP)'}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => setScreenshotFiles(Array.from(e.target.files || []))}
            />
          </label>
          {(existingShots.length > 0 || screenshotFiles.length > 0) && (
            <div className="shot-previews">
              {existingShots.map((shot) => (
                <div className="shot-thumb" key={shot.id}>
                  <img src={screenshotUrl(shot.id)} alt={shot.label} loading="lazy" />
                  <button
                    type="button"
                    aria-label="Удалить скриншот"
                    onClick={() => setRemovedShots((current) => [...current, shot.id])}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {screenshotFiles.map((file, index) => (
                <div className="shot-thumb new" key={`${file.name}-${index}`}>
                  <img src={shotPreviews[index]} alt={file.name} />
                  <span>новый</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-section">
          <div className="section-head">
            <span className="eyebrow">4 · Что происходит в ролике</span>
            {mode === 'edit' && (entry?.video || (entry?.screenshots.length ?? 0) > 0) && (
              <button type="button" className="button secondary compact" onClick={() => void analyze()} disabled={Boolean(busy)}>
                <Sparkles size={14} /> Заполнить автоматически (ИИ)
              </button>
            )}
          </div>
          <div className="form-grid">
            <label>
              Хук (первые 1–3 сек)
              <input value={form.ch_hook} onChange={(e) => set('ch_hook', e.target.value)} />
            </label>
            <label>
              Действие
              <input value={form.ch_action} onChange={(e) => set('ch_action', e.target.value)} />
            </label>
            <label>
              Сцена / сеттинг
              <input value={form.ch_scene} onChange={(e) => set('ch_scene', e.target.value)} />
            </label>
            <label>
              Субъект в кадре
              <input value={form.ch_subject} onChange={(e) => set('ch_subject', e.target.value)} />
            </label>
            <label>
              Динамика / монтаж
              <input value={form.ch_pacing} onChange={(e) => set('ch_pacing', e.target.value)} />
            </label>
            <label>
              Концовка / CTA
              <input value={form.ch_ending} onChange={(e) => set('ch_ending', e.target.value)} />
            </label>
          </div>
          <label className="full-field">
            Теги содержания (через запятую)
            <input
              value={form.contentTags}
              onChange={(e) => set('contentTags', e.target.value)}
              placeholder="ночь, байк, крупный план, экшен"
            />
          </label>
          <label className="full-field">
            Почему зашло / не зашло (гипотеза)
            <textarea
              value={form.ch_why}
              onChange={(e) => set('ch_why', e.target.value)}
              placeholder="Что в содержании, вероятно, дало результат — чтобы переиспользовать"
            />
          </label>
        </div>

        <div className="form-section">
          <span className="eyebrow">5 · Метрики (всё необязательно)</span>
          <div className="form-grid metrics">
            {METRIC_FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  inputMode="numeric"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            {PERCENT_FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input inputMode="decimal" value={form[key]} onChange={(e) => set(key, e.target.value)} />
              </label>
            ))}
            <label>
              Длительность, сек
              <input inputMode="decimal" value={form.durationSec} onChange={(e) => set('durationSec', e.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-section">
          <span className="eyebrow">6 · Контекст и теги</span>
          <div className="form-grid">
            <label>
              Способ генерации / формат
              <input
                list="entry-formats"
                value={form.format}
                onChange={(e) => set('format', e.target.value)}
                placeholder="seedance image-to-video"
              />
              <datalist id="entry-formats">
                {formats.map((format) => (
                  <option key={format} value={format} />
                ))}
              </datalist>
            </label>
            <label>
              Тема
              <input value={form.contentPillar} onChange={(e) => set('contentPillar', e.target.value)} />
            </label>
            <label>
              Creative ID
              <input
                value={form.creativeId}
                onChange={(e) => set('creativeId', e.target.value)}
                placeholder="общий для IG+TikTok"
              />
            </label>
            <label>
              Ссылка на публикацию
              <input value={form.postUrl} onChange={(e) => set('postUrl', e.target.value)} placeholder="https://" />
            </label>
          </div>
          <label className="full-field">
            Хук / текст на видео
            <input value={form.textOnVideo} onChange={(e) => set('textOnVideo', e.target.value)} />
          </label>
          <label className="full-field">
            Теги (через запятую)
            <input
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="ночь, юмор, мотоцикл"
            />
          </label>
          <label className="full-field">
            Описание / подпись
            <textarea value={form.caption} onChange={(e) => set('caption', e.target.value)} />
          </label>
          <label className="full-field">
            Заметка
            <textarea
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Что попробовали, гипотеза, что повторить"
            />
          </label>
        </div>
      </fieldset>

      <div className="entry-actions">
        <button className="button secondary" type="button" onClick={onCancel} disabled={Boolean(busy)}>
          Отмена
        </button>
        <button className="button primary" type="button" onClick={() => void submit(false)} disabled={Boolean(busy)}>
          {busy || (mode === 'create' ? 'Добавить ролик' : 'Сохранить изменения')}
        </button>
      </div>
    </section>
  )
}
