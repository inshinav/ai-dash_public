# Social API feasibility — field coverage matrix

> Verified against official Meta and TikTok developer docs and the Phyllo/InsightIQ terms,
> checked **2026‑06‑27** (live web research + adversarial verification). Statuses use:
> `available` · `available with conditions` · `derived` · `unsupported` ·
> `unknown — requires live test` · `unknown — requires vendor confirmation`.
>
> The machine‑readable source of truth is the registry in
> [`server/saas/metrics.ts`](../server/saas/metrics.ts); the table in §3 is generated from
> it, so code and doc cannot drift.

## 0. Headline conclusions (the decisions hang on these)

1. **Instagram is the rich side.** *Instagram API with Instagram Login* (Business/Creator) exposes Reel insights — `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions`, `ig_reels_avg_watch_time` (ms), `ig_reels_video_view_total_time` (ms) — plus account insights and **lifetime account‑level** audience demographics. **Confirmed.**
   *Source:* https://developers.facebook.com/blog/post/2025/03/24/user-and-media-insights-on-instagram-api-with-instagram-login/ · https://developers.facebook.com/docs/instagram-platform/insights/
2. **Instagram does NOT expose** per‑Reel retention curve, 3‑second hold/skip, completion rate, traffic sources, or **per‑Reel viewer demographics** — those live only in the in‑app Reel Insights. Demographics are **account‑level lifetime only** (`follower_demographics`, `engaged_audience_demographics`, `reached_audience_demographics`, ~100‑follower minimum). **Confirmed.** → screenshot‑assisted.
   *Source:* https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/
3. **TikTok Login Kit + Display API exposes only basic counts** for a connected creator: per‑video `view_count`, `like_count`, `comment_count`, `share_count`, `duration` + metadata, and account `follower_count`/`likes_count`/`video_count`. It does **NOT** expose average watch time, completion, retention, reach, saves, traffic sources, or viewer demographics. **Confirmed** against the canonical Video Object reference.
   *Source:* https://developers.tiktok.com/doc/tiktok-api-v2-video-object · https://developers.tiktok.com/doc/display-api-overview
4. **There IS an official path to TikTok depth metrics — but conditional.** The **TikTok Business Account API** (the "organic" Accounts API under *TikTok API for Business*, scopes `user.insights` + `video.insights`) returns watch time, completion/retention, traffic sources, and viewer/follower demographics for a creator's **own** content — **only if the connected account is a TikTok Business account**. Our crux claim ("no API product exposes these") was **REFUTED** by this product. It is appropriate for a connected‑creator SaaS but does not cover Creator/Personal accounts.
   *Source:* https://business-api.tiktok.com/portal/docs?id=1771101204092929
5. **A unified provider (Phyllo / InsightIQ) is NOT a clean core path.** (a) Every compliant provider is a thin normalization layer over the same official APIs, so it adds **no metric coverage** over going direct. (b) Phyllo's Terms of Service **§7.1 prohibits** the client from "resell, distribute, or sublicense" the Offering or using it "for the benefit of any Person" — exactly what a third‑party analytics SaaS does. Our crux claim that the terms permit resale was **REFUTED** by fetching the live ToS. → Provider rejected as core; see [`adr/001-social-data-strategy.md`](adr/001-social-data-strategy.md).
   *Source:* https://www.getphyllo.com/terms-of-service · https://docs.insightiq.ai

## 1. Token & app facts (per platform)

