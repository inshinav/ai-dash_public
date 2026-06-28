// Sync engine. Increment 1: account-level automation — pull follower count + audience
// demographics from the connected platform and append them as API-sourced metric
// snapshots (provenance preserved, time series for velocity). Content-level sync
// (per-reel metrics + discovery) is the next increment; it pairs with a content store.

import type { CanonicalMetricValue, ConnectorContentItem, SocialConnector } from '../connectors/types.js'
import type { SnapshotInput } from '../snapshots.js'
import type { SnapshotStore } from '../store.js'
import type { PostRecord } from '../../types.js'
import { apiPostId, matchExistingPost, type ContentStore } from './contentStore.js'
import type { SocialConnection, SyncRunSummary } from './connections.js'

// Refresh a token a day before it expires (don't wait for a failed call).
export function tokenNeedsRefresh(expiresAt: string | null, nowMs: number, marginMs = 24 * 3600 * 1000): boolean {
  if (!expiresAt) return false
  const exp = Date.parse(expiresAt)
  if (!Number.isFinite(exp)) return false
  return exp - nowMs <= marginMs
}

function toSnapshotInput(value: CanonicalMetricValue, connection: SocialConnection, accountId: string, contentId: string | null): SnapshotInput {
  return {
    workspaceId: connection.workspaceId,
    accountId,
    contentId,
    metricKey: value.metricKey,
    segment: value.segment,
    value: value.value,
    unit: value.unit,
    source: value.source,
    period: value.period,
    observedAt: value.observedAt,
    confidence: value.confidence,
    confirmed: true, // API values are authoritative
    screenshotId: null,
    extractionVersion: null,
    rawPayloadRef: null,
  }
}

// Pull account metrics + audience for a connection and persist them as snapshots.
export async function syncAccount(
  connection: SocialConnection,
  connector: SocialConnector,
  snapshotStore: SnapshotStore,
  now: string = new Date().toISOString(),
): Promise<SyncRunSummary> {
  const accountId = connection.accounts[0]?.platformAccountId || connection.platformUserId
  let imported = 0
  let errors = 0
  let errorSummary: string | null = null
  try {
    const [account, audience] = await Promise.all([
      connector.syncAccountMetrics(accountId),
      connector.syncAudience(accountId),
    ])
    const inputs = [...account, ...audience].map((v) => toSnapshotInput(v, connection, accountId, null))
    const saved = await snapshotStore.append(inputs)
    imported = saved.length
  } catch (error) {
    errors = 1
    errorSummary = error instanceof Error ? error.message : 'sync failed'
  }
  return { startedAt: now, finishedAt: new Date().toISOString(), imported, updated: 0, errors, errorSummary }
}

export interface ContentSyncResult {
  discovered: number // reels returned by the API
  matched: number // matched to an existing manual post (metrics refreshed in place)
  created: number // new reels imported into the content store
  metricsWritten: number // API metric snapshots appended
}

// Discover the account's reels via the API, match each to an existing manual post (so the
// same reel isn't duplicated) or import it, and append per-video API metric snapshots.
export async function syncContent(
  connection: SocialConnection,
  connector: SocialConnector,
  contentStore: ContentStore,
  snapshotStore: SnapshotStore,
  existingPosts: PostRecord[],
  now: string = new Date().toISOString(),
): Promise<ContentSyncResult> {
  const accountId = connection.accounts[0]?.platformAccountId || connection.platformUserId
  const result: ContentSyncResult = { discovered: 0, matched: 0, created: 0, metricsWritten: 0 }
  let cursor: string | undefined
  let guard = 0
  do {
    const page = await connector.syncContent(accountId, cursor)
    for (const item of page.items) {
      result.discovered += 1
      const matchedId = matchExistingPost(item, existingPosts)
      const postId = matchedId || apiPostId(item.platform, item.platformId)
      if (matchedId) {
        result.matched += 1
      } else {
        await contentStore.upsert(item as ConnectorContentItem, postId, connection.workspaceId, now)
        result.created += 1
      }
      const values = await connector.syncContentMetrics(item)
      const saved = await snapshotStore.append(values.map((v) => toSnapshotInput(v, connection, accountId, postId)))
      result.metricsWritten += saved.length
    }
    cursor = page.nextCursor ?? undefined
    guard += 1
  } while (cursor && guard < 25) // safety cap on pages
  return result
}

// Full per-connection sync: account metrics + audience + content discovery/metrics.
export async function syncConnectionFull(
  connection: SocialConnection,
  connector: SocialConnector,
  contentStore: ContentStore,
  snapshotStore: SnapshotStore,
  existingPosts: PostRecord[],
  now: string = new Date().toISOString(),
): Promise<SyncRunSummary> {
  let imported = 0
  let errors = 0
  let errorSummary: string | null = null
  let content: ContentSyncResult | undefined
  try {
    const account = await syncAccount(connection, connector, snapshotStore, now)
    imported += account.imported
    errors += account.errors
    if (account.errorSummary) errorSummary = account.errorSummary
    content = await syncContent(connection, connector, contentStore, snapshotStore, existingPosts, now)
    imported += content.metricsWritten
  } catch (error) {
    errors += 1
    errorSummary = error instanceof Error ? error.message : 'sync failed'
  }
  return { startedAt: now, finishedAt: new Date().toISOString(), imported, updated: content?.matched ?? 0, errors, errorSummary, content }
}
