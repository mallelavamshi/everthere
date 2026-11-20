# Deploy checklist (Task 26)

Everything below must be set before the release APK and the production Worker are built and shared. Nothing here
was done by the fix wave. It is the list for Task 26.

## 1. Cloudflare D1 and `wrangler.toml`

- [ ] `wrangler d1 create everthere`. Put the real `database_id` into `apps/api/wrangler.toml`. It still holds the
      `00000000-0000-0000-0000-000000000000` placeholder. Leave `wrangler.test.toml` on the placeholder because tests
      never touch the real database.
- [ ] `wrangler d1 migrations apply everthere --remote`.
- [ ] `wrangler r2 bucket create everthere-media` (binding `MEDIA`), if it isn't created yet.
- [ ] `[vars]` in `apps/api/wrangler.toml`:
  - `PUBLIC_API_BASE`: the deployed `https://everthere-api.<account>.workers.dev` URL. Do not leave it as
    `http://localhost:8787`. Signed photo links are built from it, so a localhost value gives dead images on every
    phone. The Worker logs a `PUBLIC_API_BASE` warning (`console.error`, once per isolate) when it is unset or localhost.
  - `CLERK_AUTHORIZED_PARTIES = "https://localhost"`: the Capacitor WebView origin. Clerk session JWTs carry
    `azp: "https://localhost"` (docs/notes/napster-events.md section 6, item 7).
  - `NAPSTER_FLAG_FUNCTION_ID`: written by `pnpm napster:flag-tool` (section 4).
  - `DEV_ROUTES = "0"`. This must stay 0 in production.
- [ ] Do not restructure `wrangler.toml` into envs. Edit the values in place.

## 2. Worker secrets (`wrangler secret put <NAME>` in `apps/api`)

| Name | What |
| --- | --- |
| `CLERK_SECRET_KEY` | Clerk backend secret key (`sk_live_…` or the instance's key) |
| `NAPSTER_API_KEY` | Napster public API key |
| `NAPSTER_WEBHOOK_SECRET` | Signing secret from the Napster webhook (section 4) |
| `META_API_KEY` | Meta AI key (summaries, avatar portraits) |
| `MEDIA_SIGNING_KEY` | Random 32+ bytes: `openssl rand -hex 32` |
| `ACTING_TOKEN_KEY` | Random 32+ bytes: `openssl rand -hex 32` |
| `ADMIN_TOKEN` | Random 32+ bytes. Guards `/api/admin/*` (seed, credit guard) |

Do not set `SPIKE_AGENT_ID` in production. It is a dev-only value.

## 3. Clerk dashboard

- [ ] User & authentication: turn on **first name and last name** (sign-up collects both) and **email address**.
- [ ] Sign-in and sign-up verification by **email code** (6 digits). The app's code screens use
      `signIn.mfa.sendEmailCode()/verifyEmailCode()` and the sign-up email code.
- [ ] Allowed origins / authorized parties: `https://localhost` (Capacitor WebView).
- [ ] Use `@clerk/react@6`, because Clerk blocks v5. Put the publishable key in `VITE_CLERK_PUBLISHABLE_KEY`.
- [ ] **Decide: bot sign-up protection** (device test C-2). On the emulator's old WebView 124, the WebView renderer
      crashed (SIGTRAP) right after "Create my account", while Clerk loaded its Protect check bundle
      (`@clerk/ui/…/protectcheck_ui_*.js`). Sign-in was not affected. The app now mounts `<div id="clerk-captcha"/>`
      on the sign-up form (what Clerk custom flows need for the bot-protection widget), shows friendly copy for
      `protect_check_*` / `captcha_invalid` errors, and offers "Pick up where I left off" when a sign-up was cut
      short. The dashboard-side option is **Clerk Dashboard → Configure → Attack protection → Bot sign-up
      protection** (and any Protect mid-flow challenges): turning it off removes the check entirely, at the cost of
      bot protection on sign-up. First re-test sign-up on a physical phone with a current Android System WebView; if
      it still crashes there, turning the setting off is the reliable fix. This is the owner's call: nothing was
      changed in the Clerk dashboard.

## 4. Napster

- [ ] `pnpm napster:flag-tool` (needs `NAPSTER_API_KEY` in the repo `.env`). This is idempotent. It creates
      `flag_concern`, or, when it already exists with an older definition, **replaces its definition**
      (`PUT /public/functions/{id}`). That refresh is how the `quote` parameter picks up its new description:
      "the child's exact words, verbatim". Then it writes the id into both wrangler tomls. Commit the toml change.
- [ ] Webhook: in the Napster dashboard, add `https://everthere-api.<account>.workers.dev/api/webhooks/napster`
      with at least the `session.closed` event (other events are recorded and acknowledged). Copy the signing secret
      into `wrangler secret put NAPSTER_WEBHOOK_SECRET`. Check one live delivery: the Worker accepts the secret both
      base64-decoded and as raw text.
- [ ] Agents made before the flag tool was refreshed keep the same function id, so no agent PATCH is needed.

## 5. Release APK (`apps/mobile`)

- [ ] `VITE_API_BASE=https://everthere-api.<account>.workers.dev pnpm --filter mobile build`. A production build
      **fails on purpose** when `VITE_API_BASE` is missing or points at `localhost`, `127.0.0.1` or `10.0.2.2`.
- [ ] `VITE_CLERK_PUBLISHABLE_KEY` is set (repo-root `.env`).
- [ ] Release builds ship without source maps (`sourcemap: mode !== 'production'`), and the manifest has
      `android:allowBackup="false"`.
- [ ] `pnpm --filter mobile cap:sync`, then build and sign the release APK in Android Studio.

## 6. Demo world

- [ ] `pnpm seed`, then `PUT /api/admin/seed` with `X-Admin-Token`. Demo tablet PINs: **Ms. Jess 1234**,
      **Tanya 2468**. These are public demo values, are stored hashed, and are restored by the nightly 08:00 UTC reset.
- [ ] Check `GET /api/admin/credit-guard`: cap 120 USD. Demo accounts may start 200 child sessions a day, and
      everyone else 20.

## 7. Smoke test on a phone

- [ ] "Try the demo" → Parent: photos load (signed URLs on the workers.dev host).
- [ ] On a phone, "Try the demo" → Teacher gives a plain teacher view with no tablet registration. Signing out and in
      as a parent lands on `/parent`.
- [ ] A short comfort call ends with a summary and an alert.
