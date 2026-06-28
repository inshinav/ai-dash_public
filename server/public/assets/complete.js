'use strict'
// Standalone mobile completion wizard. Vanilla JS, no build step. Talks to the owner-only
// /ai-dash/api/completion/* endpoints with the same owner token the dashboard stores.

const TOKEN_KEY = 'ai-dash-owner-token'
const ACTIVE_KEY = 'aidash-wizard-active'
const API = '/ai-dash/api/completion'
const DIST_KEYS = new Set([
  'traffic_sources', 'viewer_type', 'follower_status', 'viewer_gender', 'viewer_age',
  'viewer_geo', 'follower_gender', 'follower_age', 'follower_geo', 'follower_active_times',
])
const PLATFORM = {
  TikTok: { app: 'TikTok', cls: 'tiktok' },
  Instagram: { app: 'Instagram', cls: 'instagram' },
  tiktok: { app: 'TikTok', cls: 'tiktok' },
  instagram: { app: 'Instagram', cls: 'instagram' },
}

const app = document.getElementById('app')
const logoutBtn = document.getElementById('logout')

const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const k of kids.flat()) node.append(k && k.nodeType ? k : document.createTextNode(k == null ? '' : String(k)))
  return node
}
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild) }
function toast(msg) {
  const t = el('div', { className: 'toast' }, msg)
  document.body.append(t)
  setTimeout(() => t.remove(), 2600)
}

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'x-ai-dash-admin-token': getToken(), ...(isForm ? {} : { 'content-type': 'application/json' }), ...(opts.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ---- token gate ----
function renderTokenForm(message) {
  logoutBtn.hidden = true
  clear(app)
  const input = el('input', { className: 'token', type: 'password', placeholder: 'Токен владельца', autocomplete: 'off' })
  const go = el('button', { className: 'btn', type: 'button' }, 'Войти')
  go.onclick = async () => {
    localStorage.setItem(TOKEN_KEY, input.value.trim())
    try { await api('/tasks'); start() } catch (e) { renderTokenForm(e.message) }
  }
  app.append(
    el('div', { className: 'card' },
      el('p', { className: 'muted' }, 'Введите токен владельца, чтобы открыть задания на досбор аналитики.'),
      message ? el('p', { className: 'warn' }, message) : '',
      input, go,
    ),
  )
}

// ---- task list ----
function statusLabel(s) {
  return { needs_screenshots: 'нужны скриншоты', partially_completed: 'частично', scheduled: 'рано',
    awaiting_api: 'ждём API', completed: 'готово', no_longer_required: 'не требуется' }[s] || s
}

function taskCard(task) {
  const plat = PLATFORM[task.platform] || { app: task.platform, cls: '' }
  const missing = task.missing.filter((m) => m.expectedSource === 'screenshot').length
  const pct = task.completeness ? Math.round(task.completeness.overall * 100) : null
  const card = el('button', { className: 'task', type: 'button' },
    el('div', { className: 'row' },
      el('span', { className: 'title' }, task.title || task.contentId || task.accountId),
      el('span', { className: 'pill ' + plat.cls }, plat.app),
    ),
    el('div', { className: 'meta' },
      `${task.level === 'account' ? 'Аккаунт' : 'Ролик'} · ${missing} показателей · ${task.screenshotCount} скриншот(ов) · ${statusLabel(task.status)}`),
  )
  if (pct !== null) card.append(el('div', { className: 'bar-meter' }, el('i', { style: `width:${pct}%` })))
  card.onclick = () => openTask(task.id)
  return card
}

async function renderList() {
  logoutBtn.hidden = false
  clear(app)
  app.append(el('p', { className: 'muted' }, 'Загрузка заданий…'))
  let tasks
  try { tasks = (await api('/tasks')).tasks } catch (e) {
    if (/401/.test(e.message) || /владельц/i.test(e.message)) return renderTokenForm()
    clear(app); return app.append(el('p', { className: 'warn' }, e.message))
  }
  const actionable = tasks.filter((t) => t.status === 'needs_screenshots' || t.status === 'partially_completed')
  const later = tasks.filter((t) => t.status === 'scheduled')
  clear(app)
  if (!actionable.length && !later.length) {
    app.append(el('div', { className: 'card' }, el('p', { className: 'muted' }, 'Всё дособрано — заданий нет 🎉')))
    return
  }
  if (actionable.length) {
    app.append(el('div', { className: 'section-h' }, `К работе · ${actionable.length}`))
    actionable.forEach((t) => app.append(taskCard(t)))
  }
  if (later.length) {
    app.append(el('div', { className: 'section-h' }, `Появятся позже · ${later.length}`))
    later.forEach((t) => app.append(taskCard(t)))
  }
}

// ---- single task ----
function labelMap(task) {
  const map = {}
  task.missing.forEach((m) => { map[m.key] = m.label })
  return map
}

function metricRow(labels, m) {
  const review = m.value === null || m.confidence < 0.9
  const name = (labels[m.metricKey] || m.metricKey) + (m.segment ? ' · ' + m.segment : '')
  const input = el('input', { type: 'text', inputMode: 'decimal', value: m.value == null ? '' : String(m.value) })
  const row = el('div', { className: 'metric' + (review ? ' review' : '') },
    el('div', {},
      el('div', { className: 'lbl' }, name),
      el('div', { className: 'raw' }, m.rawText ? `распознано: «${m.rawText}»` : 'введите вручную',
        ' ', el('span', { className: 'conf ' + (review ? 'low' : 'ok') }, m.value == null ? '' : `${Math.round(m.confidence * 100)}%`)),
    ),
    input,
  )
  row._metricKey = m.metricKey
  row._segment = m.segment || null
  row._input = input
  return row
}

function screenBlock(task, guide, post, labelsByKey) {
  const block = el('div', { className: 'screen' })
  block.append(el('h3', {}, guide.title))
  const ol = el('ol', { className: 'steps' })
  guide.steps.forEach((s) => ol.append(el('li', {}, s)))
  block.append(ol)
  if (guide.example) block.append(el('p', { className: 'example' }, guide.example))
  const need = (guide.expectedMetrics || []).map((k) => labelsByKey[k] || k)
  if (need.length) {
    const chips = el('div', { className: 'chips' })
    need.forEach((n) => chips.append(el('span', { className: 'chip' }, n)))
    block.append(el('div', { className: 'need' }, el('span', { className: 'need-h' }, 'Нужно снять: '), chips))
  }

  if (post && post.shareUrl) {
    const open = el('a', { className: 'btn open', href: post.shareUrl, target: '_blank', rel: 'noopener' },
      `Открыть в ${(PLATFORM[task.platform] || {}).app || 'приложении'}`)
    block.append(open, el('div', { className: 'spacer' }))
  }

  const fileLabel = el('label', { className: 'btn secondary filebtn' }, 'Выбрать скриншоты')
  const file = el('input', { type: 'file', accept: 'image/*', multiple: true })
  fileLabel.append(file)
  const previews = el('div', { className: 'previews' })
  const recognize = el('button', { className: 'btn', type: 'button', disabled: true }, 'Распознать')
  const result = el('div', {})
  block.append(fileLabel, previews, recognize, result)

  let chosen = []
  file.onchange = () => {
    chosen = [...file.files]
    clear(previews)
    chosen.forEach((f) => { const img = el('img', { src: URL.createObjectURL(f) }); previews.append(img) })
    recognize.disabled = !chosen.length
    recognize.textContent = chosen.length ? `Распознать (${chosen.length})` : 'Распознать'
  }

  recognize.onclick = async () => {
    recognize.disabled = true; recognize.textContent = 'Распознаю…'
    const form = new FormData()
    chosen.forEach((f) => form.append('files', f))
    form.append('screenType', guide.screen)
    try {
      const { extraction, validation, screenshotIds } = await api(`/tasks/${encodeURIComponent(task.id)}/screenshots`, { method: 'POST', body: form })
      clear(result)
      if (validation) {
        const cls = validation.status === 'ok' ? 'ok' : validation.status === 'incomplete' ? 'warn' : 'bad'
        result.append(el('div', { className: 'banner ' + cls }, validation.message))
      }
      ;(extraction.warnings || []).forEach((w) => result.append(el('p', { className: 'warn' }, w)))
      const rows = []
      const seen = new Set()
      ;(extraction.metrics || []).forEach((m) => { rows.push(metricRow(labelsByKey, m)); seen.add(m.metricKey + (m.segment || '')) })
      // Empty rows for scalar metrics this screen expects but the model didn't read.
      guide.expectedMetrics.filter((k) => !DIST_KEYS.has(k) && !seen.has(k)).forEach((k) =>
        rows.push(metricRow(labelsByKey, { metricKey: k, segment: null, value: null, confidence: 0, rawText: '' })))
      rows.forEach((r) => result.append(r))
      const confirm = el('button', { className: 'btn', type: 'button' }, 'Подтвердить значения')
      confirm.onclick = async () => {
        const metrics = rows.map((r) => ({ metricKey: r._metricKey, segment: r._segment, value: r._input.value.trim() }))
          .filter((m) => m.value !== '')
        if (!metrics.length) return toast('Введите хотя бы одно значение')
        confirm.disabled = true
        try {
          const out = await api(`/tasks/${encodeURIComponent(task.id)}/confirm`, {
            method: 'POST', body: JSON.stringify({ screenType: guide.screen, metrics, screenshotIds, observedAt: new Date().toISOString() }),
          })
          toast(`Сохранено: ${out.saved} показателей`)
          openTask(task.id)
        } catch (e) { confirm.disabled = false; toast(e.message) }
      }
      result.append(el('div', { className: 'spacer' }), confirm)
    } catch (e) {
      recognize.disabled = false; recognize.textContent = 'Распознать'
      toast(e.message)
    }
  }
  return block
}

async function openTask(id) {
  sessionStorage.setItem(ACTIVE_KEY, id)
  clear(app)
  app.append(el('p', { className: 'muted' }, 'Загрузка…'))
  let data
  try { data = await api(`/tasks/${encodeURIComponent(id)}`) } catch (e) { return renderList() }
  const { task, guides, post } = data
  const labelsByKey = { ...labelMap(task), ...(data.metricLabels || {}) }
  clear(app)

  const back = el('button', { className: 'ghost', type: 'button' }, '← К заданиям')
  back.onclick = () => { sessionStorage.removeItem(ACTIVE_KEY); renderList() }
  app.append(back, el('div', { className: 'spacer' }))

  const plat = PLATFORM[task.platform] || { app: task.platform, cls: '' }
  const head = el('div', { className: 'card' },
    el('div', { className: 'row', style: 'display:flex;gap:10px;align-items:center' },
      el('span', { className: 'title', style: 'flex:1;font-weight:650' }, task.title),
      el('span', { className: 'pill ' + plat.cls }, plat.app)),
    el('p', { className: 'meta' }, task.publishedAt ? `Опубликовано ${task.publishedAt.slice(0, 10)}` : 'Аккаунт'),
  )
  if (task.completeness) {
    head.append(
      el('p', { className: 'meta' }, `Полнота данных ${Math.round(task.completeness.overall * 100)}% · уверенность рекомендаций: ${task.completeness.recommendationConfidence}`),
      el('div', { className: 'bar-meter' }, el('i', { style: `width:${Math.round(task.completeness.overall * 100)}%` })),
    )
  }
  app.append(head)

  if (!guides.length) {
    app.append(el('div', { className: 'card' }, el('p', { className: 'muted' },
      task.status === 'completed' ? 'Все нужные показатели уже есть.' : 'Скриншоты пока не нужны — данные подтянет API или ещё рано.')))
    return
  }
  app.append(el('div', { className: 'section-h' }, 'Сделайте скриншоты экранов'))
  guides.forEach((g) => app.append(screenBlock(task, g, post, labelsByKey)))
}

// ---- boot ----
function start() {
  logoutBtn.hidden = false
  const active = sessionStorage.getItem(ACTIVE_KEY)
  if (active) openTask(active)
  else renderList()
}
logoutBtn.onclick = () => { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(ACTIVE_KEY); renderTokenForm() }

if (!getToken()) renderTokenForm()
else api('/tasks').then(start).catch((e) => renderTokenForm(/401|владельц/i.test(e.message) ? '' : e.message))
