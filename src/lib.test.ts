import { describe, expect, it } from 'vitest'
import {
  benchmarkTier,
  buildAudience,
  comparePostMetric,
  createInsights,
  displayTitle,
  filterPosts,
  getHookLabel,
  growthFunnel,
  median,
  percentileOf,
  platformScoreboard,
  stdev,
  summarize,
  topContentTags,
  zScore,
} from './lib'
import type { Filters, PostRecord } from './types'

const base: PostRecord = {
  postId: 'P1',
  creativeId: 'C1',
  platform: 'Instagram',
  account: 'A',
  model: 'M',
  postUrl: '',
  publishedAt: '2026-06-01 12:00',
  duration: 7,
  contentPillar: '',
  format: 'POV',
  description: '',
  firstFrame: '',
  textOnVideo: '',
  hookType: 'Visual',
  caption: '',
  cta: '',
  hashtags: '',
  location: '',
  outfit: '',
  sourceNotes: '',
  tags: [],
  followersAtPublish: null,
  contentAnalysis: { hook: '', scene: '', action: '', subject: '', pacing: '', ending: '', whyItWorked: '' },
  contentTags: [],
  track: { name: '', energyTier: '', loudnessMeanDb: null, loudnessMaxDb: null, beat: '', bass: '', vocal: '', mood: '', source: '' },
  extraMetrics: {},
  recordType: 'LIVE',
  views: 100,
  reach: 80,
  totalPlayTime: null,
  averageWatchTime: 5,
  skipRate: 0.3,
  completionRate: null,
  likes: 10,
  comments: 2,
  reposts: 1,
  shares: 3,
  saves: 4,
  profileVisits: 5,
  follows: 2,
  nativeLikeRate: null,
  nativeCommentRate: null,
  nativeRepostRate: null,
  nativeShareRate: null,
  nativeSaveRate: null,
  followersRate: null,
  nonFollowersRate: null,
  retentionRate: 0.7,
  totalEngagements: 20,
  engagementRateByViews: 0.2,
  likeRate: 0.1,
  commentRate: 0.02,
  shareRate: 0.03,
  saveRate: 0.04,
  followConversion: 0.02,
  engagementsPerThousand: 200,
  followsPerThousand: 20,
  engagementRateByReach: 0.25,
  holdRate: 0.7,
  viewsPerReached: 1.25,
  profileVisitRate: 0.05,
  profileToFollowConversion: 0.4,
  followConversionByReach: 0.025,
}

const filters: Filters = {
  dateFrom: '',
  dateTo: '',
  platform: '',
  account: '',
  model: '',
  format: '',
  hook: '',
  tag: '',
  duration: '',
}

