# EverThere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One polished Android app (Capacitor) in which a parent's live Napster avatar comforts their child at daycare or at home, with parent-approved guardrails, session summaries, flags and alerts. It must be ready for judges to install by Nov 30, 2026.

**Architecture:** This is a pnpm monorepo:
- `apps/mobile`: React, Vite, TypeScript, Tailwind and Framer Motion, wrapped by Capacitor for Android.
- `apps/api`: a Hono app on Cloudflare Workers, using D1 for data, R2 for media and Cron Triggers for scheduled jobs.
- `packages/shared`: types, Zod schemas and the prompt builder, used by both apps.

External services:
- **Clerk** handles identity only. All roles and permissions live in D1.
- **Napster** provides the live avatar. Companions and agents are created by the Worker, and sessions run in the app through the Napster Web SDK.
- **Meta Model API** is used at build time (`muse-image-1.0`) for media assets and demo faces, and at runtime (`muse-spark-1.3`) for summaries.

**Tech Stack:**
- Tooling: pnpm 9, TypeScript 5, Vitest 2
- API: Hono 4, Drizzle ORM (D1), `@cloudflare/vitest-pool-workers`, Wrangler 3
- App: React 18, Vite 5, React Router 6, TanStack Query 5, Tailwind 3, Framer Motion 11
- Native: Capacitor 6 (Android)
- Auth: `@clerk/clerk-react`, `@clerk/backend`
- Avatar: `@touchcastllc/napster-companion-api@2` with `@reduxjs/toolkit`
- Meta Model API: `openai` SDK
- Asset tools: `sharp`, `@imgly/background-removal-node`, `@capacitor/assets`
- Fonts: `@fontsource/fredoka`

**Spec:** `docs/superpowers/specs/2026-11-18-everthere-design.md`. Read it before starting any task. Approved mockups are in `.superpowers/brainstorm/1206-1795026861/content/key-screens.html`.

## Global Constraints

### Visual style
- **Theme:** "Sunny & Playful".
- **Font:** Fredoka (400/500/600/700), bundled locally, never loaded from a CDN at runtime.
- **Colors:**
  - ink `#2B2140`
  - muted `#7A6E8A`
  - cream `#FFF8EC`
  - sun `#FFD23F` (dark `#E8B400`)
  - coral `#FF7A59` (dark `#E0583A`)
  - mint `#C9F2E1` (dark `#8FDDBE`)
  - sky `#CFE6FF`
  - lilac `#E7DEFF`
  - line `#F1E6D2`
  - flag background `#FFE3D6`
- **Buttons:** chunky, with a 2.5px ink border, a hard `0 4px 0` ink bottom shadow, 20px radius, and a press animation (translateY 3px, shadow 1px).

### Polish
- No "lorem", no "TODO" in the UI, and no raw error text shown to users.
- Every list screen has an illustrated empty state, a skeleton loading state and a friendly error state with a retry.
- The only "coming soon" anywhere is the "Record your real voice" teaser card.

### Safety
- Comfort only. Never add discipline features.
- These rules are locked into every agent prompt:
  - never promise times or events
  - no secrets
  - never scold, threaten or shame
  - no medical advice
  - concerns must call `flag_concern`
  - never claim to be physically coming
  - if asked, say "I'm a video helper Mommy/Daddy made for you"
- The child's camera is never sent to Napster. Sessions use `videoPolicy: "deferred"` and never call `START_VIDEO`.
- **Session cap:** a warning at 8:00 and a hard end at 10:00.
- **Credit guard:** $120 total spend cap, and at most 20 sessions per user per day.

### Napster
- Base URL: `https://napster-api.napster.com/public`, with the `X-Api-Key` header. The key lives only in the Worker.
- `externalClientId` must match `^[A-Za-z0-9_-]{1,32}$`. All app IDs are `nanoid()` with the default 21-character alphabet.
- Limits: 5 concurrent WebRTC sessions (a 409 maps to `AVATARS_BUSY`), and 1 connection request per second (retry 429s using `Retry-After`, at most 2 retries).

### Meta
- Base URL `https://api.meta.ai/v1` with `Authorization: Bearer`.
- Images: `muse-image-1.0` at $0.01 per image, 150 requests per minute.
- Text: `muse-spark-1.3`.
- Fallback for text: Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

### API errors
- The JSON shape is always `{ "error": { "code": string, "message": string } }`.
- Codes:
  - `UNAUTHENTICATED` (401)
  - `FORBIDDEN` (403)
  - `NOT_FOUND` (404)
  - `INVALID` (400)
  - `SESSION_ACTIVE` (409)
  - `AVATARS_BUSY` (503)
  - `RESTING` (503, credit guard)
  - `DEMO_READ_ONLY` (403)
  - `INVITE_INVALID` (400)
  - `PIN_LOCKED` (429)

### Secrets
- Never commit secrets and never print them in logs.
- **Worker secrets:** `NAPSTER_API_KEY`, `NAPSTER_WEBHOOK_SECRET`, `CLERK_SECRET_KEY`, `META_API_KEY`, `MEDIA_SIGNING_KEY`, `ADMIN_TOKEN`, `ACTING_TOKEN_KEY`.
- **Local scripts** read the same names from the repo-root `.env`, which is git-ignored.
- **App build-time env (public):** `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_BASE`.

### Commits and IDs
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Times are stored as integer Unix milliseconds in UTC. IANA timezones are stored on `org` and `child`.

## Review Focus

These are the most likely ways the app fails for a real user without any task's main tests noticing. Each one has a pinned test in the task named.

1. **Double "Call" tap or a retry while a session is starting.** Expect exactly one Napster session and no `ALREADY_INITIALIZED` crash. Covered by Task 13 (`SESSION_ACTIVE` test) and Task 19 (start is ignored unless the state is `idle` or `ended`).
2. **The app is backgrounded, the screen locks, or the call drops mid-session.** Billing must stop. Covered by Task 19 (a pause event ends the session) and Task 14 (the cron sweep ends connections older than 11 minutes).
3. **A huge camera or gallery photo (12+ MP, portrait).** Expect it downscaled and padded to 1920×1080 JPEG before upload, not a 10 MB upload or a squashed face. Covered by Task 20 (`toNapsterFrame` test).
4. **A daycare and a server in different timezones.** "Today" notes must expire at the child's local midnight, not UTC. Covered by Task 12 (`todayNoteExpiry` test).
5. **Napster webhooks arriving duplicated, early, or for unknown or test sessions.** Expect them to be idempotent, never crash, never alert twice, and to send test-call summaries only to the parent. Covered by Task 14 (dedupe, unknown-session and test-session tests).

---

## File Structure

```
everthere/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  .gitignore  .env.example  README.md
  packages/shared/src/
    domain.ts        # enums, labels, VOICES, REASONS, TONES, limits
    schemas.ts       # zod request/response schemas shared by app+api
    prompt.ts        # buildAgentInstructions, buildInitialSpeech, buildClientProfile
    time.ts          # todayNoteExpiry
  apps/api/
    wrangler.toml  drizzle.config.ts  migrations/0001_init.sql
    src/index.ts               # Hono app, routes mount, scheduled() export
    src/env.ts                 # Env bindings type
    src/http.ts                # apiError(), error handler, zod validator wrapper
    src/db/schema.ts           # drizzle tables
    src/auth/clerk.ts          # authMiddleware, upsertUser
    src/auth/access.ts         # permission predicates
    src/auth/acting.ts         # device registration, PIN, acting-teacher tokens
    src/auth/demo.ts           # forbidDemo middleware, demo sign-in tickets
    src/lib/ids.ts  src/lib/crypto.ts  src/lib/invites.ts
    src/napster/client.ts      # typed Napster REST client
    src/meta/client.ts         # Meta text + image client
    src/services/avatars.ts  src/services/sessions.ts  src/services/summary.ts
    src/services/alerts.ts  src/services/creditGuard.ts  src/services/demo.ts
    src/routes/{me,families,children,caregivers,orgs,classrooms,invites,media,avatars,plans,sessions,alerts,webhooks,demo,admin}.ts
    src/cron.ts
    test/**.test.ts  test/helpers.ts
  apps/mobile/
    capacitor.config.ts  index.html  vite.config.ts  tailwind.config.ts
    android/                   # generated by cap add android
    src/main.tsx  src/App.tsx  src/router.tsx
    src/theme/{tokens.ts,motion.ts,global.css}
    src/ui/{Button,Chip,Card,Segmented,Sheet,Screen,TopBar,TabBar,EmptyState,Skeleton,Toast,Illustration,Avatar,Badge,Field}.tsx
    src/assets/{manifest.ts, img/**}     # generated + curated media
    src/lib/{api.ts,queries.ts,role.ts,native.ts,image.ts,storage.ts,alertsPoller.ts}
    src/live/{useNapsterSession.ts,sessionMachine.ts,LiveSession.tsx}
    src/features/onboarding/*  src/features/parent/*  src/features/avatar/*
    src/features/plan/*  src/features/caregivers/*  src/features/sessions/*
    src/features/alerts/*  src/features/caregiver/*  src/features/admin/*  src/features/dev/Gallery.tsx
  scripts/
    assets/{artBible.ts, assetList.ts, generate.ts, removeBg.ts, optimize.ts}
    napster/{setupFlagTool.ts, voicePreviews.ts}
    seed/{seed.ts, personas.ts}
  docs/notes/napster-events.md   # payload shapes captured in the spike
```

