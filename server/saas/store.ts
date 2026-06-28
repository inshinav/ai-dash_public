// Append-only snapshot store — a JSON sidecar in STORAGE_DIR, additive and fully separate
// from entries.json so the existing owner dataset is never touched. Reuses the same
// atomic/corruption-safe write helpers as the rest of the app. This is the bridge between
// the current single-owner file world and the Postgres metric_snapshots table designed in
// docs/adr/002-saas-architecture.md (same row shape, drop-in migration target).

import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../config.js'
import { readJsonFileSafe, writeJsonFileAtomic } from '../jsonFile.js'
import { makeSnapshot, type MetricSnapshot, type SnapshotInput } from './snapshots.js'

const SCHEMA_VERSION = 1

interface SnapshotFile {
  schemaVersion: number
  snapshots: MetricSnapshot[]
}

export class SnapshotStore {
  private snapshots: MetricSnapshot[] = []
  private corrupted = false
  private readonly filePath = path.join(config.storageDir, 'saas-snapshots.json')
  private writeQueue = Promise.resolve()

  async init() {
    const result = await readJsonFileSafe<SnapshotFile>(this.filePath)
    this.corrupted = result.status === 'corrupt'
    this.snapshots = result.value?.snapshots && Array.isArray(result.value.snapshots) ? result.value.snapshots : []
    if (result.status === 'missing') await this.persist()
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonFileAtomic(this.filePath, { schemaVersion: SCHEMA_VERSION, snapshots: this.snapshots } satisfies SnapshotFile),
    )
    return this.writeQueue
  }

  status() {
    return { count: this.snapshots.length, corrupted: this.corrupted }
  }

  all(): MetricSnapshot[] {
    return this.snapshots
  }

  forContent(contentId: string): MetricSnapshot[] {
    return this.snapshots.filter((s) => s.contentId === contentId)
  }

  forAccount(accountId: string): MetricSnapshot[] {
    return this.snapshots.filter((s) => s.accountId === accountId && s.contentId === null)
  }

  // Append new snapshots (never overwrites). Each gets a server-generated id + collectedAt.
  async append(inputs: SnapshotInput[]): Promise<MetricSnapshot[]> {
    const now = new Date().toISOString()
    const created = inputs.map((input) => makeSnapshot(input, crypto.randomUUID(), now))
    this.snapshots.push(...created)
    await this.persist()
    return created
  }
}