describe('analytics', () => {
  it('calculates a true median', () => {
    expect(median([100, 10, 50, null])).toBe(50)
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('excludes EXAMPLE rows from filtering', () => {
    const example = { ...base, postId: 'EX', recordType: 'EXAMPLE' }
    expect(filterPosts([base, example], filters)).toEqual([base])
  })

  it('filters by generated hook labels instead of raw text-only hooks', () => {
    const catEars = {
      ...base,
      textOnVideo: 'cat ears > turn signals',
      caption: 'is this actually legal, or am i one cop away from a confusing conversation?',
    }
    const gasStation = {
      ...base,
      postId: 'P2',
      textOnVideo: 'too hot for a gas station',
      caption: 'my bike was in the mood to put on a little show',
    }
    expect(getHookLabel(catEars)).toBe('Мини-история — будто пишет живой человек')
    expect(
      filterPosts([catEars, gasStation], {
        ...filters,
        hook: 'Мини-история — будто пишет живой человек',
      }),
    ).toEqual([catEars])
  })

  it('aggregates rates from compatible view denominators', () => {
    const summary = summarize([base, { ...base, postId: 'P2', views: 300, totalEngagements: 30 }])
    expect(summary.views).toBe(400)
    expect(summary.engagementRate).toBe(0.125)
  })

  it('pairs numerator and denominator so null metrics never skew a rate', () => {
    const posts: PostRecord[] = [
      { ...base, postId: 'A', views: 1000, totalEngagements: 100 },
      // views known but engagements missing — must not deflate the rate
      { ...base, postId: 'B', views: 5000, totalEngagements: null },
      // engagements present but views missing — must not inflate the rate
      { ...base, postId: 'C', views: null, totalEngagements: 999 },
    ]
    // Only post A has both sides present: 100 / 1000.
    expect(summarize(posts).engagementRate).toBe(0.1)
  })

  it('computes rank-based percentile, stdev and z-score', () => {
    expect(percentileOf([10, 20, 30, 40], 30)).toBeCloseTo(0.625, 5)
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
    expect(zScore(9, 5, 2)).toBe(2)
    expect(zScore(5, 5, 0)).toBeNull()
  })

  it('compares a reel against its cohort with deviation and rank', () => {
    const cohort: PostRecord[] = [100, 200, 300, 1000].map((views, index) => ({
      ...base,
      postId: `M${index}`,
      views,
    }))
    const comparison = comparePostMetric(1000, cohort, (post) => post.views)
    expect(comparison?.median).toBe(250)
    expect(comparison?.rank).toBe(1)
    expect(comparison?.deviationFromMedian).toBeCloseTo(3, 5)
  })

  it('never emits insights for samples below three', () => {
    expect(createInsights([base, { ...base, postId: 'P2' }])).toEqual([])
  })

  it('emits rule-based insights with linked posts for groups of three', () => {
    const high = [1, 2, 3].map((index) => ({
      ...base,
      postId: `H${index}`,
      format: 'High',
      views: 1000,
    }))
    const low = [1, 2, 3].map((index) => ({
      ...base,
      postId: `L${index}`,
      format: 'Low',
      views: 100,
    }))
    const result = createInsights([...high, ...low])
    expect(result.some((insight) => insight.sampleSize === 3 && insight.reels.length === 3)).toBe(true)
    expect(result.every((insight) => typeof insight.recommendation === 'string' && insight.recommendation.length > 0)).toBe(true)
  })

  it('weights audience by absolute reach, not an equal average of percentages', () => {
    const big: PostRecord = {
      ...base,
      postId: 'BIG',
      reach: 1000,
      extraMetrics: { geo_us_pct: 90, geo_de_pct: 10 },
    }
    const small: PostRecord = {
      ...base,
      postId: 'SMALL',
      reach: 100,
      extraMetrics: { geo_us_pct: 50, geo_de_pct: 50 },
    }
    const country = buildAudience([big, small], []).find((dim) => dim.dimension === 'Страна')
    expect(country).toBeTruthy()
    const us = country!.segments.find((seg) => seg.segment === 'США')
    // Absolute weighting: (0.9*1000 + 0.5*100) / (1000+100) ≈ 0.864 — far above the
    // naive equal average of 70%.
    expect(us!.share).toBeCloseTo(0.8636, 3)
    expect(country!.contributingReels).toBe(2)
  })

  it('maps seed audience rows to RU labels and merges Male/Men onto one bar', () => {
    const post: PostRecord = { ...base, postId: 'SEED', reach: 500 }
    const rows = [
      { postId: 'SEED', platform: 'TikTok' as const, dimension: 'Country', segment: 'United States', percentage: 0.8, recordType: 'LIVE' },
      { postId: 'SEED', platform: 'TikTok' as const, dimension: 'Country', segment: 'Other', percentage: 0.2, recordType: 'LIVE' },
      { postId: 'SEED', platform: 'TikTok' as const, dimension: 'Gender', segment: 'Male', percentage: 0.6, recordType: 'LIVE' },
      { postId: 'SEED', platform: 'TikTok' as const, dimension: 'Gender', segment: 'Men', percentage: 0.3, recordType: 'LIVE' },
    ]
    const dims = buildAudience([post], rows)
    const country = dims.find((dim) => dim.dimension === 'Страна')
    expect(country?.segments.find((seg) => seg.segment === 'США')).toBeTruthy()
    const gender = dims.find((dim) => dim.dimension === 'Пол')
    // Male (0.6) + Men (0.3) collapse onto «Мужчины».
    const men = gender?.segments.find((seg) => seg.segment === 'Мужчины')
    expect(men?.abs).toBeCloseTo(0.9 * 500, 3)
  })

  it('maps a metric value to its benchmark tier', () => {
    expect(benchmarkTier('views', 1500)?.key).toBe('breakout')
    expect(benchmarkTier('views', 900)?.key).toBe('strong')
    expect(benchmarkTier('views', 600)?.key).toBe('norm')
    expect(benchmarkTier('views', 300)?.key).toBe('weak')
    expect(benchmarkTier('views', null)).toBeNull()
  })

  it('builds human titles and never surfaces a raw slug as the headline', () => {
    expect(displayTitle({ ...base, textOnVideo: 'Caught you looking...' })).toBe('Caught you looking...')
    expect(
      displayTitle({ ...base, textOnVideo: '', caption: '', contentPillar: '', hookType: '', postId: 'TT_20260618_bad_idea', creativeId: 'CR_04_bad_idea' }),
    ).toBe('Bad idea')
  })

  it('scores platforms side by side with IG-relative ratios', () => {
    const tt = { ...base, postId: 'TT', platform: 'TikTok' as const, reach: 1000, shares: 2, follows: 10 }
    const ig = { ...base, postId: 'IG', platform: 'Instagram' as const, reach: 2000, shares: 12, follows: 10 }
    const sb = platformScoreboard([tt, ig])
    expect(sb.hasBoth).toBe(true)
    expect(sb.tiktok.reels).toBe(1)
    expect(sb.reachRatio).toBeCloseTo(2, 5) // IG 2000 / TT 1000
    expect(sb.sharesRatio).toBeCloseTo(6, 5) // IG 12 / TT 2
    expect(sb.followsRatio).toBeCloseTo(1, 5)
  })

  it('builds the funnel only over reels that carry profile-visit data', () => {
    const withPV = { ...base, postId: 'A', reach: 1000, profileVisits: 100, follows: 10 }
    const noPV = { ...base, postId: 'B', reach: 5000, profileVisits: null, follows: 50 }
    const funnel = growthFunnel([withPV, noPV])
    expect(funnel).toBeTruthy()
    expect(funnel!.cohortReels).toBe(1) // noPV excluded from the funnel cohort
    expect(funnel!.reach).toBe(1000) // and from the aggregate reach
    const profile = funnel!.steps.find((step) => step.key === 'profile')
    expect(profile!.value).toBe(100)
    expect(profile!.ofReach).toBeCloseTo(0.1, 5)
    const follows = funnel!.steps.find((step) => step.key === 'follows')
    expect(follows!.ofPrev).toBeCloseTo(0.1, 5) // 10 follows ÷ 100 profile visits
  })

  it('ranks content tags by median views with lift vs overall', () => {
    const posts: PostRecord[] = [
      { ...base, postId: 'a', contentTags: ['райдинг'], views: 100 },
      { ...base, postId: 'b', contentTags: ['райдинг'], views: 300 },
      { ...base, postId: 'c', contentTags: ['thirst'], views: 100 },
      { ...base, postId: 'd', contentTags: ['thirst'], views: 100 },
    ]
    const ranked = topContentTags(posts)
    expect(ranked[0].tag).toBe('райдинг')
    expect(ranked[0].median).toBe(200)
    expect(ranked[0].lift).toBeCloseTo(1, 5) // 200 vs overall median 100
    expect(ranked.find((entry) => entry.tag === 'thirst')!.reels).toBe(2)
  })

  it('emits early but explicit insights for a four-post creative sample', () => {
    const current = [
      {
        ...base,
        postId: 'TT_001',
        creativeId: 'C1',
        platform: 'TikTok' as const,
        views: 249,
        averageWatchTime: 6,
        duration: 12.07,
        retentionRate: 6 / 12.07,
        follows: 0,
        shares: 0,
        saves: 0,
        textOnVideo: 'cat ears > turn signals',
      },
      {
        ...base,
        postId: 'IG_001',
        creativeId: 'C1',
        platform: 'Instagram' as const,
        views: 207,
        averageWatchTime: 5,
        duration: 12.07,
        retentionRate: 5 / 12.07,
        follows: 0,
        shares: 0,
        saves: 1,
        textOnVideo: 'cat ears > turn signals',
      },
      {
        ...base,
        postId: 'TT_002',
        creativeId: 'C2',
        platform: 'TikTok' as const,
        views: 828,
        averageWatchTime: 10.4,
        duration: 10.98,
        retentionRate: 10.4 / 10.98,
        follows: 16,
        shares: 1,
        saves: 6,
        textOnVideo: 'too hot for a gas station',
        caption: 'my bike was in the mood to put on a little show',
      },
      {
        ...base,
        postId: 'IG_002',
        creativeId: 'C2',
        platform: 'Instagram' as const,
        views: 1838,
        averageWatchTime: 7,
        duration: 10.98,
        retentionRate: 7 / 10.98,
        follows: 3,
        shares: 15,
        saves: 7,
        textOnVideo: 'too hot for a gas station',
        caption: 'my bike was in the mood to put on a little show',
      },
    ]
    const result = createInsights(current)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((insight) => insight.sampleSize >= 3)).toBe(true)
    expect(result.some((insight) => insight.id === 'hook-median-views')).toBe(true)
  })
})