---

## Phase 0: Foundation and risk spikes

### Task 1: Monorepo, shared domain, and prompt builder

**Files:**
- Create: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/shared/{package.json,tsconfig.json,src/domain.ts,src/schemas.ts,src/prompt.ts,src/time.ts,src/index.ts}`
- Test: `packages/shared/test/prompt.test.ts`, `packages/shared/test/time.test.ts`

**Interfaces:**
- Produces, in `domain.ts`:
  - `type Role = 'parent'|'admin'|'teacher'|'home_caregiver'`
  - `type Reason = 'missing_parent'|'upset_nap'|'new_nervous'|'boo_boo'`
  - `REASONS: Record<Reason,{label:(parentTitle:string)=>string; emoji:string}>`. Labels are `Missing ${parentTitle}`, `Upset at nap`, `New & nervous`, `Got a boo-boo`, with emoji 🥺 😴 🌱 🩹.
  - `type Tone = 'calm'|'playful'|'soothing'`
  - `VOICES = ['alloy','ash','ballad','coral','echo','sage','shimmer','verse','marin','cedar'] as const`
  - `type MoodAfter = 'calmer'|'same'|'upset'`
  - `type FlagCategory = 'injury'|'illness'|'hurt_by_someone'|'scared_of_person'|'unsafe'|'other'`
  - `type Severity = 'low'|'medium'|'high'`
  - `LIMITS = { sessionWarnMs: 480_000, sessionMaxMs: 600_000, creditCapUsd: 120, sessionsPerUserPerDay: 20, inviteTtlMs: 7*86_400_000, pinAttempts: 5, pinWindowMs: 600_000 }`
- Produces, in `prompt.ts`:
  - `interface PlanInput { childName; childAgeYears; parentTitle /* "Mommy" */; parentFirstName; nicknames:string[]; tone:Tone; favorites:string[]; phrases:string[]; songTitle?; songLyrics?; neverTopics:string[]; todayNote? }`
  - `buildAgentInstructions(parentFirstName: string, parentTitle: string): string`. The agent-level prompt holds identity plus the locked rules. It's per avatar, so it contains no child specifics.
  - `buildClientProfile(plan: PlanInput): Record<string,unknown>`. This is the per-session `externalClientProfile`.
  - `buildInitialSpeech(plan: PlanInput, reason: Reason): string`
  - `buildSessionContext(plan: PlanInput): string`. A system message injected at session start.
- Produces, in `time.ts`: `todayNoteExpiry(timezone: string, nowMs: number): number`, which returns the next local midnight as UTC milliseconds.
- Produces, in `schemas.ts`: Zod schemas for every request body used later. Names: `StartSessionBody`, `FlagBody`, `CheckinBody`, `PlanBody`, `ChildBody`, `InviteCreateBody`, `InviteRedeemBody`, `AvatarCreateBody`, `PinBody`, `ActingBody`. Each task adds its own fields when it first uses the schema.

- [ ] **Step 1:** Run `git init`. Create the workspace files. `.gitignore` covers `node_modules`, `dist`, `.env`, `.wrangler`, `.superpowers/`, `apps/mobile/android/app/build`, and `*.keystore`. `.env.example` lists every secret name from Global Constraints with an empty value.
- [ ] **Step 2: Write failing tests**

```ts
// prompt.test.ts
const plan = { childName:'Mia', childAgeYears:3, parentTitle:'Mommy', parentFirstName:'Sarah',
  nicknames:['Sunshine','Mia-bear'], tone:'playful', favorites:['Bunny'], phrases:['remember our bedtime song'],
  songTitle:'Twinkle Twinkle', neverTopics:["Grandpa's hospital stay"], todayNote:'Grandma picks up today' } as const;
test('locked rules always present', () => {
  const s = buildAgentInstructions('Sarah','Mommy');
  for (const must of ['Never promise','secret','Never scold','medical','flag_concern','video helper'])
    expect(s).toContain(must);
});
test('initial speech uses a nickname and fits the reason', () => {
  const s = buildInitialSpeech(plan,'upset_nap');
  expect(s).toMatch(/Sunshine|Mia-bear/); expect(s.toLowerCase()).toContain('nap');
});
test('session context lists never-topics as forbidden and includes today note', () => {
  const s = buildSessionContext(plan);
  expect(s).toContain("Grandpa's hospital stay"); expect(s).toContain('Grandma picks up today');
});
test('client profile has no undefined values', () => {
  expect(Object.values(buildClientProfile({...plan, songLyrics: undefined})).includes(undefined)).toBe(false);
});
// time.test.ts
test('today note expires at LA local midnight', () => {
  const now = Date.UTC(2026,10,19,6,30); // Nov 18 22:30 PST
  expect(todayNoteExpiry('America/Los_Angeles', now)).toBe(Date.UTC(2026,10,19,8,0));
});
```

- [ ] **Step 3:** Run `pnpm -F @everthere/shared test`. Expected: FAIL because the modules are missing.
- [ ] **Step 4:** Implement `domain.ts`, `prompt.ts`, `time.ts` and `schemas.ts`.
  - Locked-rule wording comes from spec §9.1. Keep it under 2,500 characters.
  - `todayNoteExpiry` uses `Intl.DateTimeFormat` with `timeZone` to find the local date, then searches for the UTC instant of the next local 00:00.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit with message `feat(shared): domain, schemas, prompt builder`.

### Task 2: API skeleton, D1 schema, test harness

**Files:**
- Create: `apps/api/{package.json,wrangler.toml,drizzle.config.ts,vitest.config.ts,migrations/0001_init.sql}` and `src/{index.ts,env.ts,http.ts,db/schema.ts,lib/ids.ts}`
- Test: `apps/api/test/helpers.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `Env` with:
  - bindings `DB: D1Database`, `MEDIA: R2Bucket`, `AI: Ai`
  - vars `PUBLIC_API_BASE`, `NAPSTER_FLAG_FUNCTION_ID`
  - secrets as listed in Global Constraints
- Produces:
  - `apiError(code: ErrorCode, message: string): HTTPException`
  - `newId(): string` (nanoid 21)
  - `db(env): DrizzleD1Database<typeof schema>`
  - `app: Hono<{Bindings:Env; Variables:{userId:string; actingUserId?:string; me:UserRow}}>`
- Produces, in the test helpers: `makeApp()`, `authAs(userId)` (returns headers using a test verifier, see Task 3), and `seedRows(env, rows)`.
- Tables: every table in spec §8 "Data model" plus these additions:
  - `comfort_session` gets `kind ('child'|'test')`, `transcript_json TEXT`, `napster_status`, and `ended_reason`
  - `enrollment (id, org_id, classroom_id, child_name, invite_code, child_id NULL, status 'invited'|'linked', created_at)`
  - `device (id, org_id, registered_by, created_at)`
  - `pin_attempt (device_id, at)`
  - `user.is_demo INTEGER DEFAULT 0`
  - `avatar.is_synthetic INTEGER DEFAULT 0`
  - `credit_guard (id=1, cap_usd, spent_usd)`

- [ ] **Step 1:** Write a failing test. `GET /api/health` returns `200 {ok:true}`. An unknown route returns `404` with body `{error:{code:'NOT_FOUND'}}`. The test runs after the D1 migrations are applied in `vitest.config.ts` (`applyD1Migrations` in the setup file).
- [ ] **Step 2:** Run `pnpm -F api test`. Expected: FAIL.
- [ ] **Step 3:** Implement the Hono app, the error handler that maps `HTTPException` to the error JSON, the Drizzle schema, and the migration SQL. The Drizzle schema and the SQL must match exactly.
  - `wrangler.toml` declares D1 `everthere`, R2 `everthere-media`, the `ai` binding, and cron triggers `*/2 * * * *` and `0 8 * * *`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(api): skeleton, schema, test harness`.

### Task 3: Clerk auth middleware and `/api/me`

**Files:**
- Create: `apps/api/src/auth/clerk.ts`, `apps/api/src/routes/me.ts`
- Test: `apps/api/test/me.test.ts`

**Interfaces:**
- Produces:
  - `authMiddleware(verify?: (token:string)=>Promise<{sub:string; email?:string; name?:string}>)`. The default uses `verifyToken` from `@clerk/backend` with `secretKey`. Tests inject a verifier that accepts `test:<userId>`.
  - `upsertUser(env, claims)`
- Produces: `GET /api/me` returns:
  `{ user:{id,name,email,isDemo}, roles:{ parent:boolean; adminOrgs:{id,name}[]; teacherOrgs:{id,name}[]; homeCaregiverFamilies:{id,label}[] } }`

- [ ] **Step 1:** Write failing tests:
  - no token → 401 `UNAUTHENTICATED`
  - a new user → a row is created and every role is false or empty
  - a user with a `family_member` row → `parent:true`
  - a user with an `org_member` row of role `admin` → `adminOrgs` contains that org
- [ ] **Step 2:** Run the tests. Expected: FAIL. Then implement. Then run again. Expected: PASS.
- [ ] **Step 3:** Commit with message `feat(api): clerk auth + me`.

### Task 4: Device spike: Clerk and Napster inside the Capacitor Android WebView (gate)

This task decides the client architecture. Do it before any UI work. It's done when, **on a physical Android phone and tablet**, these all work:
1. Clerk email sign-in completes and the API sees a valid JWT.
2. A Napster avatar renders inline, can be heard, and hears the mic.
3. Ending the session releases the mic.

**Files:**
- Create: `apps/mobile` (Vite React TypeScript template), `capacitor.config.ts` (`appId: 'app.everthere'`, `appName: 'EverThere'`, `server.androidScheme: 'https'`), and `android/` via `npx cap add android`
- Create: `apps/mobile/src/features/dev/Spike.tsx` (temporary)
- Create: `apps/api/src/routes/devNapster.ts`. The route `POST /api/dev/napster-token` is mounted only when `env.DEV_ROUTES === '1'`.
- Create: `docs/notes/napster-events.md`

**Interfaces:**
- Produces: `docs/notes/napster-events.md` with the exact `onData` payload shapes for:
  - `message_received` (caption text and role)
  - `talk_state_changed`
  - implicit function calls (name, call ID field, arguments)
  - `avatar_connection_warning`, `session_expired`
  - the exact `sendCommand` shape for function output
  - the companion object fields that show avatar generation status (`GET /public/companions/{id}` right after create with `pictureUrl`)
  - whether Napster accepts a 1920×1080 JPEG `pictureUrl`

  Tasks 12, 14 and 19 rely on this document.

- [ ] **Step 1:** Install the Napster docs MCP and skills for the coding agent:
  - `claude mcp add napster-docs --transport http https://developers.napster.com/mcp`
  - `npx skills add napster/omniagent-api-skills`

  Ask the user before running these, because they change tool configuration.
