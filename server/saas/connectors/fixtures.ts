// Fixture payloads that mirror the SHAPE of the official API responses, so the canonical
// mappers and contract tests run with zero credentials. Shapes follow:
//   Instagram API with Instagram Login — GET /me/media, GET /{media-id}/insights
//   TikTok Display API — POST /v2/video/query/, GET /v2/user/info/
// Values are invented; field names and nesting are the documented ones. When real
// payloads are captured during the live spike, drop them in here to harden the mappers.

// ---- Instagram ----

export const igUserFixture = {
  id: '17841400000000000',
  username: 'saya.moon',
  name: 'Saya Moon',
  account_type: 'CREATOR',
  profile_picture_url: 'https://example.test/avatar.jpg',
  followers_count: 4820,
}

export const igMediaPageFixture = {
  data: [
    {
      id: '17900000000000001',
      caption: 'too hot for a gas station 🔥 #moto',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      permalink: 'https://www.instagram.com/reel/AAAA1/',
      timestamp: '2026-06-18T14:02:00+0000',
      thumbnail_url: 'https://example.test/t1.jpg',
    },
    {
      id: '17900000000000002',
      caption: 'cat ears as turn signals',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      permalink: 'https://www.instagram.com/reel/AAAA2/',
      timestamp: '2026-06-20T09:30:00+0000',
      thumbnail_url: 'https://example.test/t2.jpg',
    },
  ],
  paging: {
    cursors: { before: 'BEFORE_CURSOR', after: 'AFTER_CURSOR_PAGE2' },
    next: 'https://graph.instagram.com/v23.0/me/media?after=AFTER_CURSOR_PAGE2',
  },
}

// Second page: no `paging.next` -> connector returns nextCursor=null (end).
export const igMediaPage2Fixture = {
  data: [
    {
      id: '17900000000000003',
      caption: 'light turns green',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      permalink: 'https://www.instagram.com/reel/AAAA3/',
      timestamp: '2026-06-22T18:05:00+0000',
      thumbnail_url: 'https://example.test/t3.jpg',
    },
  ],
  paging: { cursors: { before: 'BEFORE_CURSOR_2' } },
}

// GET /{media-id}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time
// Times are reported in milliseconds.
export const igReelInsightsFixture: Record<string, unknown> = {
  '17900000000000001': {
    data: [
      { name: 'views', period: 'lifetime', values: [{ value: 18540 }], title: 'Views' },
      { name: 'reach', period: 'lifetime', values: [{ value: 12110 }], title: 'Reach' },
      { name: 'likes', period: 'lifetime', values: [{ value: 702 }], title: 'Likes' },
      { name: 'comments', period: 'lifetime', values: [{ value: 41 }], title: 'Comments' },
      { name: 'shares', period: 'lifetime', values: [{ value: 88 }], title: 'Shares' },
      { name: 'saved', period: 'lifetime', values: [{ value: 130 }], title: 'Saves' },
      { name: 'total_interactions', period: 'lifetime', values: [{ value: 961 }], title: 'Interactions' },
      { name: 'ig_reels_avg_watch_time', period: 'lifetime', values: [{ value: 6800 }], title: 'Average watch time' },
      { name: 'ig_reels_video_view_total_time', period: 'lifetime', values: [{ value: 126000000 }], title: 'Total watch time' },
    ],
  },
  '17900000000000002': {
    data: [
      { name: 'views', period: 'lifetime', values: [{ value: 9650 }], title: 'Views' },
      { name: 'reach', period: 'lifetime', values: [{ value: 7330 }], title: 'Reach' },
      { name: 'likes', period: 'lifetime', values: [{ value: 410 }], title: 'Likes' },
      { name: 'comments', period: 'lifetime', values: [{ value: 22 }], title: 'Comments' },
      { name: 'shares', period: 'lifetime', values: [{ value: 51 }], title: 'Shares' },
      { name: 'saved', period: 'lifetime', values: [{ value: 73 }], title: 'Saves' },
      { name: 'total_interactions', period: 'lifetime', values: [{ value: 556 }], title: 'Interactions' },
      { name: 'ig_reels_avg_watch_time', period: 'lifetime', values: [{ value: 5200 }], title: 'Average watch time' },
      { name: 'ig_reels_video_view_total_time', period: 'lifetime', values: [{ value: 50180000 }], title: 'Total watch time' },
    ],
  },
}

// GET /me/insights?metric=follower_demographics ... (lifetime, breakdown).
export const igAudienceFixture = {
  data: [
    {
      name: 'follower_demographics',
      period: 'lifetime',
      total_value: {
        breakdowns: [
          {
            dimension_keys: ['gender'],
            results: [
              { dimension_values: ['M'], value: 2890 },
              { dimension_values: ['F'], value: 1850 },
              { dimension_values: ['U'], value: 80 },
            ],
          },
        ],
      },
      title: 'Follower demographics',
    },
  ],
}

// ---- TikTok ----

export const ttUserFixture = {
  data: {
    user: {
      open_id: 'tt-open-id-001',
      union_id: 'tt-union-001',
      avatar_url: 'https://example.test/tt-avatar.jpg',
      display_name: 'saya.moon',
      follower_count: 5130,
      following_count: 42,
      likes_count: 91200,
      video_count: 27,
    },
  },
  error: { code: 'ok', message: '', log_id: 'log-1' },
}

// POST /v2/video/query/ (or /v2/video/list/) with fields=
//   id,title,video_description,duration,cover_image_url,share_url,embed_link,
//   view_count,like_count,comment_count,share_count,create_time
// Note: NO average watch time / completion / reach / saves / demographics — those simply
// are not in the Display API response (they are screenshot-assisted in AI Dash).
export const ttVideoPageFixture = {
  data: {
    videos: [
      {
        id: '7400000000000000001',
        title: 'too hot for a gas station',
        video_description: 'too hot for a gas station 🔥',
        duration: 12,
        cover_image_url: 'https://example.test/tt1.jpg',
        share_url: 'https://www.tiktok.com/@saya.moon/video/7400000000000000001',
        embed_link: 'https://www.tiktok.com/embed/7400000000000000001',
        view_count: 41200,
        like_count: 5130,
        comment_count: 96,
        share_count: 410,
        create_time: 1750255320,
      },
      {
        id: '7400000000000000002',
        title: 'cat ears as turn signals',
        video_description: 'cat ears as turn signals',
        duration: 9,
        cover_image_url: 'https://example.test/tt2.jpg',
        share_url: 'https://www.tiktok.com/@saya.moon/video/7400000000000000002',
        embed_link: 'https://www.tiktok.com/embed/7400000000000000002',
        view_count: 18800,
        like_count: 2210,
        comment_count: 34,
        share_count: 150,
        create_time: 1750412200,
      },
    ],
    cursor: 1750412200,
    has_more: true,
  },
  error: { code: 'ok', message: '', log_id: 'log-2' },
}

export const ttVideoPage2Fixture = {
  data: {
    videos: [
      {
        id: '7400000000000000003',
        title: 'light turns green',
        video_description: 'light turns green',
        duration: 8,
        cover_image_url: 'https://example.test/tt3.jpg',
        share_url: 'https://www.tiktok.com/@saya.moon/video/7400000000000000003',
        embed_link: 'https://www.tiktok.com/embed/7400000000000000003',
        view_count: 9300,
        like_count: 880,
        comment_count: 12,
        share_count: 60,
        create_time: 1750600000,
      },
    ],
    cursor: 1750600000,
    has_more: false,
  },
  error: { code: 'ok', message: '', log_id: 'log-3' },
}
