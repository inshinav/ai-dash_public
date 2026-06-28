import { describe, expect, it } from 'vitest'
import { dedupMedia, mergePostsByPostId } from './merge'
import type { MediaItem, PostRecord } from './types'

const post = (postId: string, views: number, source: string): PostRecord =>
  ({ postId, views, model: source } as unknown as PostRecord)

const media = (id: string, bindingId: string, fileName: string): MediaItem =>
  ({ id, bindingId, fileName } as unknown as MediaItem)

describe('mergePostsByPostId', () => {
  it('keeps each postId once with precedence entries > manual', () => {
    const manual = [post('A', 1, 'manual'), post('B', 2, 'manual'), post('C', 2, 'manual')]
    const entries = [post('C', 3, 'entry'), post('D', 3, 'entry')]
    const merged = mergePostsByPostId(manual, entries)
    expect(merged).toHaveLength(4)
    const byId = Object.fromEntries(merged.map((p) => [p.postId, p.model]))
    expect(byId).toEqual({ A: 'manual', B: 'manual', C: 'entry', D: 'entry' })
  })

  it('drops rows without a postId', () => {
    expect(mergePostsByPostId([post('', 1, 'm')], [])).toHaveLength(0)
  })
})

describe('dedupMedia', () => {
  it('removes duplicate ids and identical binding/file pairs, keeping the first', () => {
    const items = [
      media('x', 'P1', 'a.mp4'),
      media('x', 'P1', 'a.mp4'),
      media('y', 'P1', 'a.mp4'),
      media('z', 'P2', 'b.mp4'),
    ]
    const out = dedupMedia(items)
    expect(out.map((m) => m.id)).toEqual(['x', 'z'])
  })
})