- [ ] **Step 2:** Create a throwaway companion and agent with a stock avatar (`GET /public/companions/napster-stock`) through a scratch script, and record the agent ID in `.env` as `SPIKE_AGENT_ID`. The route returns `{token}` from `POST /agents/{SPIKE_AGENT_ID}/connections` with `{channelType:'webrtc', videoPolicy:'deferred'}`.
- [ ] **Step 3:** Build the spike screen:
  - `<ClerkProvider>` with an email/password form using `useSignIn`
  - a "Call" button that runs `NapsterCompanionApiSdk.init(getToken, {layout:{type:'inline', mountContainer:'#av'}})` and logs every `onData` payload to the screen and the console
  - an "End" button that calls `destroy()`
- [ ] **Step 4:** Android setup:
  - `AndroidManifest.xml` gets `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA` and `INTERNET`.
  - Add an `@capacitor/core` permission request for the mic before `init`.
  - In the Clerk dashboard, add `https://localhost` (the Android WebView origin) to the allowed origins.
- [ ] **Step 5:** Run `pnpm -F mobile build && npx cap sync android && npx cap run android` on the device. Verify all three gate items, and fill in `napster-events.md`.
- [ ] **Step 6: Decision record.**
  - If Clerk's hosted flow fails in the WebView: use only Clerk's headless `useSignIn`/`useSignUp` forms. This is the plan of record anyway.
  - If Napster WebRTC fails in the WebView: try `WebChromeClient.onPermissionRequest` granting `RESOURCE_AUDIO_CAPTURE` in `MainActivity`. If it still fails, write down the fallback (session in a Chrome Custom Tab on a hosted page) and stop for user review.
- [ ] **Step 7:** Delete `Spike.tsx`, keep `devNapster.ts` behind the flag, and commit with message `chore: device spike (clerk + napster webview) + event notes`.

### Task 5: Media asset pipeline (Meta `muse-image-1.0`)

**Files:**
- Create: `scripts/assets/{artBible.ts,assetList.ts,generate.ts,removeBg.ts,optimize.ts}`, `apps/mobile/src/assets/manifest.ts`, `apps/api/src/meta/client.ts` (the image half; the shared client lives here so scripts import it)
- Test: `scripts/assets/test/assetList.test.ts`, `apps/api/test/meta.test.ts`

**Interfaces:**
- Produces:
  - `metaImages(apiKey).generate({prompt, n, size, outputFormat}): Promise<Buffer[]>`, using the `openai` SDK with `baseURL` `https://api.meta.ai/v1` and model `muse-image-1.0`
  - `metaImages(apiKey).edit({prompt, images: Buffer[], n}): Promise<Buffer[]>`, which posts JSON `images` items as base64 data URLs to `/v1/images/edits`
- Produces: `ASSETS: AssetSpec[]`, where `AssetSpec = { key: string; group: 'brand'|'onboarding'|'moments'|'reasons'|'empty'|'stickers'|'blobs'|'classroom'|'video'; prompt: string; size: '1024x1024'|'1792x1024'|'1024x1792'; transparent: boolean; density: boolean }`. It covers every row of the spec §7a table except "Demo people", which belong to Task 15. Examples of keys: `brand.icon`, `onboarding.hero`, `empty.noSessions`, `reason.boo_boo`, `sticker.bunny`, `classroom.butterflies`.
- Produces: `apps/mobile/src/assets/manifest.ts`, which exports `img: Record<AssetKey, string>` (the imported WebP URL). It's generated by `optimize.ts`, so components reference assets by key only.

- [ ] **Step 1:** Write failing tests:
  - every `ASSETS` key is unique
  - every `ASSETS` prompt starts with the `ART_BIBLE` style string
  - every empty state named in spec §7 has an asset
  - `metaImages.generate` sends `model:'muse-image-1.0'` and decodes `b64_json` (with mocked `fetch`)
- [ ] **Step 2:** Implement the art bible (spec §7a wording, exact palette hex values) and the asset list.
- [ ] **Step 3:** Implement `generate.ts`:
  1. Generate `onboarding.hero` first with `n:4` into `scripts/assets/out/candidates/<key>/`.
  2. **Stop and ask the user to pick the hero.** Save the pick as `scripts/assets/out/reference.png`.
  3. Generate every other asset with `edit({images:[reference], n:4})` so the style stays consistent.
  4. Limit concurrency to 4. Retry a `content_policy_violation` once with a softened prompt, then log it as skipped.
- [ ] **Step 4:** Implement `removeBg.ts` for `transparent:true` assets, using `@imgly/background-removal-node` on the chosen candidate.
- [ ] **Step 5:** Implement `optimize.ts`:
  - `sharp` to WebP at quality 82
  - 1x/2x/3x for `density:true`
  - writes `apps/mobile/src/assets/img/**` and `manifest.ts`
  - writes Capacitor icon and splash sources to `apps/mobile/assets/` (`icon-only.png`, `icon-foreground.png`, `icon-background.png`, `splash.png`) for `npx @capacitor/assets generate --android`
- [ ] **Step 6:** Run `pnpm assets:generate`, then hand-curate. Write a contact sheet to `scripts/assets/out/contact.html` and show it to the user for sign-off. Then run `pnpm assets:optimize`. Expected: the manifest compiles and every key resolves.
- [ ] **Step 7:** Commit the curated output only (not the candidates) with message `feat(assets): generated + curated media set`.

### Task 6: Napster setup scripts (flag tool, voice previews)

**Files:**
- Create: `scripts/napster/setupFlagTool.ts`, `scripts/napster/voicePreviews.ts`, `apps/api/src/napster/client.ts`
- Test: `apps/api/test/napster.test.ts`

**Interfaces:**
- Produces: `napster(apiKey)` with these typed methods. Each throws `NapsterError {status, code, retryAfterMs?}`.
  - `createCompanion({description, firstName, pictureUrl, version:'v1'})` returns `{id}`
  - `getCompanion(id)`
  - `createAgent({companionId, name, voiceId, language:'en', providerSettings:{instructions, temperature:0.6}, functions:[flagFnId], mode:'conversation'})` returns `{id}`
  - `patchAgent(id, partial)`
  - `createConnection(agentId, {channelType:'webrtc', videoPolicy:'deferred', externalClientId, externalClientProfile, initialSpeech, tags})` returns `{token, connectionId}`
  - `deleteConnection(id)`
  - `getSession(id)` returns `{status, cost, closeReason, items:{role,text,timestamp}[]}`
  - `deleteSession(id)`
  - `createFunction(def)` returns `{id}`
  - `createRecording(companionId, {provider:'openAi', voiceId, text})` returns `{id, status}`
  - `getRecording(...)`
- Behavior:
  - `createConnection` retries on 429, honoring `Retry-After`, at most 2 times.
  - A 409 with `ConcurrentSessionLimitReached` maps to `NapsterError{code:'BUSY'}`.

- [ ] **Step 1:** Write failing tests with mocked `fetch`:
  - the `X-Api-Key` header is sent
  - 429 followed by 200 → one retry, then success
  - a 409 concurrent-limit response → `code:'BUSY'`
  - `getSession` maps `conversation.items` and handles a missing `conversation` as `[]`
