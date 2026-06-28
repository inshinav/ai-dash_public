import type { ContentAnalysis, DashboardData, Entry, ManualNotes } from './types'

const API = '/ai-dash/api'
const TOKEN_KEY = 'ai-dash-owner-token'

export const ownerToken = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
  has: () => Boolean(localStorage.getItem(TOKEN_KEY)),
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = ownerToken.get()
  const response = await fetch(`${API}${url}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(token ? { 'x-ai-dash-admin-token': token } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body as T
}

export const api = {
  data: () => request<DashboardData>('/data'),
  checkOwner: (token: string) =>
    request<{ ok: boolean }>('/auth/check', {
      method: 'POST',
      headers: { 'x-ai-dash-admin-token': token },
    }),
  listEntries: () => request<{ entries: Entry[] }>('/entries'),
  createEntry: (input: Record<string, unknown>) =>
    request<{ entry: Entry }>('/entries', { method: 'POST', body: JSON.stringify(input) }),
  updateEntry: (id: string, input: Record<string, unknown>) =>
    request<{ entry: Entry }>(`/entries/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteEntry: (id: string) =>
    request<{ deleted: boolean }>(`/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadVideo: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ media: unknown }>(`/entries/${encodeURIComponent(id)}/video`, {
      method: 'POST',
      body: form,
    })
  },
  uploadScreenshots: (id: string, files: File[], labels: string[] = []) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    labels.forEach((label) => form.append('labels', label))
    return request<{ entry: Entry }>(`/entries/${encodeURIComponent(id)}/screenshots`, {
      method: 'POST',
      body: form,
    })
  },
  analyzeEntry: (id: string) =>
    request<{
      draft: {
        contentAnalysis: ContentAnalysis
        contentTags: string[]
        metrics: Record<string, number | null>
      }
    }>(`/entries/${encodeURIComponent(id)}/analyze`, { method: 'POST' }),
  deleteScreenshot: (id: string, screenshotId: string) =>
    request<{ deleted: boolean }>(
      `/entries/${encodeURIComponent(id)}/screenshots/${encodeURIComponent(screenshotId)}`,
      { method: 'DELETE' },
    ),
  saveNotes: (postId: string, notes: Omit<ManualNotes, 'postId' | 'updatedAt'>) =>
    request<{ notes: ManualNotes }>(`/notes/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      body: JSON.stringify(notes),
    }),
}

export const mediaUrl = (id: string) => `/ai-dash/media/${encodeURIComponent(id)}/video`
export const thumbnailUrl = (id: string) =>
  `/ai-dash/media/${encodeURIComponent(id)}/thumbnail`
export const screenshotUrl = (id: string) => `/ai-dash/screenshots/${encodeURIComponent(id)}`
