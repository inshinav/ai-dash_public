import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { readJsonFileSafe, writeJsonFileAtomic } from './jsonFile.js'
import type { ManualNotes, MediaItem, MetadataFile } from './types.js'

const emptyStore = (): MetadataFile => ({ media: [], notes: {} })

export class MetadataStore {
  private data: MetadataFile = emptyStore()
  private corrupted = false
  private readonly filePath = path.join(config.storageDir, 'metadata.json')
  private writeQueue = Promise.resolve()

  async init() {
    await Promise.all([
      fs.mkdir(config.storageDir, { recursive: true }),
      fs.mkdir(path.join(config.storageDir, 'videos'), { recursive: true }),
      fs.mkdir(path.join(config.storageDir, 'thumbnails'), { recursive: true }),
      fs.mkdir(path.join(config.storageDir, 'screenshots'), { recursive: true }),
      fs.mkdir(path.join(config.storageDir, 'tmp'), { recursive: true }),
    ])
    const result = await readJsonFileSafe<MetadataFile>(this.filePath)
    this.corrupted = result.status === 'corrupt'
    if (result.value) {
      this.data = { media: result.value.media || [], notes: result.value.notes || {} }
    } else if (result.status === 'missing') {
      // Only write a fresh store on a genuine first run, never after corruption.
      await this.persist()
    }
  }

  status() {
    return { media: this.data.media.length, corrupted: this.corrupted }
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(() => writeJsonFileAtomic(this.filePath, this.data))
    return this.writeQueue
  }

  listMedia() {
    return [...this.data.media].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getMedia(id: string) {
    return this.data.media.find((item) => item.id === id) || null
  }

  async addMedia(item: MediaItem) {
    this.data.media.push(item)
    await this.persist()
    return item
  }

  async removeMedia(id: string) {
    const item = this.getMedia(id)
    if (!item) return null
    this.data.media = this.data.media.filter((entry) => entry.id !== id)
    await this.persist()
    return item
  }

  listNotes() {
    return { ...this.data.notes }
  }

  async upsertNotes(postId: string, input: Omit<ManualNotes, 'postId' | 'updatedAt'>) {
    const notes: ManualNotes = {
      postId,
      works: input.works || '',
      doesntWork: input.doesntWork || '',
      hypothesis: input.hypothesis || '',
      changeNext: input.changeNext || '',
      updatedAt: new Date().toISOString(),
    }
    this.data.notes[postId] = notes
    await this.persist()
    return notes
  }
}