- [ ] **Step 2:** Implement the client. Run the tests. Expected: PASS.
- [ ] **Step 3:** Implement `setupFlagTool.ts`:
  - It creates the `flag_concern` function: `flow:'implicit'`, parameters `{category: enum FlagCategory, quote: string, severity: enum Severity}`, and the description "Call whenever the child mentions pain, injury, illness, being hit, being scared of a person, or anything unsafe."
  - It prints the ID to put in `wrangler.toml` as `NAPSTER_FLAG_FUNCTION_ID`.
- [ ] **Step 4:** Implement `voicePreviews.ts`:
  - For each voice in `VOICES`, create a recording on a stock companion with the text "Hi sweetie! I love you to the moon and back."
  - Poll until done, download it, and extract the audio with `ffmpeg -vn -c:a aac` to `apps/mobile/src/assets/voices/<voice>.m4a`.
  - Run it once and commit the clips.
- [ ] **Step 5:** Commit with message `feat(napster): client, flag tool, voice previews`.

---

## Phase 1: Backend domain

### Task 7: Access control

**Files:**
- Create: `apps/api/src/auth/access.ts`
- Test: `apps/api/test/access.test.ts`

**Interfaces:**
- Produces async predicates over D1. Each takes `(env, userId, …)`:
  - `isParentOf(childId)`
  - `isAdminOf(orgId)`
  - `caregiverChildIds(userId): Promise<string[]>`. It returns:
    - for a teacher: children in their `classroom_staff` classrooms whose `connection(kind='daycare')` is to that org
    - for an admin: every linked child of the org
    - for a home caregiver: their `connection(kind='home')` children
  - `canViewChild(childId)`, which is parent ∪ caregiver
  - `canStartSession(childId, avatarId)`: the caller is a caregiver of the child, the avatar is `approved`, and the avatar belongs to a parent of that child
  - `canReadTranscript(sessionId)`:
    - parent → true
    - daycare staff → `connection.transcript_access` on the daycare connection
    - home caregiver → `transcript_access` on their own connection
  - `canSeeSummary(sessionId)`, which is parent ∪ caregiver of that child
- Produces: `requireX(...)` wrappers that throw `FORBIDDEN`.

- [ ] **Step 1:** Write failing tests with a fixture: org A with classrooms A1 and A2, teacher T1 in A1, admin AD, families F1 (child C1 in A1) and F2 (child C2 in A2, with nanny N2).

```ts
expect(await caregiverChildIds(env,'T1')).toEqual(['C1']);           // not C2 (other classroom)
expect(await caregiverChildIds(env,'AD')).toEqual(expect.arrayContaining(['C1','C2']));
expect(await canViewChild(env,'N2','C1')).toBe(false);               // cross-family leak
expect(await canStartSession(env,'T1','C1', unapprovedAvatar)).toBe(false);
expect(await canStartSession(env,'T1','C1', avatarOfF2Parent)).toBe(false); // wrong family's avatar
expect(await canReadTranscript(env,'T1', sessC1)).toBe(false);       // default off
// after parent enables daycare transcript_access:
expect(await canReadTranscript(env,'T1', sessC1)).toBe(true);
```

- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): access control`.

### Task 8: Invite codes

**Files:**
- Create: `apps/api/src/lib/invites.ts`, `apps/api/src/routes/invites.ts`
- Test: `apps/api/test/invites.test.ts`

**Interfaces:**
- Produces: `generateCode(): string`. It's 6 characters from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L).
- Produces: `createInvite(env, {type, payload, createdBy})` returning `{code, expiresAt}`.
  - `type` is one of `'staff'|'parent_enrollment'|'co_parent'|'home_caregiver'`.
  - TTL is `LIMITS.inviteTtlMs`.
- Produces: `POST /api/invites/peek {code}` returning `{type, orgName?, childName?, inviterName}` for the join screen.
- Produces: `POST /api/invites/redeem {code, existingChildId?, pin?}`. Effects by type:
  - **staff:** adds an `org_member` with role teacher, and sets the PIN (required, 4 digits) through `setPin` from Task 10.
  - **parent_enrollment:** creates a family if the user has none. It either creates the child (name from the enrollment, timezone from the org) or links `existingChildId`. Then it inserts the daycare `connection` and `classroom_child`, and sets the enrollment `status:'linked'`.
  - **co_parent:** adds a `family_member`.
  - **home_caregiver:** inserts `connection(kind:'home', caregiver_user_id, transcript_access:false)` for each `payload.childIds`.
- Behavior:
  - Codes are single-use, enforced atomically with `UPDATE … WHERE used_at IS NULL`.
  - A wrong, used or expired code returns `INVITE_INVALID`. Codes are case-insensitive.

- [ ] **Step 1:** Write failing tests:
  - the code alphabet and length
  - redeeming twice → the second returns `INVITE_INVALID`
  - an expired code → `INVITE_INVALID`
  - a lowercase code works
  - each type's effect
  - a staff invite without a PIN → `INVALID`
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): invites`.

### Task 9: Families, children, co-parents, home caregivers

**Files:**
- Create: `apps/api/src/routes/{families.ts,children.ts,caregivers.ts}`
- Test: `apps/api/test/family.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/families`. It's idempotent and returns the caller's family.
  - `GET/POST /api/children`
  - `PATCH/DELETE /api/children/:id`. The body is `{name, birthday, timezone, photoKey?, callsParent?}`. Delete cascades: sessions, flags, Napster `deleteSession` for each session, the enrollment link, and connections.
  - `GET /api/children/:id/caregivers` returns `{daycare?:{org, teachers[], transcriptAccess}, home:{userId,name,transcriptAccess}[]}`
  - `PATCH /api/children/:id/caregivers/:connectionId {transcriptAccess}`
  - `DELETE /api/children/:id/caregivers/:connectionId`
  - `POST /api/invites` with type `co_parent` or `home_caregiver`. It's parent-only, and `payload.childIds` must be the caller's children.

- [ ] **Step 1:** Write failing tests:
  - a parent can create and list only their own children
  - a non-parent `PATCH` → `FORBIDDEN`
  - delete cascades: the session rows disappear and the mocked Napster `deleteSession` is called
  - a nanny invite can't include another family's child
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): families, children, caregivers`.

### Task 10: Daycare org, classrooms, staff, enrollments, shared-tablet PIN

**Files:**
- Create: `apps/api/src/routes/{orgs.ts,classrooms.ts}`, `apps/api/src/auth/acting.ts`
- Test: `apps/api/test/org.test.ts`, `apps/api/test/acting.test.ts`

**Interfaces:**
- Produces routes:
  - `POST /api/orgs {name, address, timezone, logoKey?}`. The creator becomes admin.
  - `GET/PATCH /api/orgs/:id`
  - `GET/POST /api/orgs/:id/classrooms {name, emoji|assetKey}`
  - `PUT /api/classrooms/:id/staff {userIds}`
  - `GET /api/orgs/:id/staff`, which includes `hasPin`
  - `DELETE /api/orgs/:id/staff/:userId`
  - `POST /api/orgs/:id/invites/staff`
  - `POST /api/orgs/:id/enrollments {childName, classroomId}` returns `{enrollment, code}`
  - `GET /api/orgs/:id/enrollments`
  - `GET /api/orgs/:id/roster?classroomId=`, returning tiles `{enrollmentId, childId?, name, photoUrl?, status:'invite_sent'|'setup_pending'|'ready', readyAvatars:{avatarId, parentTitle}[]}`
  - `GET /api/orgs/:id/dashboard`, returning `{readyCount, todaySessions, openFlags[], monthSessions, monthCostUsd}`
  - `POST /api/flags/:id/ack`
- Produces in `acting.ts`:
  - `setPin(env, userId, orgId, pin)`, using PBKDF2-SHA256 with 100k iterations and a random salt
  - `POST /api/orgs/:id/devices` returns `{deviceId}` (staff only)
  - `POST /api/orgs/:id/acting {deviceId, teacherUserId, pin}` returns `{actingToken, expiresAt}`. The token is an HMAC of `deviceId|orgId|teacherUserId|exp` with `ACTING_TOKEN_KEY` and a 12-hour lifetime.
  - `actingMiddleware`: when the `X-Acting-Token` header is valid and the signed-in user is staff of the same org, it sets `c.var.actingUserId`. Caregiver routes use `actingUserId ?? userId`.
- Behavior: after 5 wrong PINs per device within 10 minutes → `PIN_LOCKED`.

- [ ] **Step 1:** Write failing tests:
  - roster status transitions (`invite_sent` → `setup_pending` after redeem → `ready` after approve)
  - a teacher's roster excludes other classrooms
  - acting:
    - a correct PIN gives a token, and a session started with it is attributed to the acting teacher
    - a tampered token is ignored
    - the 6th wrong PIN → `PIN_LOCKED`
    - an acting token from org A is ignored on org B
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): daycare admin + shared tablet acting`.

### Task 11: Media (R2) with signed URLs

**Files:**
- Create: `apps/api/src/lib/crypto.ts`, `apps/api/src/routes/media.ts`
- Test: `apps/api/test/media.test.ts`

**Interfaces:**
- Produces:
  - `hmacHex(key: string, msg: string): Promise<string>`
  - `timingSafeEqualHex(a, b): boolean`
  - `signMediaUrl(env, key, ttlMs): Promise<string>`, which returns `${PUBLIC_API_BASE}/m/${encodeURIComponent(key)}?exp=…&sig=…`
