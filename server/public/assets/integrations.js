'use strict'
// Integrations page: connect Instagram/TikTok via OAuth, see status, sync, disconnect.
// Talks to the owner-only /ai-dash/api/connections + /ai-dash/api/connect endpoints.

const TOKEN_KEY = 'ai-dash-owner-token'
const API = '/ai-dash/api'
const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', cls: 'instagram' },
  { key: 'tiktok', label: 'TikTok', cls: 'tiktok' },
]

const app = document.getElementById('app')
const logoutBtn = document.getElementById('logout')
const getToken = () => localStorage.getItem(TOKEN_KEY) || ''

const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const k of kids.flat()) node.append(k && k.nodeType ? k : document.createTextNode(k == null ? '' : String(k)))
  return node
}
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild) }
function toast(msg) {
  const t = el('div', { className: 'toast' }, msg)
  document.body.append(t)
  setTimeout(() => t.remove(), 3000)
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'x-ai-dash-admin-token': getToken(), ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

function renderTokenForm(message) {
  logoutBtn.hidden = true
  clear(app)
  const input = el('input', { className: 'token', type: 'password', placeholder: 'Токен владельца', autocomplete: 'off' })
  const go = el('button', { className: 'btn', type: 'button' }, 'Войти')
  go.onclick = async () => {
    localStorage.setItem(TOKEN_KEY, input.value.trim())
    try { await api('/connections'); render() } catch (e) { renderTokenForm(e.message) }
  }
  app.append(el('div', { className: 'card' },
    el('p', { className: 'muted' }, 'Введите токен владельца, чтобы управлять подключениями.'),
    message ? el('p', { className: 'warn' }, message) : '', input, go))
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) } catch { return iso }
}

function platformCard(p, enabled, conn) {
  const card = el('div', { className: 'screen' })
  card.append(el('div', { className: 'row', style: 'display:flex;gap:10px;align-items:center' },
    el('h3', { style: 'margin:0;flex:1' }, p.label),
    el('span', { className: 'pill ' + p.cls }, conn ? statusLabel(conn.status) : enabled ? 'не подключено' : 'не настроено')))

  if (!enabled && !conn) {
    card.append(el('p', { className: 'muted small' },
      `Коннектор не настроен. Добавь ключи приложения ${p.key === 'tiktok' ? '(TIKTOK_CLIENT_KEY/SECRET)' : '(IG_APP_ID/SECRET)'} + CONNECTOR_TOKEN_ENC_KEY в /etc/ai-dash.env и перезапусти сервис.`))
    return card
  }

  if (conn) {
    const acc = conn.accounts && conn.accounts[0]
    card.append(el('p', { className: 'meta' }, acc ? `@${acc.username || conn.platformUserId}` : conn.platformUserId,
      acc && acc.followerCount != null ? ` · ${acc.followerCount} подписчиков` : ''))
    const ls = conn.lastSync
    card.append(el('p', { className: 'meta small' },
      `Синхронизация: ${fmtDate(conn.lastSyncAt)}` +
      (ls && ls.content ? ` · ролики: найдено ${ls.content.discovered}, импортировано ${ls.content.created}, метрик ${ls.imported}` : '') +
      (ls && ls.errors ? ` · ошибки: ${ls.errors}` : '')))
    if (conn.status === 'reconnect_required') card.append(el('p', { className: 'warn' }, 'Токен истёк — переподключите.'))

    const sync = el('button', { className: 'btn', type: 'button' }, 'Синхронизировать')
    sync.onclick = async () => {
      sync.disabled = true; sync.textContent = 'Синхронизирую…'
      try {
        const out = await api(`/connections/${encodeURIComponent(conn.id)}/sync`, { method: 'POST', body: '{}' })
        const c = out.summary && out.summary.content
        toast(c ? `Готово: метрик ${out.summary.imported}, роликов ${c.discovered}` : 'Синхронизация выполнена')
        render()
      } catch (e) { sync.disabled = false; sync.textContent = 'Синхронизировать'; toast(e.message) }
    }
    const disc = el('button', { className: 'btn secondary', type: 'button' }, 'Отключить')
    disc.onclick = async () => {
      if (!confirm(`Отключить ${p.label}? Импортированные снимки метрик останутся.`)) return
      try { await api(`/connections/${encodeURIComponent(conn.id)}`, { method: 'DELETE' }); toast('Отключено'); render() } catch (e) { toast(e.message) }
    }
    card.append(sync, el('div', { className: 'spacer' }), disc)
    return card
  }

  // enabled but not connected
  const connect = el('button', { className: 'btn open', type: 'button' }, `Подключить ${p.label}`)
  connect.onclick = async () => {
    connect.disabled = true
    try {
      const { authorizeUrl } = await api(`/connect/${p.key}/start`, { method: 'POST', body: '{}' })
      window.location.href = authorizeUrl
    } catch (e) { connect.disabled = false; toast(e.message) }
  }
  card.append(connect)
  return card
}

function statusLabel(s) {
  return { active: 'подключено', reconnect_required: 'нужно переподключить', revoked: 'отключено' }[s] || s
}

async function render() {
  logoutBtn.hidden = false
  clear(app)
  app.append(el('p', { className: 'muted' }, 'Загрузка…'))
  let data
  try { data = await api('/connections') } catch (e) {
    if (/401|владельц/i.test(e.message)) return renderTokenForm()
    clear(app); return app.append(el('p', { className: 'warn' }, e.message))
  }
  clear(app)
  app.append(el('p', { className: 'muted small' }, 'Подключи аккаунты — система сама импортирует ролики и доступные по API метрики. Чего API не отдаёт — дособираешь скриншотами в «Досборе».'))
  const byPlatform = {}
  ;(data.connections || []).forEach((c) => { byPlatform[c.platform] = c })
  PLATFORMS.forEach((p) => app.append(platformCard(p, (data.enabled || {})[p.key], byPlatform[p.key])))
  app.append(el('div', { className: 'spacer' }),
    el('a', { className: 'btn secondary', href: '/ai-dash/complete' }, 'Перейти к досбору данных →'))
}

logoutBtn.onclick = () => { localStorage.removeItem(TOKEN_KEY); renderTokenForm() }

// Toast the OAuth callback result (?connected=… / ?error=…), then clean the URL.
const params = new URLSearchParams(location.search)
if (params.get('connected')) toast(`Подключено: ${params.get('connected')}`)
if (params.get('error')) toast(`Ошибка подключения: ${params.get('error')}`)
if (params.toString()) history.replaceState({}, '', location.pathname)

if (!getToken()) renderTokenForm()
else render()
