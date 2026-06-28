// Screen guides for the mobile completion wizard. Kept as data (not JSX) so platform UI
// changes are a one-line edit, each carrying a version + lastVerified date. Use OWN
// annotated examples in marketing — never republish a platform's copyrighted screenshots.

import type { ScreenType, SocialPlatform } from './metrics.js'

export interface ScreenGuide {
  screen: ScreenType
  platform: SocialPlatform
  app: string
  title: string
  steps: string[]
  // A short concrete example of the readings on this screen (own/мок example — we never
  // republish the platform's copyrighted screenshots).
  example?: string
  expectedMetrics: string[]
  version: string
  lastVerified: string
}

export const SCREEN_GUIDES: Record<Exclude<ScreenType, 'none'>, ScreenGuide> = {
  ig_reel_insights: {
    screen: 'ig_reel_insights',
    platform: 'instagram',
    app: 'Instagram',
    title: 'Статистика Reel',
    steps: [
      'Откройте нужный Reel в Instagram.',
      'Нажмите «Посмотреть статистику» под роликом.',
      'Сделайте скриншоты экранов с охватом, временем просмотра и взаимодействиями.',
    ],
    expectedMetrics: ['profile_visits', 'follows', 'traffic_sources', 'hold_rate', 'skip_rate'],
    version: 'v1',
    lastVerified: '2026-06-27',
  },
  ig_account_insights: {
    screen: 'ig_account_insights',
    platform: 'instagram',
    app: 'Instagram',
    title: 'Статистика аккаунта',
    steps: ['Профиль → «Профессиональная панель» → «Статистика».', 'Скриншот сводки за период.'],
    expectedMetrics: ['follower_count', 'account_reach'],
    version: 'v1',
    lastVerified: '2026-06-27',
  },
  ig_audience: {
    screen: 'ig_audience',
    platform: 'instagram',
    app: 'Instagram',
    title: 'Аудитория',
    steps: ['Статистика аккаунта → «Аудитория».', 'Скриншоты пола/возраста, городов и активного времени.'],
    expectedMetrics: ['follower_gender', 'follower_age', 'follower_geo', 'follower_active_times'],
    version: 'v1',
    lastVerified: '2026-06-27',
  },
  tt_post_overview: {
    screen: 'tt_post_overview',
    platform: 'tiktok',
    app: 'TikTok',
    title: 'Аналитика ролика · вкладка Overview',
    steps: [
      'Откройте свой ролик в TikTok.',
      'Нажмите «Поделиться» (стрелка справа) → в нижнем ряду шторки выберите «Analytics» (Аналитика). Либо откройте «TikTok Studio».',
      'Вкладка «Overview»: снимите блок «Key metrics» — Video views, Total play time, Average watch time, Watched full video, New followers (и счётчики лайков/комментов/репостов/сохранений вверху).',
      'Прокрутите ниже на этой же вкладке и снимите «Retention rate» (кривая удержания) и «Traffic sources» (For You / Personal profile / …).',
    ],
    example: 'Напр.: Video views 1.5K · Average watch time 7.0s · Watched full video 46.13% · New followers 43 · For You 95.1%.',
    expectedMetrics: ['average_watch_time', 'total_play_time', 'completion_rate', 'saves', 'follows', 'hold_rate', 'skip_rate', 'traffic_sources'],
    version: 'v2',
    lastVerified: '2026-06-27',
  },
  tt_post_viewers: {
    screen: 'tt_post_viewers',
    platform: 'tiktok',
    app: 'TikTok',
    title: 'Аналитика ролика · вкладка Viewers',
    steps: [
      'В аналитике ролика откройте вкладку «Viewers» (Зрители).',
      'Снимите «Total viewers», «Viewer types» (новые/вернувшиеся и подписчики/не подписаны) и «Gender».',
      'Прокрутите ниже и снимите «Age» и «Top locations» (география), если есть.',
    ],
    example: 'Напр.: Total viewers 1.4K · New 92% / Returning 8% · Non-followers 98% / Followers 2% · Male 84% / Female 16%.',
    expectedMetrics: ['reach', 'viewer_type', 'follower_status', 'viewer_gender', 'viewer_age', 'viewer_geo'],
    version: 'v2',
    lastVerified: '2026-06-27',
  },
  tt_account_overview: {
    screen: 'tt_account_overview',
    platform: 'tiktok',
    app: 'TikTok',
    title: 'Аналитика аккаунта',
    steps: ['Профиль → «Инструменты для авторов» → «Аналитика» → «Обзор».', 'Скриншот сводки за период.'],
    expectedMetrics: ['follower_count', 'account_reach'],
    version: 'v1',
    lastVerified: '2026-06-27',
  },
  tt_account_followers: {
    screen: 'tt_account_followers',
    platform: 'tiktok',
    app: 'TikTok',
    title: 'Аналитика аккаунта — подписчики',
    steps: ['Аналитика аккаунта → вкладка «Подписчики».', 'Скриншоты пола/возраста, регионов и активного времени.'],
    expectedMetrics: ['follower_gender', 'follower_age', 'follower_geo', 'follower_active_times'],
    version: 'v1',
    lastVerified: '2026-06-27',
  },
}

export function guideFor(screen: ScreenType): ScreenGuide | null {
  return screen === 'none' ? null : SCREEN_GUIDES[screen] || null
}