- Produces routes:
  - `POST /api/media` (multipart `file`, `purpose:'avatar'|'child'|'logo'`) returns `{key, url}`. The key is `${purpose}/${ownerId}/${newId()}.jpg`. The content type must be `image/jpeg|png|webp`, with a maximum of 8 MB.
  - `GET /m/:key` is public. It verifies `exp` and `sig` and streams from R2 with `Cache-Control: private, max-age=300`.
- Behavior: URLs given to Napster use a 1-hour TTL. URLs given to the app use a 1-hour TTL and are refreshed by queries.

- [ ] **Step 1:** Write failing tests:
  - an upload → R2 contains the object
  - a signed URL → 200
  - an expired URL → 403
  - a tampered signature → 403
  - an 9 MB upload → 400 `INVALID`
  - a `text/html` upload → 400
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): media + signed urls`.

### Task 12: Avatars, consent, comfort plans

**Files:**
- Create: `apps/api/src/services/avatars.ts`, `apps/api/src/routes/{avatars.ts,plans.ts}`
- Test: `apps/api/test/avatars.test.ts`, `apps/api/test/plans.test.ts`

**Interfaces:**
- Consumes:
  - `napster()` from Task 6
  - `buildAgentInstructions`, `buildClientProfile`, `todayNoteExpiry` from Task 1
  - `signMediaUrl` from Task 11
  - companion status fields from `docs/notes/napster-events.md`
- Produces routes:
  - `POST /api/avatars {photoKey, voiceId, consentName, consentAccepted:true, parentTitle}` returns the avatar with `status:'creating'`. It creates the Napster companion (`pictureUrl` from a signed URL, `description` from the persona, `firstName`), then stores the avatar.
  - `GET /api/avatars/mine`
  - `GET /api/avatars/:id`. This also advances the status: if `creating` and the companion is ready, it creates the agent and sets `ready`; if the companion failed, it sets `failed`. Also run by the cron.
  - `PATCH /api/avatars/:id {photoKey?|voiceId?}`. It re-creates the companion or patches the agent's voice, and resets the status to `creating` or `ready`, clearing `approved_at`.
  - `POST /api/avatars/:id/approve`, allowed only from `ready`
  - `POST /api/avatars/:id/test-session` returns `{sessionId, token}`. It uses `externalClientId: 't_'+avatarId`, `kind:'test'`, and ignores caregiver checks, but only the owner may call it.
  - `GET/PUT /api/children/:childId/plans/:avatarId` with `PlanBody`. Saving computes `today_note_expires_at = todayNoteExpiry(child.timezone, now)` when `todayNote` is set.
- Behavior: consent is required. `consentAccepted !== true` or an empty `consentName` → `INVALID`.

- [ ] **Step 1:** Write failing tests with Napster mocked:
  - create → `creating`
  - poll with a ready companion → the agent is created with `functions:[NAPSTER_FLAG_FUNCTION_ID]` and the instructions contain "flag_concern" → `ready`
  - approve from `creating` → `INVALID`
  - changing the photo after approval clears `approved_at`
  - a plan saved at 23:30 LA time expires at the next LA midnight
  - another parent can't GET your plan
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): avatars, consent, comfort plans`.

### Task 13: Sessions and credit guard

**Files:**
- Create: `apps/api/src/services/{sessions.ts,creditGuard.ts,alerts.ts}`, `apps/api/src/routes/sessions.ts`
- Test: `apps/api/test/sessions.test.ts`, `apps/api/test/creditGuard.test.ts`
- `alerts.ts` starts here with `notifyFlag(env, sessionId, flag)`. It inserts an `alert` row of kind `flag` for each parent of the child and each admin of the child's daycare. Task 14 adds `notifySummary`.

**Interfaces:**
- Produces:
  - `POST /api/sessions {childId, avatarId, reason}` returns `{sessionId, token}`. The steps, in order:
    1. `canStartSession`
    2. `creditGuard.check(userId)`, which can return `RESTING`
    3. if there's an active session (status `pending`/`started`) for this child, return `SESSION_ACTIVE`
    4. load the plan
    5. `createConnection` with `externalClientId = childId`, `externalClientProfile = buildClientProfile(plan)`, `initialSpeech = buildInitialSpeech(plan, reason)`, `tags {childId, caregiverId, reason}`
    6. insert the session with `kind:'child'`, the attributed caregiver (`actingUserId ?? userId`), and status `started`

    A Napster `BUSY` maps to `AVATARS_BUSY`.
  - `GET /api/sessions/:id/context` returns `{systemMessage: buildSessionContext(plan)}`. The app injects it after the avatar is ready.
  - `POST /api/sessions/:id/flags {category, quote, severity, source:'live'|'manual'}` inserts the flag and calls `alerts.notifyFlag` (Task 14).
  - `POST /api/sessions/:id/end`. It's idempotent: it sets `ended_at` and calls `deleteConnection`, ignoring 404.
  - `POST /api/sessions/:id/checkin {moodAfter, note?}`, allowed for the caregiver who ran the session or an admin
  - `GET /api/sessions?childId&cursor`. Items are `{id, child, caregiverName, reason, startedAt, durationS, moodAfter, summary, moodSignal, flags[]}`.
  - `GET /api/sessions/:id` adds `transcript` only when `canReadTranscript`.
- Produces: `creditGuard.check(env, userId)` and `creditGuard.record(env, costUsd)`. The guard reads `credit_guard.cap_usd` (default 120) and counts today's sessions per user (UTC day), limited to 20.

- [ ] **Step 1:** Write failing tests:
  - happy path → Napster `createConnection` is called with `externalClientId` equal to the child ID and `videoPolicy:'deferred'`
  - a second start for the same child while active → `SESSION_ACTIVE` (Review Focus 1)
  - a 21st session in a day → `RESTING`
  - spent ≥ cap → `RESTING`
  - Napster busy → `AVATARS_BUSY`
  - an acting teacher is attributed
  - a teacher without transcript access gets no `transcript` field
  - end called twice → 200 both times
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): sessions + credit guard`.

### Task 14: Webhook, summaries, alerts, cron

**Files:**
- Create: `apps/api/src/routes/{webhooks.ts,alerts.ts}`, `apps/api/src/services/summary.ts`, `apps/api/src/cron.ts`, and the text half of `apps/api/src/meta/client.ts`
- Modify: `apps/api/src/services/alerts.ts` to add `notifySummary`
- Test: `apps/api/test/webhook.test.ts`, `apps/api/test/summary.test.ts`, `apps/api/test/cron.test.ts`

**Interfaces:**
- Produces: `verifyNapsterSignature(secret, rawBody, header): Promise<boolean>`. It accepts a hex HMAC-SHA256 match using the secret's base64-decoded bytes **or** its raw UTF-8 bytes. The real format is confirmed against a live delivery in Task 26.
- Produces: `POST /api/webhooks/napster`. Steps:
  1. Verify the signature, or return 401.
  2. Insert the `webhook_event` (`event_id` is the primary key). On a duplicate, return 200 and stop.
  3. On `session.closed`: find the session by `napster_session_id`. If unknown, return 200 and do nothing.
  4. Otherwise call `finalizeSession(env, sessionId)`.
- Produces: `finalizeSession`. Steps:
  1. `getSession` → store `transcript_json`, `cost_usd` and `duration_s`.
  2. `creditGuard.record`.
  3. `summarize()`.
  4. Store `summary`, `mood_signal`, and the flags with `source:'post'`, deduped against live flags by category plus a similar quote.
  5. `alerts.notifySummary`.
  6. Test sessions: alert only the owner, with no flags fan-out.
- Produces: `summarize(env, transcript, ctx): Promise<{summary:string; moodSignal:'better'|'same'|'worse'|'unclear'; flags:{category,quote,severity}[]}>`.
  - It uses Meta `muse-spark-1.3` chat completions with a strict-JSON instruction, parsed with Zod.
  - On error, it falls back to `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast')`.
  - If both fail: `{summary:'Summary is on its way. Here's the full conversation for now.', moodSignal:'unclear', flags:[]}`.
  - The summary is at most 2 sentences, written warmly to the parent in second person ("You sang…").
- Produces: `alerts.notifyFlag` and `alerts.notifySummary`, which insert `alert` rows for each parent of the child. A flag alert also goes to the daycare admins of that org.
  - `GET /api/alerts?unread=1`
  - `POST /api/alerts/read {ids}`
- Produces: `scheduled()`.
  - Every 2 minutes:
    1. finalize sessions ended more than 2 minutes ago without a summary
    2. end sessions with `started_at` older than 11 minutes (`deleteConnection` and set `ended_reason:'cap'`)
    3. advance avatars stuck in `creating`
    4. clear expired `today_note`
  - At 08:00 UTC: `resetDemoWorld` (Task 15).

