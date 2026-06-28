// Social connections store — encrypted OAuth credentials + discovered accounts + sync
// status per (workspace, platform). Additive JSON sidecar (saas-connections.json), same
// atomic-write helpers as the rest of the app, drop-in shape for the future Postgres
// `social_connections` table. Pending authorizations (CSRF state + PKCE verifier) live
// in-memory only — short-lived and single-process.

import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../../config.js'
import { readJsonFileSafe, writeJsonFileAtomic } from '../../jsonFile.js'
import type { ConnectedSocialAccount, SocialPlatform } from '../connectors/types.js'

const SCHEMA_VERSION = 1
const PENDING_TTL_MS = 10 * 60 * 1000

export type ConnectionStatus = 'active' | 'reconnect_required' | 'revoked'

export interface SyncRunSummary {
  startedAt: string
  finishedAt: string
  imported: number
  updated: number
  errors: number
  errorSummary: string | null
  // Present on a full sync: content discovery breakdown.
  content?: { discovered: number; matched: number; created: number; metricsWritten: number }
}

export interface SocialConnection {
  id: string
  workspaceId: string
  platform: SocialPlatform
  platformUserId: string
  accounts: ConnectedSocialAccount[]
  encAccessToken: string
  encRefreshToken: string | null
  expiresAt: string | null
  scope: string[]
  status: ConnectionStatus
  lastSyncAt: string | null
  lastSync: SyncRunSummary | null
  createdAt: string
  updatedAt: string
}

// Public projection — never leaks encrypted tokens to the client.
export interface ConnectionView {
  id: string
  workspaceId: string
  platform: SocialPlatform
  platformUserId: string
  accounts: ConnectedSocialAccount[]
  scope: string[]
  status: ConnectionStatus
  expiresAt: string | null
  lastSyncAt: string | null
  lastSync: SyncRunSummary | null
  createdAt: string
}

export function toConnectionView(c: SocialConnection): ConnectionView {
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    platform: c.platform,
    platformUserId: c.platformUserId,
    accounts: c.accounts,
    scope: c.scope,
    status: c.status,
    expiresAt: c.expiresAt,
    lastSyncAt: c.lastSyncAt,
    lastSync: c.lastSync,
    createdAt: c.createdAt,
  }
}

export interface PendingAuth {
  state: string
  platform: SocialPlatform
  workspaceId: string
  redirectUri: string
  codeVerifier: string | null
  createdAt: number
}

interface ConnectionsFile {
  schemaVersion: number
  connections: SocialConnection[]
}

export class ConnectionsStore {
  private connections: SocialConnection[] = []
  private pending = new Map<string, PendingAuth>()
  private corrupted = false
  private readonly filePath = path.join(config.storageDir, 'saas-connections.json')
  private writeQueue = Promise.resolve()

  async init() {
    const result = await readJsonFileSafe<ConnectionsFile>(this.filePath)
    this.corrupted = result.status === 'corrupt'
    this.connections = Array.isArray(result.value?.connections) ? result.value!.connections : []
    if (result.status === 'missing') await this.persist()
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonFileAtomic(this.filePath, { schemaVersion: SCHEMA_VERSION, connections: this.connections } satisfies ConnectionsFile),
    )
    return this.writeQueue
  }

  status() {
    return { count: this.connections.length, corrupted: this.corrupted }
  }

  list(workspaceId?: string): SocialConnection[] {
    return this.connections.filter((c) => !workspaceId || c.workspaceId === workspaceId)
  }

  get(id: string): SocialConnection | null {
    return this.connections.find((c) => c.id === id) || null
  }

  // Upsert by (workspace, platform, platformUserId): reconnecting the same account updates
  // it in place rather than creating a duplicate connection.
  async upsert(input: Omit<SocialConnection, 'id' | 'createdAt' | 'updatedAt'>): Promise<SocialConnection> {
    const now = new Date().toISOString()
    const existing = this.connections.find(
      (c) => c.workspaceId === input.workspaceId && c.platform === input.platform && c.platformUserId === input.platformUserId,
    )
    if (existing) {
      Object.assign(existing, input, { updatedAt: now })
      await this.persist()
      return existing
    }
    const created: SocialConnection = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.connections.push(created)
    await this.persist()
    return created
  }

  async patch(id: string, patch: Partial<SocialConnection>): Promise<SocialConnection | null> {
    const c = this.get(id)
    if (!c) return null
    Object.assign(c, patch, { updatedAt: new Date().toISOString() })
    await this.persist()
    return c
  }

  async remove(id: string): Promise<SocialConnection | null> {
    const c = this.get(id)
    if (!c) return null
    this.connections = this.connections.filter((x) => x.id !== id)
    await this.persist()
    return c
  }

  // ---- pending authorizations (in-memory, CSRF) ----

  createPending(p: Omit<PendingAuth, 'createdAt'>): void {
    this.sweepPending()
    this.pending.set(p.state, { ...p, createdAt: Date.now() })
  }

  consumePending(state: string): PendingAuth | null {
    const found = this.pending.get(state)
    if (!found) return null
    this.pending.delete(state)
    if (Date.now() - found.createdAt > PENDING_TTL_MS) return null
    return found
  }

  private sweepPending() {
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const [state, p] of this.pending) if (p.createdAt < cutoff) this.pending.delete(state)
  }
}
