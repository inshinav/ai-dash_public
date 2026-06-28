# AI Dash — Cockpit Redesign ("Mission Control")

Full design + UX overhaul of the dashboard. Goal: a **decisions-first growth cockpit**
that answers "что снять дальше, чтобы поднять VTR/ER и охваты" on the first screen, and
looks studio-grade ("not like everyone"). Branch: `feature/cockpit-redesign`.

## Analytics — UNCHANGED (presentation only)
The math in `src/lib.ts` and `server/derive.ts` is untouched and must stay so: ER & all
%-reactions from **reach**; VTR = avg watch ÷ duration; platform-dependent benchmark
tiers; hook archetypes; reel funnel reach→profile→follows; audience weighted by absolute
reach. New helpers are **pure, honest aggregations** with tests.

## Design system
- **Identity:** near-black canvas (`--bg #06080c`) + faint blueprint grid + one gold glow.
- **Accent = GOLD** (`--accent #ffc24b`) = "the move / breakout / recommendation". This
  separates the brand accent from "positive" (was lime = both, now distinct).
- **Semantics (each colour encodes meaning, Tufte-honest):** emerald = positive/strong,
  coral = negative/weak, slate = norm (colourless), cyan = TikTok, violet = Instagram.
- **Benchmark tiers remapped:** weak→coral, norm→slate, strong→emerald, breakout→gold
  (emoji glyphs removed; coloured dot via CSS).
- **Type:** `Inter Variable` (display + body) + `JetBrains Mono Variable` (the telemetry
  layer — eyebrows, IDs, units, deltas, axis). Both bundled via `@fontsource-variable/*`
  with **Cyrillic subsets** (no CDN). Imported in `src/main.tsx`.
- **Dark default + light AA theme** (toggle in topbar; tokens in `:root` and
  `html[data-theme='light']`).

## IA — decisions-first
Nav: **Кокпит · Ролики · Креативы · Сравнение · Аудитория · Плейбук · Модели · Источник**
(Обзор→Кокпит, Инсайты→Плейбук).

**Кокпит (`Overview`)** top→bottom:
1. **`NextMove`** — the single strongest actionable signal (top `createInsights` score)
   as a directive + evidence reels. Answer-first hero (gold).
2. **`KpiTile` cockpit** — Показы / Подписки(accent) / ER / VTR, calm big numbers + tier.
3. **metric strip** — Репосты+сейвы / В подписку / Досмотр / IG hold.
4. **`PlatformScoreboardPanel`** — IG↔TikTok A/B with platform-coloured winners + the
   "×N охвата · ×N репостов → Explore" takeaway (`platformScoreboard` in lib).
5. **`GrowthFunnelPanel`** — reach→profile→follows over the profile-visit cohort +
   returns (shares+saves) note (`growthFunnel`, honest sample label).
6. **`Playbook`** — Повторять / Избегать, from positive/negative insights.
7. trend chart + Топ роликов; then `ContentLeaderboard` (`topContentTags`) + Аномалии.

**Reel page:** `ReelHookBanner` (hook archetype + the "что изменить дальше" directive)
leads, above the video. Funnel, traffic/demographics, content, cohort position below.

**Creatives:** cross-platform A/B cards (TT cyan / IG violet winners, gold ПРОРЫВ flag).

## New code
- `src/lib.ts`: `platformScoreboard`, `growthFunnel`, `topContentTags` (+ types) + 3 tests.
- `src/App.tsx`: `NextMove`, `KpiTile`, `PlatformScoreboardPanel`, `GrowthFunnelPanel`,
  `Playbook`, `ContentLeaderboard`, `ReelHookBanner`; rewrote `Overview`; removed
  `HeroKpi`/`InsightBanner`/`PlatformSplit`.
- `src/OverviewCharts.tsx`: timeline-only (platform bar chart dropped — scoreboard owns it).
- `src/styles.css`: new token system + cockpit component styles; dead CSS removed.
- `vite.config.ts` + `package.json`: `dev:preview` proxies API to prod for HMR previews.

## Verify
`npm run check` green (lint + 20 vitest + build). Preview: `npm run dev:preview`
(port via launch config), proxies to https://inshinlab.com for real data.

## Deploy
Owner only (Claude has no SSH). Push `feature/cockpit-redesign` → review → merge to main →
`curl -fsSL https://raw.githubusercontent.com/inshinav/ai-dash/main/deploy.sh | bash`.