- [ ] **Step 1:** Write failing tests:
  - a bad signature → 401
  - a duplicate `eventId` → a single alert set (Review Focus 5)
  - an unknown session → 200, no rows
  - a test session → only the owner gets an alert and no daycare admin does
  - Meta returns non-JSON → falls back to AI; both throw → the friendly fallback summary
  - the cron ends a 12-minute-old session and calls `deleteConnection` (Review Focus 2)
  - the cron clears an expired today note
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(api): webhook, summaries, alerts, cron`.

### Task 15: Demo world, judge sign-in, read-only guard, nightly reset

**Files:**
- Create: `apps/api/src/auth/demo.ts`, `apps/api/src/services/demo.ts`, `apps/api/src/routes/{demo.ts,admin.ts}`, `scripts/seed/{seed.ts,personas.ts}`
- Test: `apps/api/test/demo.test.ts`

**Interfaces:**
- Produces: `POST /api/demo/sign-in {persona:'parent'|'teacher'}` returns `{ticket}`. It calls the Clerk Backend API `POST https://api.clerk.com/v1/sign_in_tokens {user_id, expires_in_seconds:300}`. The app completes sign-in with `signIn.create({strategy:'ticket', ticket})`. The route is rate-limited to 10 requests per minute per IP.
- Produces: `forbidDemo` middleware → `DEMO_READ_ONLY`. It applies to:
  - `DELETE /api/children/:id`
  - avatar `PATCH`
  - caregiver removal
  - org or staff deletion
  - profile name changes
- Produces: admin routes, all requiring the `X-Admin-Token` header:
  - `PUT /api/admin/seed` (body: the fixture JSON produced by `seed.ts`)
  - `GET/PUT /api/admin/credit-guard {capUsd}`
- Produces: `resetDemoWorld(env)`. It deletes demo-family and demo-org rows created after `fixture.seededAt` (sessions, flags, alerts, invites, plan edits), then re-upserts the fixture rows. Avatars, companions and agents are kept.
- Produces: `scripts/seed/personas.ts`. Personas:
  - **Sarah Johnson:** Mia's mom, "Mommy"
  - **Marcus Johnson:** Mia's dad
  - **David Kim:** Leo's dad. He signed up alone and has a nanny.
  - **Rosa Alvarez:** the nanny, a home caregiver for Leo
  - **Jess Parker:** a teacher in the Butterflies Room
  - **Tanya Brooks:** admin of Little Acorns Daycare (America/Chicago)
  - Six more roster children with mixed statuses as in mockup 5: Ava, Noah, Zoe, Eli, Isla, Sam.

  Each persona has a photoreal portrait prompt (parents and staff) or an illustrated clay portrait prompt (children), consistent with spec §7a.
- `seed.ts` steps:
  1. Generate portraits with Meta (`n:4`; pick automatically by asking `muse-spark` to score "warm, natural, looking at camera, waist-up", then dump the picks to a contact sheet for the user).
  2. Pad the portraits to 1920×1080.
  3. Upload to R2.
  4. Create Clerk users via the Backend API, using emails `*.demo@everthere.app` and random passwords that are never stored.
  5. Create companions and agents (`is_synthetic:1`, consent name "AI-generated face, no real person").
  6. Insert all rows.
  7. Insert 8 past sessions with realistic summaries and transcripts, including one boo-boo flag.
  8. `PUT /api/admin/seed`.

