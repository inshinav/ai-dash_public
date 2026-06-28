import type { MediaItem, PostRecord } from './types.js'

// Fold every data source through one Map keyed by postId so a reel that exists in
// more than one source appears exactly once. Precedence (highest wins): owner
// entries > manual-intake seed. This prevents double-counting in every aggregate
// (totals, means, medians, engagement rate).
export function mergePostsByPostId(
  manual: PostRecord[],
  entries: PostRecord[],
): PostRecord[] {
  const byId = new Map<string, PostRecord>()
  for (const post of manual) if (post.postId) byId.set(post.postId, post)
  for (const post of entries) if (post.postId) byId.set(post.postId, post)
  return [...byId.values()]
}

// Dedup media by id (and, defensively, by the resolved video path) keeping the
// first occurrence, since callers concatenate sources in precedence order.
export function dedupMedia(items: MediaItem[]): MediaItem[] {
  const seenId = new Set<string>()
  const seenFile = new Set<string>()
  const out: MediaItem[] = []
  for (const item of items) {
    const fileKey = `${item.bindingId}\0${item.fileName}`
    if (seenId.has(item.id) || seenFile.has(fileKey)) continue
    seenId.add(item.id)
    seenFile.add(fileKey)
    out.push(item)
  }
  return out
}
