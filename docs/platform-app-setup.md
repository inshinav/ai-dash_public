# Platform app setup — owner actions

> Step‑by‑step to create the Meta and TikTok developer apps and wire AI Dash's OAuth.
> **The owner performs these** (they require login to Meta/TikTok consoles, identity/business
> verification, and production secrets). Claude never has these credentials. Checked
> 2026‑06‑27 — consoles change; re‑verify field names against the live dashboards.
>
> **Never commit secrets.** Put them in `/etc/ai-dash.env` (chmod 600) only. The repo's
> `.gitignore` + the `block-secrets` hook already block `.env`/`token=` patterns.

## Redirect URIs (register both)

| Platform | Production redirect URI | Local testing |
|---|---|---|
| Instagram | `https://inshinlab.com/ai-dash/api/connect/instagram/callback` | `http://localhost:4310/ai-dash/api/connect/instagram/callback` |
| TikTok | `https://inshinlab.com/ai-dash/api/connect/tiktok/callback` | `http://localhost:4310/ai-dash/api/connect/tiktok/callback` |

(These paths are the connector callbacks to be added in Milestone 4; the auth‑URL builders
in `server/saas/connectors/` already point at them via env.)

## A. Meta app — Instagram API with Instagram Login

1. https://developers.facebook.com → **Create App** → use case **"Other" → Business**.
2. Add product **Instagram** → **API setup with Instagram login**.
3. Note the **Instagram app ID** and **Instagram app secret** (App settings) → `IG_APP_ID`, `IG_APP_SECRET`.
4. **Business login settings** → add the redirect URIs above. Set **Deauthorize callback URL** and **Data deletion request URL** (both required for App Review):
   - Deauthorize: `https://inshinlab.com/ai-dash/api/connect/instagram/deauthorize`
   - Data deletion: `https://inshinlab.com/ai-dash/api/connect/instagram/data-deletion`
5. **Permissions:** request `instagram_business_basic` and `instagram_business_manage_insights`.
6. **Test users:** add your own IG **Business/Creator** account as a tester (Personal accounts return no insights — convert first). Standard Access works for testers immediately.
7. **Privacy policy URL** + **Terms URL** (public pages) — required to submit.
8. **App Review + Business Verification** for **Advanced Access** to onboard *other* creators. For owner‑only / first testing, Standard Access is enough.
9. Token model: OAuth → short‑lived (1 h) → exchange for long‑lived (60 days) → refresh (token must be ≥24 h old, <60 days, user active).

**App Review submission needs:** a screencast of the OAuth flow, the deauthorize + data‑deletion callbacks responding, a privacy policy describing what insights you read and how a user deletes their data.

## B. TikTok app — Login Kit + Display API

1. https://developers.tiktok.com → **Manage apps** → **Create app**.
2. Add products **Login Kit** and **Display API**.
3. Note **Client key** and **Client secret** → `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
4. **Redirect URI:** add the URIs above (must match exactly). **PKCE is required** (`code_challenge`, `S256`) — the connector already sends it.
5. **Scopes:** `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
6. **Sandbox:** add your TikTok account as a sandbox/target user to test before approval.
7. **Production review** for Display API to go live for real users. Provide app description, demo video of the login + data use, and a privacy policy.
8. Token model: access token ~24 h, refresh token ~365 days; refresh at `/v2/oauth/token/`, revoke at `/v2/oauth/revoke/`.

### B′. (Optional, later) TikTok Business Account API — depth metrics

To unlock avg watch time / completion / retention / traffic / demographics for **Business**
accounts: apply for **TikTok API for Business** → Accounts/Organic API, request the
`user.insights` + `video.insights` scopes, and pass a separate review. Only Business accounts
can grant these. Build `TikTokBusinessConnector` against a captured `video.insights` payload.

## C. Environment variables (add to `/etc/ai-dash.env`)

Add these alongside the existing `ADMIN_TOKEN` / `STORAGE_DIR`. **Owner pastes them** (the
repo tooling blocks editing `.env*`):

```
# Instagram (Instagram API with Instagram Login)
IG_APP_ID=...
IG_APP_SECRET=...
IG_REDIRECT_URI=https://inshinlab.com/ai-dash/api/connect/instagram/callback

# TikTok (Login Kit + Display API)
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://inshinlab.com/ai-dash/api/connect/tiktok/callback

# Encryption key for OAuth tokens at rest (32+ random bytes, base64)
CONNECTOR_TOKEN_ENC_KEY=...

# Optional: vision model for screenshot auto-extraction (else manual entry still works)
OPENAI_API_KEY=...        # or ANTHROPIC_API_KEY=...
```

## D. Local testing without production

- The connectors run fully against **fixtures** with no credentials (`server/saas/connectors/mockFetcher.ts`) — contract tests cover auth‑URL, exchange, pagination, mapping, refresh, revoke.
- For a live spike, set the local redirect URIs above, add yourself as tester/sandbox user, and exercise the (Milestone‑4) `/api/connect/*` routes.

## E. nginx (add callback locations without touching other subprojects)

The callbacks live under `/ai-dash/api/...` which the existing `location /ai-dash/` already
proxies — **no nginx change needed** for OAuth callbacks. Only add a location if you later
expose platform **webhooks** on a distinct path.

## Owner action checklist

- [ ] Create Meta app, Instagram product, set redirect + deauthorize + data‑deletion URLs.
- [ ] Publish privacy policy + terms pages.
- [ ] Add IG Business/Creator test account; request the two `instagram_business_*` scopes.
- [ ] Create TikTok app, Login Kit + Display API, redirect URI, sandbox user.
- [ ] (Later) Apply for TikTok Business API `*.insights` scopes for Business accounts.
- [ ] Generate `CONNECTOR_TOKEN_ENC_KEY`; paste all secrets into `/etc/ai-dash.env`.
- [ ] Submit both apps for review when onboarding users beyond yourself.