- [ ] **Step 1:** Write failing tests:
  - a demo user DELETE child → `DEMO_READ_ONLY`
  - a demo user PUT plan → 200
  - `resetDemoWorld` removes a judge-created session and restores an edited plan
  - the admin routes without a token → 401
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Run `pnpm seed` against the remote environment (after Task 26's first deploy; re-run as needed). Show the contact sheet to the user.
- [ ] **Step 4:** Commit with message `feat(api): demo world + judge access`.

---

## Phase 2: App

### Task 16: Design system

**Files:**
- Create: `apps/mobile/tailwind.config.ts`, `src/theme/{tokens.ts,motion.ts,global.css}`, `src/ui/*.tsx` (list in File Structure), `src/features/dev/Gallery.tsx`
- Test: `apps/mobile/test/ui.test.tsx`

**Interfaces:**
- Produces:
  - `<Button variant="sun|coral|white|ghost" size="lg|md|sm" loading? icon? haptic?>`. Loading shows a spinner and disables the button; the press runs the spring from `motion.press`.
  - `<Chip selected? tone? onRemove?>`
  - `<Card tone="white|sun|mint|sky|flag" lift?>`
  - `<Segmented options value onChange>`
  - `<Sheet open onClose title>`, a bottom sheet with drag-to-close and the back button closing it
  - `<Screen title? back? actions? bg="cream|sunGradient" padded>`, with safe areas
  - `<TabBar items>`
  - `<EmptyState asset title body action?>`
  - `<Skeleton shape>`
  - `toast.success|error(msg)`
  - `<Illustration asset size>`, which reads the manifest
  - `<Avatar src|emoji size ring?>`
  - `<Badge tone>`
  - `<Field label hint error>`
- Produces: `motion.ts` presets `press`, `pop`, `slideUp`, `stagger`, `confetti`.
- Fonts: `@fontsource/fredoka/{400,500,600,700}.css`.

- [ ] **Step 1:** Write failing tests:
  - a loading `Button` is disabled and has `aria-busy`
  - `EmptyState` renders the asset's alt text and the action
  - `Segmented` calls `onChange` with the value
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Build `/dev/gallery` (only when `import.meta.env.DEV`) showing every component and asset. Compare it visually against `key-screens.html` in the browser preview.
- [ ] **Step 4:** Commit with message `feat(mobile): design system`.

### Task 17: App shell, API client, roles, native behaviors

**Files:**
- Create: `src/{main.tsx,App.tsx,router.tsx}`, `src/lib/{api.ts,queries.ts,role.ts,native.ts,storage.ts}`
- Test: `apps/mobile/test/role.test.ts`, `apps/mobile/test/api.test.ts`

**Interfaces:**
- Produces: `api<T>(path, init?)`. It adds the `Authorization: Bearer ${await getToken()}` header and the `X-Acting-Token` header from storage, and throws `ApiError {code, message, status}`.
- Produces: `friendlyMessage(code): string`, which maps each error code to house-style copy:
  - `AVATARS_BUSY` → "All our avatars are busy hugging. Try again in a minute 💛"
  - `RESTING` → "EverThere is taking a little rest. Please try again soon."
- Produces: query hooks `useMe`, `useChildren`, `useAvatar`, `usePlan`, `useSessions`, `useSession`, `useAlerts`, `useRoster`, `useDashboard`, `useCaregivers`. Each later task adds its own hooks to `queries.ts`.
- Produces in `role.ts`:
  - `availableRoles(me): ('parent'|'admin'|'caregiver')[]`
  - `homeFor(me, preferred?)`, which returns `'/parent'|'/admin'|'/caregiver'|'/onboarding'`

  When there are several roles and no preference, the order is caregiver (on a registered device) > admin > parent > onboarding. The preference is stored in Preferences.
- Produces in `native.ts`:
  - back button: closes the top sheet, otherwise navigates back, otherwise exits on root
  - status bar color per screen background
  - keyboard resize mode
  - haptics helper
  - `useAppPause(cb)`
  - offline banner via `navigator.onLine` plus a failed-fetch signal
- Produces: the root error boundary, with an illustrated "Oops" screen and a retry.
- Produces: `<ProfileSheet>`, opened from the avatar in every top bar. It has name, sign out, and a **role switcher** that appears only when `availableRoles(me).length > 1`. Switching saves the preference and navigates with `homeFor`.

- [ ] **Step 1:** Write failing tests:
  - `homeFor` for: a new user → `/onboarding`; parent only; admin and parent with no preference → `/admin`; a device registered as a caregiver → `/caregiver`
  - `api` maps a 503 `{error:{code:'AVATARS_BUSY'}}` to an `ApiError` with that code
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(mobile): shell, api, roles, native`.

### Task 18: Onboarding, auth, join, try-the-demo

**Files:**
- Create: `src/features/onboarding/{Welcome.tsx,SignUp.tsx,SignIn.tsx,ForgotPassword.tsx,ParentStart.tsx,DaycareStart.tsx,Join.tsx,TryDemoSheet.tsx}`
- Test: `apps/mobile/test/join.test.tsx`

**Interfaces:**
- Consumes: Clerk `useSignUp` and `useSignIn` (headless forms only, per the Task 4 decision), `POST /api/families`, `POST /api/orgs`, `POST /api/invites/peek|redeem`, `POST /api/demo/sign-in`.
- Screens:
  - **Welcome:** matches mockup 1, using the `onboarding.hero` asset.
  - **Parent door:** sign up → family created → "Add your first child" → straight into avatar setup.
  - **Daycare door:** sign up → daycare profile (name, address, timezone defaulting to the device's) → first classroom (emblem picker from the `classroom.*` assets) → admin home.
  - **Join:** 6 boxes for the code that auto-advance and accept paste. Peek shows "Little Acorns invited you to join as a teacher" with an illustration.
    - staff → set a 4-digit PIN (enter twice)
    - parent enrollment → "Is this one of your children?" with the existing children or "Add Mia as new"
    - Then redeem and route to `homeFor`.
  - **TryDemoSheet:** "Peek as a Parent 👩‍👧" / "Peek as a Teacher 🍎". It gets a ticket and runs `signIn.create({strategy:'ticket'})`. For the teacher persona it also registers the device.
  - Email verification codes use Clerk's email code step on a styled 6-box screen.

- [ ] **Step 1:** Write failing tests for Join:
  - pasting "abc234" fills the boxes uppercase
  - peek type `staff` shows the PIN step
  - a mismatched PIN confirmation shows the error "PINs don't match"
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Device check: the full sign-up through both doors, and the demo sheet signs in as the parent and as the teacher.
- [ ] **Step 4:** Commit with message `feat(mobile): onboarding, auth, join, demo`.

### Task 19: Live session (shared by test calls and caregiver sessions)

**Files:**
- Create: `src/live/{sessionMachine.ts,useNapsterSession.ts,LiveSession.tsx}`
- Test: `apps/mobile/test/sessionMachine.test.ts`

**Interfaces:**
- Consumes: `docs/notes/napster-events.md` (event and command shapes), `GET /api/sessions/:id/context`, `POST /api/sessions/:id/{flags,end}`.
- Produces: `sessionMachine`, a pure reducer.
  - States: `idle → connecting → live → ending → ended`, plus `failed`.
  - Events: `START`, `AVATAR_READY`, `CAPTION {role,text}`, `FLAG {category,quote,severity}`, `WARN_TIME`, `CONNECTION_WARNING`, `END_REQUESTED`, `ENDED`, `ERROR {code}`.
  - Context: `{sessionId?, startedAt?, captions:{role,text}[] (last 2 shown), flags[], wobbly:boolean, warnShown:boolean}`.
- Produces: `useNapsterSession({ start: () => Promise<{sessionId, token}>, onEnded(sessionId) })`, returning `{state, ctx, begin(), end(), mute(), unmute(), setVolume(v), sayOurSong(lyrics)}`. Behavior:
  - `getToken` passed to `init` calls `start()` exactly once per `begin()`.
  - After `onAvatarReady(true)`, it fetches the context and sends `{type:'send_message', role:'system', trigger_response:false, text}`.
  - It maps `onData` events through the machine.
  - An implicit `flag_concern` call → `POST /flags` with `source:'live'`, then the function output `{ok:true}`.
  - Timers at `LIMITS.sessionWarnMs` and `LIMITS.sessionMaxMs`.
  - `useAppPause` → `end()`.
  - Unmount → `destroy()`.
  - `sayOurSong` sends a system message: "Now gently sing our song '<title>' using these words: <lyrics>" with `trigger_response:true`.
- Produces: `<LiveSession mode="test|child" childName caregiverName parentTitle songTitle? onDone(sessionId)>`, which follows mockup 7 except that the child self-view is removed:
  - a full-bleed avatar container with a sunset gradient
  - a LIVE chip with a timer
  - a "Ms. Jess is with Mia" chip
  - big caption bubbles with an animated swap
  - controls: Mute, Volume (a sheet with a slider), 🎵 Our song (only if a song is set), End 👋, and a ⚑ manual flag (a sheet with category chips and a quote field)
  - the orange flag banner slides down on flag events
  - a wobbly-connection toast
  - an 8-minute gentle notice: "Let's start saying bye-bye soon 💛"
  - a friendly full-screen state for `AVATARS_BUSY` and `RESTING`

- [ ] **Step 1:** Write failing reducer tests:
  - `START` in `connecting` is ignored (Review Focus 1)
  - `AVATAR_READY` → `live` with `startedAt` set
  - `CAPTION` keeps only the last 2
  - `FLAG` appends and sets `bannerUntil`
  - `END_REQUESTED` from `live` → `ending`, and from `idle` is ignored
  - `ERROR{AVATARS_BUSY}` → `failed` with the code
- [ ] **Step 2:** Run → FAIL. Implement the reducer. Run → PASS.
- [ ] **Step 3:** Implement the hook and the component.
- [ ] **Step 4:** Device check:
  - a test call works end to end
  - backgrounding the app ends the session, and the API shows `ended_at` (Review Focus 2)
  - a spoken "my knee hurts" shows the banner and creates a flag row
- [ ] **Step 5:** Commit with message `feat(mobile): live session`.

### Task 20: Parent: children and My Avatar setup

**Files:**
- Create: `src/features/parent/{ParentHome.tsx,ChildForm.tsx}`, `src/features/avatar/{AvatarSetup.tsx,PhotoStep.tsx,VoiceStep.tsx,ConsentStep.tsx,Creating.tsx,TestAndApprove.tsx,MyAvatar.tsx}`, `src/lib/image.ts`
- Test: `apps/mobile/test/image.test.ts`

**Interfaces:**
- Produces in `image.ts`:
  - `toNapsterFrame(src: ImageBitmap|HTMLImageElement): Promise<Blob>`. It outputs a 1920×1080 JPEG at quality 0.85. The photo is scaled to fit inside the frame and centered. If the source isn't 16:9, the sides or bars are filled with the same photo scaled to cover the frame and blurred (24px).
  - `meanLuma(imageData): number`
  - `lightingVerdict(luma): 'dark'|'good'|'bright'`, where `good` is 70–210
  - `downscaleForUpload(file, maxEdge=1600)` for child photos
- Screens:
  - **ParentHome:** mockup 1 of the style sheet. Greeting, child cards with avatar status, today's note card, latest session card, and the tab bar (Home · My Avatar · Sessions · Caregivers). If both parents have avatars, the child card shows both.
  - **PhotoStep:** mockup 2.
    - `getUserMedia` front camera in the WebView, with the dashed head-and-shoulders overlay.
    - Live lighting chip every 500 ms.
    - Shutter → preview with "Use this" / "Retake".
    - Gallery picker via `@capacitor/camera`.
    - Falls back to `Camera.getPhoto` if `getUserMedia` throws.
  - **VoiceStep:** 10 voice cards with a play button for the bundled `voices/*.m4a`, plus the "Record your real voice: coming soon" teaser card (sticker art, lilac).
  - **ConsentStep:** full legal name and the checkbox with the spec §7 wording.
  - **Creating:** the looped `moments.creating*` animation with rotating playful lines. It polls `GET /api/avatars/:id` every 4 seconds and moves on when `ready`. On `failed` it shows a friendly retry.
  - **TestAndApprove:** `LiveSession mode="test"`, then "How did that feel?" → **Approve my avatar 💛** (confetti `moments.approved`) / "Retake photo" / "Change voice".
  - **MyAvatar tab:** the status, a photo thumbnail, the voice, and edit actions. Edits warn: "Changing this means you'll test and approve again."

- [ ] **Step 1:** Write failing tests:
  - `toNapsterFrame` on a 3024×4032 portrait → a 1920×1080 blob (Review Focus 3)
  - `lightingVerdict(40)` = `dark`, `(140)` = `good`, `(230)` = `bright`
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Device check: the full setup with a real photo → an approved avatar.
- [ ] **Step 4:** Commit with message `feat(mobile): parent home + avatar setup`.

### Task 21: Comfort plan and Today note

**Files:**
- Create: `src/features/plan/{ComfortPlan.tsx,ChipInput.tsx,TodayNoteSheet.tsx,LockedRules.tsx}`
- Test: `apps/mobile/test/chipInput.test.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/children/:childId/plans/:avatarId` and `PlanBody`.
- **ComfortPlan:** follows mockup 3 with these sections:
  - "Mia calls me" (single chip, suggestions Mommy, Mama, Mom, Daddy, Dada, Papa)
  - "I call her" (chips)
  - Tone (`Segmented`: 😌 Calm / 🎈 Playful / 🌙 Soothing)
  - Favorite things (chips with sticker suggestions: Bunny, Dinos, Trucks, Princesses, Bubbles)
  - Comfort phrases (chips)
  - Our song (title plus an optional lyrics textarea)
  - Never talk about (coral chips)
  - The `LockedRules` lilac card with a lock
  - Sticky "Save" with a toast. "Try a test call" deep-links to test-and-approve.
- **TodayNoteSheet:** reachable from ParentHome. One line, with quick suggestions ("Grandma picks up today", "Daddy picks up today", "Pajama day!"), and "Clears at midnight."
- **ChipInput:** Enter or comma adds a chip; it trims, de-dupes case-insensitively, and allows at most 12 chips of 40 characters each.

- [ ] **Step 1:** Write failing tests:
  - typing "Sunshine," adds a chip
  - adding a duplicate "sunshine" is ignored
  - a 13th chip is blocked with the hint "That's plenty!"
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(mobile): comfort plan + today note`.

### Task 22: Caregivers and family

**Files:**
- Create: `src/features/caregivers/{CaregiversTab.tsx,InviteSheet.tsx,CaregiverRow.tsx}`
- Test: `apps/mobile/test/inviteSheet.test.tsx`

**Interfaces:**
- Consumes: the caregivers routes from Task 9, and `POST /api/invites` for `co_parent` and `home_caregiver`.
- **CaregiversTab:**
  - A daycare card if enrolled: org logo, classroom emblem, teacher avatars, and a "Daycare can read full conversations" toggle (default off).
  - Home caregivers list, each with a "Can read full conversations" toggle and Remove (with a confirm sheet).
  - "Invite a nanny or grandparent 👵" and "Invite co-parent 💑".
  - The empty state uses `empty.noCaregivers`.
- **InviteSheet:** choose the children (for a nanny), generate a code, then a big code display, "Share" (Capacitor Share: "Join me on EverThere to comfort Mia 💛 Code: ABC234"), and a copy button. It shows the expiry ("Good for 7 days").

- [ ] **Step 1:** Write a failing test: the nanny invite sheet won't generate until at least 1 child is selected.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(mobile): caregivers + invites`.

### Task 23: Sessions feed, detail, alerts

**Files:**
- Create: `src/features/sessions/{SessionsTab.tsx,SessionCard.tsx,SessionDetail.tsx,Transcript.tsx}`, `src/features/alerts/AlertsScreen.tsx`, `src/lib/alertsPoller.ts`
- Test: `apps/mobile/test/sessionCard.test.tsx`, `apps/mobile/test/alertsPoller.test.ts`

**Interfaces:**
- **SessionCard:** mockup 4 header.
  - Mood is `moodBefore` (taken from the reason: 🥺 😴 😟 🤕) → `moodAfter` (😊 / 😐 / 😢). `mood_signal` is shown only when there's no check-in.
  - Title from mood: "Mia felt better 💛" / "Mia's still a little sad" / "Mia had a hard time".
  - Plus reason, length, caregiver, and the 2-line summary.
  - A pending summary shows "Writing your summary…" with a shimmer.
- **SessionDetail:**
  - flags first (orange `Card tone="flag"`)
  - the caregiver note
  - the transcript as chat bubbles (avatar left, child right), or, without access, "Full conversation is private to Mia's parents"
- **SessionsTab:** grouped Today / Yesterday / date, with infinite scroll, pull to refresh, and the `empty.noSessions` empty state.
- **alertsPoller:** polls `GET /api/alerts?unread=1` every 30 seconds in the foreground and on resume. New IDs become a `@capacitor/local-notifications` notification (title and body from the alert) plus a bell badge. Tapping it deep-links to the session.
- **AlertsScreen:** a list with icons by kind, and "Mark all read".

- [ ] **Step 1:** Write failing tests:
  - a card with `moodAfter:'calmer'` shows "felt better"
  - a card with no summary shows the pending state
  - the poller notifies only IDs not seen before (Review Focus 5 on the client)
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(mobile): sessions + alerts`.

### Task 24: Caregiver experience (teacher on a tablet, nanny on a phone)

**Files:**
- Create: `src/features/caregiver/{Roster.tsx,ChildTile.tsx,AvatarPicker.tsx,ReasonSheet.tsx,CaregiverSession.tsx,CheckIn.tsx,SwitchTeacher.tsx}`
- Test: `apps/mobile/test/roster.test.tsx`

**Interfaces:**
- Consumes: `GET /api/orgs/:id/roster` (teacher or admin), children through `caregiverChildIds` exposed as `GET /api/caregiver/children` (add the route in `routes/caregivers.ts`, with a test in Task 9's file), `POST /api/sessions`, `POST /api/sessions/:id/checkin`, and the acting routes.
- **Roster:**
  - Mockup 5 layout. Responsive grid: 4 columns on a tablet in landscape, 2 on a phone.
  - Header with the classroom emblem asset, the org name, the date, and the "Ms. Jess · Switch" chip (shown when the device is registered).
  - Tiles with photo or illustration, name, and a status badge. Disabled tiles explain why on tap ("Mia's mom is still setting up").
- **AvatarPicker:** a sheet shown when a child has 2 ready avatars ("Call Mommy" / "Call Daddy").
- **ReasonSheet:** mockup 6, with the reason stickers from the assets and the CTA "💛 Call Mom's avatar".
- **CaregiverSession:** `LiveSession mode="child"`, then CheckIn.
- **CheckIn:** mockup 8: Calmer / Same / Still upset, an optional note, and "Send to Sarah 💌", with the `moments.checkin` celebration.
- **SwitchTeacher:** staff avatars, then a PIN pad (big round keys, shake on error), plus the lock message for `PIN_LOCKED`. On first staff sign-in on a tablet, the app asks "Is this a shared classroom tablet?" and registers the device if yes.
- Nanny view: the same Roster with the header "Leo & friends" and no switch chip.

- [ ] **Step 1:** Write failing tests:
  - a tile with status `setup_pending` isn't startable and shows the reason
  - a child with 2 ready avatars opens AvatarPicker
  - one ready avatar goes straight to ReasonSheet
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Device check on the tablet: switch teacher with the PIN → a session → the check-in is attributed to that teacher in the parent's feed.
- [ ] **Step 4:** Commit with message `feat(mobile): caregiver roster, session, check-in, pin switch`.

### Task 25: Daycare admin

**Files:**
- Create: `src/features/admin/{AdminHome.tsx,Classrooms.tsx,ClassroomEdit.tsx,Staff.tsx,Enrollments.tsx,EnrollSheet.tsx,DaycareProfile.tsx,UsageCard.tsx}`
- Test: `apps/mobile/test/enrollSheet.test.tsx`

**Interfaces:**
- Consumes: the org, classroom, enrollment and dashboard routes from Task 10, and `POST /api/flags/:id/ack`.
- **AdminHome:** sky blob background, with stat stickers ("12 avatars ready", "5 sessions today"), an "Open flags" list with Acknowledge, a recent sessions list (summary visibility per spec), `UsageCard` ("37 sessions this month"), and a display-only billing card ("Families pay $9/mo add-on: billing coming with launch" in teaser style). Tabs: Dashboard · Classrooms · Staff · Enrollments.
- **Classrooms:** emblem grid, create and edit, assign teachers and children.
- **Staff:** a list with PIN status, invite a teacher (InviteSheet variant), and remove.
- **Enrollments:** status chips (Invite sent / Linked / Avatar ready). **EnrollSheet** takes the child's name and a classroom, then shows the code with Share ("Little Acorns invites you to EverThere 💛 Code: …").
- An admin can also open the caregiver Roster through the role switcher.

- [ ] **Step 1:** Write a failing test: EnrollSheet requires a name and a classroom before "Create invite" is enabled.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit with message `feat(mobile): daycare admin`.

---

## Phase 3: Ship

### Task 26: Deploy, Android release, polish audit

**Files:**
- Modify: `apps/api/wrangler.toml` (production values), `apps/mobile/android/**` (icons, splash, permissions, signing config through `gradle.properties` refs, never committed)
- Create: `docs/notes/polish-checklist.md`

- [ ] **Step 1: API deploy.**
  1. `wrangler d1 create everthere` and `wrangler r2 bucket create everthere-media`.
  2. `wrangler d1 migrations apply everthere --remote`.
  3. Set every secret with `wrangler secret put …`; the user enters the values.
  4. `wrangler deploy`.

  Expected: `GET https://<worker>/api/health` → `{ok:true}`.
- [ ] **Step 2: Napster dashboard.** Ask the user to create the webhook to `https://<worker>/api/webhooks/napster` for `session.closed`, `session.started` and `companion.*`, and put the signing secret into `NAPSTER_WEBHOOK_SECRET`. Run one real session and confirm that `verifyNapsterSignature` passes. If the raw-key variant matched, delete the base64 branch, and vice versa.
- [ ] **Step 3:** Run `pnpm seed` (Task 15 step 3).
- [ ] **Step 4: Android release.**
  1. `npx @capacitor/assets generate --android`.
  2. Generate a release keystore. **The user keeps it, outside the repo.**
  3. `pnpm -F mobile build && npx cap sync android && cd android && ./gradlew assembleRelease`.

  Expected: a signed `app-release.apk` that installs on a clean device.
- [ ] **Step 5: Polish audit.** Walk every screen in all three roles on a phone and a tablet. Tick `polish-checklist.md` for each screen:
  - empty, loading and error states
  - no layout shift
  - back button behavior
  - keyboard doesn't cover fields
  - text fits at 1.3× font scale
  - dark status bar contrast
  - airplane-mode banner
  - tap targets ≥ 44px

  Fix everything found, and commit each fix.
- [ ] **Step 6:** Commit with message `chore: production deploy + release build`.

### Task 27: Submission package

**Files:**
- Create: `README.md` (what it is, architecture diagram, how Napster on Azure OpenAI realtime powers it, safety design, demo accounts, build steps), `docs/submission/{demo-script.md,judges.md}`

- [ ] **Step 1:** Write `judges.md`: APK link, "Try the demo" instructions, both personas, what to try (approve flow, live session, say "my knee hurts", see the flag), and the credit-guard note.
- [ ] **Step 2:** Write `demo-script.md`. Storyboard for 2–3 minutes:
  1. Hook: a crying child, a mom in a meeting.
  2. Parent setup in fast-cut.
  3. The teacher on the tablet: reason → live session → the song.
  4. A flag moment.
  5. Mom's phone: summary and transcript.
  6. The nanny path in 10 seconds.
  7. Safety slide.
  8. End card.

  Use the `video.*` title and chapter assets.
- [ ] **Step 3:** Final smoke test on a clean device using only `judges.md`. Everything in it must work as written.
- [ ] **Step 4:** Commit with message `docs: submission package`.