| | Instagram API with Instagram Login | TikTok Login Kit + Display API |
|---|---|---|
| Authorize | `https://www.instagram.com/oauth/authorize` (api.instagram.com) | `https://www.tiktok.com/v2/auth/authorize/` |
| Token endpoint | `graph.instagram.com` | `https://open.tiktokapis.com/v2/oauth/token/` |
| PKCE | not required | **required** (`code_challenge`, `S256`) |
| Short‑lived token | 1 hour | access token ~24 h |
| Long‑lived token | 60 days (refresh ≥24 h old, <60 days, active user) | refresh token ~365 days |
| Revoke | user removes app → token void; **deauthorize callback required** | `/v2/oauth/revoke/` |
| Account types | **Business/Creator only** (Personal = no insights; Basic Display sunset Dec 2024) | any, but **insights need a Business account + business scopes** |
| App Review | Advanced Access for `instagram_business_basic` + `instagram_business_manage_insights` + Business Verification + **data‑deletion callback** + privacy policy | Display API production review; Business API + insights scopes separately approved |
| Scopes | `instagram_business_basic`, `instagram_business_manage_insights` (added 2025‑03) | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` (+ `user.insights`,`video.insights` for Business) |
| Webhooks | yes (Instagram object) | limited / none for content metrics |
| 2025 deprecations | `impressions`, `plays`, `video_views` → unified `views` (v22.0, 2025‑04‑21) | — |

## 2. Recommended connector per platform

- **Instagram → direct** *Instagram API with Instagram Login*. (Facebook‑Login Graph path still works but Meta positions Instagram Login as default and it now exposes the same insights — prefer it; no FB Page required.)
- **TikTok → direct** Login Kit + Display API for counts, **upgrade to the TikTok Business Account API** (`*.insights` scopes) when the connected account is a Business account to unlock depth metrics; **screenshot‑assisted** for everything still missing (Creator/Personal accounts, and any account before Business approval).
- **Provider → no** (see headline #5).
- **Manual** entry remains the universal fallback and is never removed.

## 3. Field coverage matrix (generated from `server/saas/metrics.ts`)

`API` = official API for a connected creator · `shot:<screen>` = screenshot‑assisted from that
stat screen · `derived` = computed from other present metrics · `—` = unsupported by that
platform's API (screenshot/manual only or N/A).

| canonical key | level | kind | critical | Instagram (direct API) | TikTok (Display API) |
|---|---|---|---|---|---|
| `views` | content | count | **yes** | API | API |
| `reach` | content | count | **yes** | API | shot:tt_post_overview |
| `duration` | content | duration | no | API¹ | API |
| `average_watch_time` | content | duration | **yes** | API (`ig_reels_avg_watch_time`, ms) | shot:tt_post_overview ² |
| `total_play_time` | content | duration | no | API (`ig_reels_video_view_total_time`, ms) | shot:tt_post_overview ² |
| `completion_rate` | content | rate | **yes** | — | shot:tt_post_overview ² |
| `retention_rate` | content | rate | **yes** | derived (avg watch ÷ duration) | derived |
| `hold_rate` | content | rate | no | shot:ig_reel_insights | shot:tt_post_retention ² |
| `skip_rate` | content | rate | no | shot:ig_reel_insights | shot:tt_post_retention ² |
| `likes` | content | count | no | API | API |
| `comments` | content | count | no | API | API |
| `shares` | content | count | no | API | API |
| `saves` | content | count | no | API (`saved`) | shot:tt_post_overview ² |
| `total_engagements` | content | count | no | derived (or `total_interactions`) | derived |
| `profile_visits` | content | count | **yes** | shot:ig_reel_insights | shot:tt_post_viewers ² |
| `follows` | content | count | **yes** | shot:ig_reel_insights | shot:tt_post_viewers ² |
| `traffic_sources` | content | distribution | **yes** | shot:ig_reel_insights | shot:tt_post_viewers ² |
| `viewer_type` (new/returning) | content | distribution | no | shot:ig_reel_insights | shot:tt_post_viewers ² |
| `follower_status` (followers/non) | content | distribution | no | shot:ig_reel_insights | shot:tt_post_viewers ² |
| `viewer_gender` | content | distribution | no | shot:ig_audience³ | shot:tt_post_viewers ² |
| `viewer_age` | content | distribution | no | shot:ig_audience³ | shot:tt_post_viewers ² |
| `viewer_geo` | content | distribution | no | shot:ig_audience³ | shot:tt_post_viewers ² |
| `follower_count` | account | count | no | API | API |
| `account_reach` | account | count | no | API | shot:tt_account_overview ² |
| `follower_gender` | account | distribution | no | API (`follower_demographics`)⁴ | shot:tt_account_followers ² |
| `follower_age` | account | distribution | no | API ⁴ | shot:tt_account_followers ² |
| `follower_geo` | account | distribution | no | API ⁴ | shot:tt_account_followers ² |
| `follower_active_times` | account | distribution | no | shot:ig_audience | shot:tt_account_followers ² |

**Footnotes / conditions**

1. `duration` — **unknown, requires live test**: no documented duration field on the IG media node for the Instagram‑Login path. AI Dash already derives duration from the uploaded file via `ffprobe`, so this is non‑blocking. *(registry marks it API for symmetry; treat as derived‑from‑file in practice.)*
2. **TikTok `available with conditions`** — every `shot:*` TikTok cell becomes **`available` via the TikTok Business Account API** (`user.insights`/`video.insights`) when the connected account is a **Business** account. For Creator/Personal accounts it stays screenshot‑assisted.
3. **IG per‑Reel viewer demographics are NOT available** at the post level via API; `shot:ig_audience` reflects that they can only be captured from a stat screen. Account‑level follower demographics *are* API (footnote 4).
4. **IG account demographics** are **lifetime, account‑level only** (`follower_demographics` + `engaged/reached_audience_demographics`), require ~100 followers, and are not per‑post.

## 4. Semantic rules (carried into the analytics layer)

- **Do not merge** TikTok `completion_rate` (watched‑full) with Instagram `hold_rate` (3‑second) — different definitions (already enforced in `derive.ts` / `lib.ts`).
- **`retention_rate` (VTR)** is `clamp01(average_watch_time ÷ duration)` on both platforms and is the only safe cross‑platform watch metric.
- **Watch‑time units differ:** IG returns milliseconds (`ig_reels_*`) → the connector divides by 1000 to canonical **seconds**.
- **`reach ?? views`** is the rate denominator; `null ≠ 0` is preserved end‑to‑end (snapshots keep `null` as a real "we looked, nothing shown" state).
- **Distributions** map onto the existing whole‑percent `extraMetrics` keys (`traffic_*_pct`, `gender_*_pct`, `age_*_pct`, `geo_*_pct`, …) so the current weighted‑audience and traffic‑source UI keeps working unchanged.
- Demographics that are **account‑level lifetime** (IG) must **not** be attached per‑Reel — the requirement engine models them as a separate account‑level task.

## 5. Open items needing the live spike

- IG: confirm whether any `duration`/`media_url` field is exposed on the Instagram‑Login media node (footnote 1).
- TikTok Business Account API: capture a real `video.insights` payload to harden the (not‑yet‑built) `TikTokBusinessConnector` mapper; confirm exact field names + whether retention is a curve or a scalar.
- Both: confirm real rate‑limit headers and historical depth on a live account (backfill window).
- Provider: if ever reconsidered, obtain written confirmation from InsightIQ that a resale carve‑out exists for an analytics SaaS (current public ToS §7.1 says no).

See [`platform-app-setup.md`](platform-app-setup.md) for the exact app‑creation steps and
[`adr/001-social-data-strategy.md`](adr/001-social-data-strategy.md) for the decision.
