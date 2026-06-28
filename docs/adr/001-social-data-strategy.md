# ADR‑001 — Social data strategy

- **Status:** Accepted · 2026‑06‑27
- **Context owner:** AI Dash (single‑owner today → multi‑tenant SaaS)
- **Evidence:** [`../social-api-feasibility.md`](../social-api-feasibility.md) (verified 2026‑06‑27)

## Context

AI Dash must ingest Instagram Reels and TikTok analytics for *connected* creators, as
automatically as the platforms legally allow, and fall back to screenshots for the rest —
without ever collecting passwords/cookies/sessions. Four options were evaluated against the
verified feasibility research.

## Options

1. **Direct Instagram + direct TikTok.** Official OAuth on each platform.
2. **Unified provider only** (Phyllo / InsightIQ, or Ayrshare).
3. **Hybrid** — direct where rich, provider where it helps, screenshots for the gap.
4. **Manual‑only** (today's state).

## Decision

**Direct‑first hybrid, provider rejected:**

- **Instagram → direct** *Instagram API with Instagram Login* (Business/Creator). Richest official surface; no Facebook Page required.
- **TikTok → direct** Login Kit + Display API for counts; **TikTok Business Account API** (`user.insights`/`video.insights`) to unlock depth metrics **when the connected account is a Business account**.
- **Screenshot‑assisted completion** for every metric no accessible API returns (TikTok depth on Creator/Personal accounts; IG per‑Reel demographics, traffic, hold/skip, completion).
- **Manual entry** stays as the universal fallback.
- **No unified provider as a core integration.**

## Why not a provider

1. **No coverage gain.** Every compliant provider is a thin normalization layer over the *same* official APIs (Instagram Graph, TikTok consented surface). The per‑metric ceiling is identical to going direct — a provider cannot surface what the platform doesn't expose.
2. **Resale prohibited.** Phyllo/InsightIQ **ToS §7.1** forbids the client from "resell, distribute, or sublicense" the Offering or using it "for the benefit of any Person" — i.e. exactly a third‑party analytics SaaS. (Verified by fetching the live ToS, 2026‑06‑27.)
3. **Lock‑in + cost + opacity** (per‑connected‑account pricing, minimum commitments, data‑residency) without a compensating benefit.
4. **Platform‑risk passthrough.** A provider doesn't insulate us from Meta/TikTok API changes; it adds a second vendor whose changes can also break us.

A provider is reconsidered *only* if InsightIQ (or a competitor) gives **written** confirmation of a resale carve‑out for an analytics SaaS **and** demonstrably surfaces metrics we cannot get directly.

## Consequences

- **Pros:** maximal official coverage, no resale‑ToS risk, no extra vendor lock‑in, lowest marginal cost per connected account, full control of the mapping layer.
- **Cons:** we own two OAuth integrations + App Review on both platforms; TikTok depth requires the creator to have/switch to a Business account; the screenshot subsystem is load‑bearing, not optional.
- **What stays manual/screenshot (by design):** TikTok avg‑watch/completion/retention/traffic/demographics on non‑Business accounts; IG per‑Reel demographics, traffic sources, hold/skip, completion.

## Implementation status

- Connector abstraction + Instagram/TikTok **mock** connectors (official‑shaped fixtures) + contract tests: **built** (`server/saas/connectors/`).
- Live OAuth: code + auth‑URL builders ready; flips to live once the owner creates the platform apps (see [`../platform-app-setup.md`](../platform-app-setup.md)). **Not yet exercised against live credentials.**
- `TikTokBusinessConnector` (depth metrics): **designed, not built** — pending a live `video.insights` payload to harden the mapper.
- Screenshot‑assisted completion subsystem: **built** (`server/saas/`, mobile wizard).

## Revisit triggers

- Meta or TikTok materially changes available fields or review requirements.
- TikTok makes depth metrics available to Creator/Personal accounts via API.
- A provider offers a written resale carve‑out **and** unique coverage.
