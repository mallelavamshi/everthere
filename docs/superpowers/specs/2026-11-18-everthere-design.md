# EverThere: Design

**Date:** 2026-11-18
**Status:** Approved by the user on 2026-11-18, with the Meta media changes in §7a
**Event:** Napster × Microsoft Azure Hackathon (with Microsoft Ignite). Submissions are due **Nov 30, 2026**, and winners are announced Dec 9, 2026.
**Mockups:** `.superpowers/brainstorm/1206-1795026861/content/key-screens.html` (approved), with the chosen visual style in `visual-style.html`, option A.

---

## 1. Intent: what this is and why

EverThere lets a parent be there for their young child when they can't be there in person.

The parent turns their photo into a live, talking AI avatar (built on Napster's real-time avatar API) and teaches it how they comfort their child: nicknames, tone, favorite things, songs, and topics to avoid. A caregiver can then open a short live comfort session with "Mom" or "Dad" whenever the child is upset. The caregiver is either a daycare teacher or a nanny or grandparent at home. Afterward the parent gets a summary of how the child is doing, plus any flagged moments.

**Why we're building it:** to win the hackathon with a working, polished Android app. Being a startup comes second. The judges work at Napster and Microsoft. They should see Napster's face, voice and memory used for something emotional and real, with safety designed in from the start. The organizers have confirmed in writing that this concept is allowed, despite the 18+ and minors clauses in Napster's terms.

**Audience:** US working parents aged 22–35, and the daycares and nannies who care for their children.

## 2. Goals, non-goals, anti-goals

### Goals
1. A single Android app (Capacitor) where the home screen depends on who logged in: **Parent**, **Daycare admin**, or **Caregiver** (a teacher or nanny).
2. The full core loop works on a real device, end to end:
   1. A parent signs up, creates an avatar from a photo, writes a comfort plan, runs a test call, and approves the avatar.
   2. A caregiver picks the child, picks a reason, and runs a live session.
   3. The caregiver completes a check-in.
   4. The parent gets an alert, a summary, flags, and the transcript.
3. Both entry paths work:
   - A **daycare** signs up, invites staff, enrolls a child, and invites the parent.
   - A **parent** signs up alone and invites a nanny.
4. The UI looks finished on every screen, with no "coming soon", lorem ipsum, broken states, or raw errors. Every list has an empty state, every async action has a loading state, and every failure has a friendly error state.
5. A demo video (2–3 minutes) and a seeded demo account that tell the story clearly.

### Non-goals (for the hackathon)
- Real payments. Plan and billing screens are display only.
- Voice cloning. The product will use ElevenLabs (or a Napster digital twin) later. The demo uses stock voices, and the voice-sample screen exists but is labeled "Coming soon: your real voice". This is the only "coming soon" allowed, and it's styled as a feature teaser, not a gap.
- Recording session audio or video. "Recorded" means the transcript, AI summary and flags.
- iOS build, web build for end users, multiple languages, analytics for daycare chains.
- A discipline or behavior-correction mode. **Comfort only.**

### Anti-goals (it fails if any of these happen, even if it technically works)
- The avatar scolds, threatens, makes promises ("I'll pick you up at 3"), asks the child to keep secrets, or gives medical advice.
- A child says something concerning and nobody is told.
- One family's data (child, photos, transcripts) is visible to another family, or to a caregiver who isn't connected to that child.
- It looks like a prototype: janky transitions, layouts that shift, default browser styling, or spinners with no context.
- The Napster API key or another secret ships inside the app.

## 3. Constraints

| Constraint | Detail |
|---|---|
| Deadline | 12 days, Nov 18 to Nov 30, 2026 |
| Platform | One Android app built with **Capacitor**. Daycares use a shared classroom **tablet**, and parents and nannies use **phones**. |
| Backend | **Cloudflare Workers** (paid plan, which the user already has), **D1** for data, **R2** for files. **Meta Model API** (`https://api.meta.ai/v1`, OpenAI-compatible; the user provides the key) for generated people and media assets (`muse-image-1.0`) and for summaries (`muse-spark-1.3`). **No Azure and no Firebase accounts** (user decision). |
| Auth | **Clerk** (user decision) |
| Judging | Judges get a **demo video and an installable APK**, and may sign in themselves. The backend must stay live and stable until at least **Dec 9, 2026**. |
| Scope | The user wants the **full scope** built. The cut order in §11 is an emergency fallback only. |
| Avatar | **Napster API**. The team has $150 of credits, about 2,580 minutes at $0.058/min, billed per session and rounded up to the minute. |
| Napster limits | 5 concurrent WebRTC sessions; 1 connection request per second per API key; 3-minute default idle timeout; no latency or maximum session length is documented |
| Napster gaps | No built-in guardrails (prompt-level only); no session audio or video; text transcripts become available after a session closes; Android WebView isn't officially documented |
| Live voices | Only Azure OpenAI, OpenAI or HUMAIN voices work live. **ElevenLabs works only for pre-rendered recordings, not live sessions.** |
| Consent | Napster's terms require written consent to use a real person's likeness. We record explicit consent from the parent in the app. |

## 4. Approaches considered (front end)

The platform was already settled (Capacitor, Workers, D1, R2, Napster). The open choice was how to build the UI.

| Approach | Trade-offs | Decision |
|---|---|---|
| **A · Custom React**: React, Vite, TypeScript, Tailwind themed to the Sunny & Playful style, Framer Motion, and our own small component set | Matches the mockups exactly, and nothing fights the chunky sticker style. Napster has an official React example. We have to build native-feel details ourselves (Android back button, bottom sheets, safe areas). | ✅ **Chosen by the user** |
| B · Ionic React, restyled | Native gestures and transitions for free, but Ionic's default look fights the custom style, so time goes into un-Ionic-ing it | Rejected |
| C · Svelte or Vue with Capacitor | Fine technically, but Napster's examples and most Capacitor examples are React-first. 12 days doesn't leave room for framework detours. | Dropped |

## 5. Decisions made (by the user)

- **One app**, with the home screen based on role. Sign-up offers **"I'm a parent"** or **"I'm a daycare"**, and there's a **"Got an invite code? Join here"** link.
- **Connections model:** there is only one kind of parent. Each child can be connected to:
  - a **daycare**, linked through an enrollment invite. That daycare's teachers become the child's caregivers.
  - **home caregivers**, such as a nanny or grandparent the parent invites.
  - A child can have both, either, or neither. The parent's screens adapt to what exists.
- A parent can register alone (home use) or be invited by a daycare. It's the same account type either way.
- **Shared family account:** a parent can invite a co-parent. Both are full parents of the child, and each can have their own avatar.
- **Comfort only**, with no discipline mode.
- **No "call the real parent first" step.**
- **Session transcripts** are kept, summarized and flagged for parents.
- **Parent-written guardrails** (tone, nicknames, facts, "never talk about") sit on top of locked safety rules. A parent must **approve** the avatar after a test call before caregivers can use it.
- **The daycare charges parents** for the service as an add-on. Parents who sign up alone pay EverThere directly. Neither is implemented for the hackathon (display only).
- **Visual style:** Sunny & Playful, with the Fredoka font, sunny yellow `#FFD23F`, coral `#FF7A59`, mint `#C9F2E1`, ink `#2B2140`, cream `#FFF8EC`, chunky outlined buttons with a hard bottom shadow, and emoji as decoration.
- **Front end:** Custom React (approach A).
- **Voice:** a stock voice for the demo. ElevenLabs cloning is planned for later. (Update 2026-11-20: Mia's Daddy, the maker's own digital twin, already speaks in his cloned voice.)
- **Auth:** Clerk.
- **Accounts:** no Azure or Firebase. Only Napster and Cloudflare are used.
- **Judges:** they receive the APK and the video.
- **Demo parent faces:** all AI-generated, except Mia's Daddy (update 2026-11-20): he is the maker's own Napster digital twin, real face and cloned voice, seeded with `is_synthetic=0` and a self-consent record.

**My calls that follow from those decisions:**
- **Clerk handles identity only.** It covers sign-up, sign-in, password reset, and optionally Google sign-in. All roles, families, daycares, classrooms and connections live in D1, so there's one source of truth for permissions. Clerk Organizations aren't used.
- **Summaries and flag sweeps use the Meta Model API** (`muse-spark-1.3`, chat completions with JSON output), since we already hold that key. Cloudflare Workers AI is the fallback if Meta returns errors.
- **Alerts without Firebase:**
  - an in-app **Alerts** center with a badge,
  - a system notification (Capacitor Local Notifications) whenever the app is open or resumes and finds new alerts,
  - a quick refresh while a parent is looking at the app.
  - **Trade-off:** a parent whose app is fully closed won't get a lock-screen alert until they open it. Real background push requires Firebase Cloud Messaging, which is free and can be added later without redesigning anything.
- **Azure in the story:** Napster's managed tier runs on Azure OpenAI realtime. The submission says so, so the "Azure" part of the hackathon is still covered.

## 6. Roles and permissions

| Role | How they get in | Home screen | Can |
|---|---|---|---|
| **Parent** | Signs up ("I'm a parent") or accepts an invite (from a daycare enrollment or a co-parent) | Children · My Avatar · Sessions · Caregivers | Manage their children, their avatar and comfort plans; approve avatars; invite a co-parent or home caregivers; read sessions, summaries and flags for their children |
| **Daycare admin** | Signs up ("I'm a daycare") | Dashboard · Classrooms · Staff · Enrollments | Manage the daycare profile and classrooms, invite staff, enroll children (which creates a parent invite), see the sessions log and open flags for enrolled children. An admin can also act as a caregiver. |
| **Caregiver** (teacher or nanny) | Accepts an invite from a daycare admin or a parent | Roster → start session | See only the children they're connected to; start sessions only for children with an **approved** avatar; complete check-ins. Reads transcripts only if the parent allows it (on/off per caregiver, off by default for nannies; teachers see summaries and flags). |

**Who can start a session for whom (my call, after the review):**
- A **teacher** can see and start sessions only for children in the classrooms they're assigned to.
- A **daycare admin** can see every enrolled child and can start a session for any of them.
- A **nanny** sees only the children of the family that invited them.

**Who can see transcripts (my call, after the review):**
- **Parents** always see everything for their own children.
- **Daycare staff** see summaries and flags for the children they're allowed to see. Full transcripts are off by default. The parent can turn them on **for the whole daycare**; this is stored on the daycare connection.
- **Home caregivers** see summaries and flags. The parent can turn full transcripts on **for each caregiver**; this is stored on that caregiver's connection.

A person can hold more than one role (for example, a teacher who is also a parent). The profile menu then shows a **role switcher**.

**Every permission is enforced on the server** for each request, never just by hiding things in the UI.

**Shared classroom tablet:** a teacher signs in once on the tablet. The device is then remembered as belonging to that daycare. "Switch teacher" shows that daycare's staff, and each teacher enters a **4-digit PIN** they set when accepting the invite. PIN switching only works on a device already signed in to that daycare. Sessions are attributed to whichever teacher is active.

## 7. Features

**Must** = needed for the demo. **Nice** = only if time allows.

### Onboarding and accounts
- **Must:** Welcome screen (mockup 1). Clerk email-and-password sign-up and sign-in, plus forgot password, styled to the house look with Clerk's appearance settings or our own forms on Clerk's API. "I'm a parent" / "I'm a daycare" / "Join with invite code".
- **Must:** Invite codes: 6 characters, single use, with expiry. Each invite carries its type: staff, parent-enrollment, co-parent, or home caregiver. Codes can be shared as a link or text.
- **Must:** Child profile with name, photo, birthday, and optional "what they call you" (Mommy, Daddy, Mama…).

### Parent: My Avatar
- **Must:** 3-step setup (mockup 2):
  1. **Photo:** in-app camera with a waist-up guide, or choose from gallery. The app crops to 16:9 and runs quality checks. A basic brightness check is required, and face-centered detection is nice to have.
  2. **Voice:** pick one of the stock Azure OpenAI voices (alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar), each with a preview clip. Below it, a "Record your real voice: coming soon" teaser card.
  3. **Consent:** the parent types their full legal name and ticks a box confirming the avatar is AI and that they consent to their likeness being used for comforting their child. Stored with a timestamp.
- **Must:** Friendly "Creating your avatar…" progress state. Creating the avatar on Napster takes time, so the screen polls and shows a playful animation.
- **Must:** **Test call:** the parent talks to their own avatar on the same live session screen the caregivers use, then taps **Approve**. Until a parent approves, caregivers can't start sessions with that avatar ("Setup pending" badge, as in mockup 5).
- **Must:** Re-take the photo or change the voice. Either one clears the approval.

### Parent: Comfort plan (per child, per parent avatar; mockup 3)
- **Must:**
  - Names: what the child calls the parent, and the parent's nicknames for the child.
  - Tone: Calm / Playful / Soothing.
  - Favorite things (toys, characters, stories, songs).
  - Comfort phrases, such as "remember our bedtime song".
  - Song lyrics (one optional song).
  - "Never talk about" list.
  - A **Today note** ("Grandma picks up today"), which expires automatically at midnight in the child's timezone.
- **Must:** The locked safety rules are always shown and can't be changed (§9).

### Parent: Caregivers
- **Must:** List the child's connections: the daycare (if enrolled) with its teachers, and home caregivers.
- **Must:** Invite a home caregiver. Per-caregiver transcript access can be switched on or off. Remove a caregiver.
- **Must:** Invite a co-parent.

### Parent: Sessions and alerts
- **Must:** Session feed (mockup 4). Each entry shows the date and time, length, reason, caregiver, mood before and after, a 2-line AI summary, flags, and the transcript.
- **Must:** Alerts, without Firebase (§5):
  - "Session summary ready", sent when a session's summary is ready.
  - "⚑ Heads up", sent when something is flagged.
  - Both appear in the in-app Alerts center, and as a system notification whenever the app is open or resumes.
- **Nice:** Weekly insight card.

### Caregiver: Roster and session
- **Must:** Roster (mockup 5). Child tiles show a status badge (avatar ready / setup pending / invite sent). A teacher sees their classroom, and a nanny sees the family's children.
- **Must:** When a child has two approved parent avatars, the caregiver picks which one ("Call Mom" / "Call Dad").
- **Must:** Reason picker (mockup 6): **Missing parent**, **Upset at nap**, **New & nervous**, **Got a boo-boo**.
- **Must:** Live session (mockup 7):
  - Full-screen avatar video, live captions, LIVE timer, and a "[Caregiver] is with [Child]" badge.
  - Controls: Mute, Volume, **End**.
  - An orange flag banner slides down when the avatar flags a concern. The caregiver can also flag something manually.
  - A soft cap at 10 minutes: at 8 minutes a gentle notice appears, and the session ends at 10.
- **Must:** "🎵 Our song" button. It asks the avatar to sing or say the parent's saved song by injecting a system message. It isn't word-for-word, and that's acceptable (§10).
- **Must:** Check-in after the session (mockup 8): Calmer / Same / Still upset, an optional note, then **Send to [Parent]**.

### Daycare admin
- **Must:** Daycare profile (name, logo, address, timezone).
- **Must:** Classrooms: create a classroom and assign teachers and children.
- **Must:** Staff: invite and remove teachers, and see each teacher's PIN status.
- **Must:** Enrollments: add a child (name and classroom), which creates a parent invite. Shows invite status.
- **Must:** Dashboard: children with approved avatars, today's sessions, open flags (each with an "Acknowledge" action).
- **Nice:** Usage card ("37 sessions this month") and a display-only billing card.

### Cross-cutting
- **Must:** Empty, loading and error states for every screen, all in the house style.
- **Must:** Android back button behavior, safe-area padding, keyboard-aware forms, and a pull-to-refresh pattern for the feeds.
- **Must:** Offline and no-network banner. The live session shows a friendly "Connection's wobbly…" message on WebRTC warnings, and recovers or ends cleanly.
- **Must:** A **seeded demo world**:
  - Little Acorns Daycare with its Butterflies Room.
  - Ms. Jess, a teacher.
  - Sarah (Mia's mom) and her partner.
  - Leo's dad, who signed up alone and has a nanny.
  - Past sessions with summaries.
  - All parent faces are **AI-generated** (except Mia's Daddy since 2026-11-20, the maker's own digital twin; see §5): the seed script makes photorealistic, waist-up 16:9 portraits with Meta's `muse-image-1.0` (§7a), stores them in R2, and creates real Napster companions and agents from them. Each is marked `is_synthetic`, and the consent step is recorded as "AI-generated face, no real person".
- **Must:** **Judge access** (§8a): demo accounts listed in the submission, plus a "Try the demo" path.

## 7a. Media assets (user decision: high quality, no compromise; generated with Meta)

All visual assets are generated with **Meta `muse-image-1.0`** using the user's Meta API key. It costs $0.01 per image with a limit of 150 requests per minute, so generating hundreds of candidates is cheap.

Assets are generated **offline by a script** (`scripts/generate-assets`) and then hand-curated. They're optimized (WebP, Android densities, mipmaps for the app icon) and committed to the repo, so the app never generates art at runtime. The only runtime image generation is in the seed script, for demo parents.

**Art bible:** one shared style prompt, so every asset looks like one family.
- "Warm, joyful **3D clay-toy illustration**, soft studio lighting, rounded chunky forms, gentle subsurface glow."
- Palette locked to the design tokens: sun `#FFD23F`, coral `#FF7A59`, mint `#C9F2E1`, lilac `#E7DEFF`, sky `#CFE6FF`, ink `#2B2140`, on cream `#FFF8EC` or a transparent background.
- One approved hero image is passed as a style reference (through `/v1/images/edits` with reference images) for every later asset.

**Asset list**

| Group | Assets |
|---|---|
| Brand | App icon (adaptive foreground and background), splash, wordmark lockup, Play Store feature graphic, submission cover image |
| Onboarding | Welcome hero (parent and child hugging), "I'm a parent" and "I'm a daycare" door illustrations, invite-code illustration, 3 avatar-setup step illustrations (photo, voice, consent) |
| Moments | "Creating your avatar…" loop (4–6 frames for a gentle animation), test-call celebration, avatar-approved confetti scene, session check-in celebration, "Mia felt better" sticker |
| Reason picker | 4 illustrated stickers: missing parent, upset at nap, new and nervous, got a boo-boo |
| Empty states | No children yet, no sessions yet, no caregivers yet, no alerts, no classrooms or staff (admin), roster empty, offline or connection wobbly, "avatars are busy", "EverThere is resting" (credit guard), generic error |
| Decorative | Sticker set (stars, rainbow, bunny, dino, moon, heart, sun, cloud) for comfort-plan chips and backgrounds; soft blob backgrounds per role (parent: sun, admin: sky, caregiver: mint) |
| Classroom | Room emblems for common daycare names: butterflies, bees, ladybugs, owls, turtles, rainbows, stars, sunflowers |
| Demo people | **Parents: photorealistic** waist-up 16:9 portraits for Napster, of varied ethnicities, warm natural light, friendly expression, casual work clothes. **Children:** **illustrated** 3D clay-toy portraits in the art-bible style, not photoreal. **Staff and nanny:** photorealistic profile pictures. **Daycare:** generated logo for "Little Acorns". |
| Video | Title card, end card, chapter cards for the demo video |

**Children are illustrated, not photoreal** (my call). This matches the playful look, keeps the roster friendly, and avoids generating photoreal minors. The live avatars are always the parents, and those are photoreal.

## 8. Architecture

```
Android app (Capacitor + React)
   │  HTTPS (Clerk bearer JWT)                 WebRTC (avatar video + child's mic audio)
   ▼                                              ▲
Cloudflare Worker (Hono API)  ──mint token──►  Napster API  ──webhook──► Worker
   │        │                                     ▲
   │        └── R2 (photos)  ◄── signed URL ──────┘ (Napster fetches pictureUrl)
   ├── D1 (all app data)
   ├── Meta Model API (muse-spark: summaries + flag sweep; muse-image: demo faces, offline asset generation)
   ├── Cron Trigger (summary sweep, Today-note expiry, credit guard)
   └── Clerk (identity; Worker verifies Clerk session JWTs)
```

### App
React 18, Vite, TypeScript, Tailwind (theme tokens from §5), Framer Motion, TanStack Query (server state), and React Router.

Capacitor plugins:
- Camera
- Local Notifications (alerts without Firebase)
- Preferences (device and role memory)
- App (back button)
- Haptics (for nice button feedback)
- Status Bar
- Keyboard
- Splash Screen

Napster Web SDK: `@touchcastllc/napster-companion-api@2`, with `@reduxjs/toolkit` as a peer dependency, mounted inline in the session screen.

### API
A Hono app on Workers, using Drizzle ORM with D1, Clerk (`@clerk/clerk-react` in the app; `@clerk/backend` in the Worker to verify the session JWT on every request), Zod for validation, and the OpenAI SDK pointed at the Meta Model API. Secrets are stored as Worker secrets: the Napster key, the Napster webhook secret, the Clerk secret key, and the Meta API key. For local scripts, keys live in a git-ignored `.env`. Keys are never pasted into chat or committed.

On first sign-in, the Worker creates the user's D1 `user` row, keyed by Clerk user ID. Roles come from D1, never from Clerk metadata.

### Live session flow
1. The caregiver picks a child, an avatar and a reason. The app calls `POST /api/sessions`. The Worker:
   1. Checks that the caregiver is connected to the child and that the avatar is approved.
   2. Calls Napster `POST /public/agents/{agentId}/connections` with:
      - `channelType: "webrtc"`
      - `externalClientId`: the child's ID. Napster's memory is keyed by companion plus client ID, so each parent avatar remembers each child.
      - `externalClientProfile`: a compact comfort plan plus today's note.
      - `initialSpeech`: built from the reason and nicknames.
      - `tags`: `{ childId, caregiverId, reason }`.
   3. Stores a `session` row with Napster's `connection.id` and returns a token.
2. The app calls `NapsterCompanionApiSdk.init(getToken, { layout: inline })` and waits for `onAvatarReady(true)`. **The child's camera is never sent to Napster** (my call, after the review). Sessions send the mic only, with `videoPolicy: "deferred"` and video never started. The small self-view in mockup 7 is dropped, so no camera permission is needed for sessions. Only the parent's avatar photo step uses the camera.
3. **Flagging during a session:** the agent has an **implicit** tool `flag_concern(category, quote, severity)`. Napster delivers the call to the app through `onData`. The app:
   1. shows the banner,
   2. calls `POST /api/sessions/:id/flags`, and the Worker creates an alert for the parents right away,
   3. returns `send_function_output`.
   The implicit flow avoids building a real-time channel from the Worker to the tablet.
4. Ending a session: the app calls `instance.destroy()`, then `POST /api/sessions/:id/end`, and the Worker calls `DELETE /public/connections/{id}` to be safe. Then the check-in screen appears.
5. Napster sends a `session.closed` webhook to `POST /api/webhooks/napster`. The Worker:
   1. verifies the HMAC signature and dedupes on `eventId`;
   2. fetches `GET /public/sessions/{id}` for the transcript and cost;
   3. calls the Meta Model API (`muse-spark-1.3`) for a 2-line summary, a mood signal, and any flags the live tool missed;
   4. stores the results and creates the "summary ready" alert for the parents.
   If the webhook doesn't arrive within about 2 minutes, a Cron Trigger sweep picks up unsummarized sessions.

### Napster resources (one per parent avatar)
- **Companion:** created with `POST /public/companions`, using `pictureUrl` (a signed, short-lived R2 URL served by the Worker), `description` (the base persona), `firstName`, `gender`, `ethnicity`, `version: "v1"`.
- **Agent:** created with `POST /public/agents`, using `companionId`, `voiceId`, `language: "en"`, `providerSettings.instructions` (the system prompt from §9) with `temperature` around 0.6, `functions: [flag_concern]`, and `mode: "conversation"`.
- When the comfort plan changes, the Worker regenerates the instructions and `PATCH`es the agent. A parent with two children has one agent. The per-child plan is passed per session through `externalClientProfile` and `initialSpeech`.

### Data model (D1, sketch)
Clerk owns credentials. D1 has:
- `user` (id = Clerk user ID, name, email, avatar_emoji, created_at)
- `org` (daycare: id, name, logo_key, address, timezone)
- `org_member` (org_id, user_id, role: admin|teacher)

App tables:
- `family` (id)
- `family_member` (family_id, user_id, role: parent)
- `child` (id, family_id, name, photo_key, birthday, timezone)
- `avatar` (id, user_id, napster_companion_id, napster_agent_id, voice_id, photo_key, status: creating|ready|approved|failed, approved_at, consent_name, consent_at)
- `comfort_plan` (child_id, avatar_id, parent_title, nicknames json, tone, favorites json, phrases json, song_title, song_lyrics, never_topics json, today_note, today_note_expires_at)
- `connection` (child_id, kind: daycare|home, org_id nullable, caregiver_user_id nullable, transcript_access bool)
- `classroom` (id, org_id, name, emoji)
- `classroom_child`
- `classroom_staff`
- `staff_pin` (user_id, org_id, pin_hash)
- `invite_code` (code, type, payload json, created_by, expires_at, used_by, used_at)
- `comfort_session` (id, napster_session_id, child_id, avatar_id, caregiver_user_id, org_id nullable, reason, started_at, ended_at, duration_s, cost_usd, mood_after, caregiver_note, summary, mood_signal, status)
- `session_flag` (id, session_id, source: live|post, category, quote, severity, created_at, acknowledged_by, acknowledged_at)
- `alert` (id, user_id, kind: summary|flag|invite|avatar_ready, ref_id, title, body, read_at, created_at)
- `usage_ledger` (day, minutes, cost_usd), used by the credit guard
- `webhook_event` (event_id primary key)

### Files (R2)
- Avatar source photos and child photos, under keys per family.
- Never public. The Worker serves them through short-lived signed URLs: to the app for display, and to Napster for `pictureUrl`.

## 8a. Judge access and credit guard (my calls)

Judges install the APK and may sign in themselves, so:

**Demo accounts**
- The submission lists two ready-made accounts: **Parent (Sarah)** and **Teacher (Ms. Jess, Little Acorns)**. Both are already set up and seeded.
- The welcome screen has a small **"Try the demo"** link that opens a sheet with those two choices. It signs in with the demo credentials, which live only in our backend, through a Clerk sign-in token minted by the Worker, so no password ships in the app.
- Demo accounts can't change their name, delete data, or remove avatars. Their writes still work, so a judge can edit the comfort plan, run sessions and do check-ins.
- A nightly Cron job resets the demo world so every judge sees it fresh.

**Judges can also sign up for real.** They can make their own avatar from their own photo. The consent step applies to them like any user.

**Credit guard**
- The Worker tracks minutes and cost from `session.closed`.
- New sessions are refused, with a friendly "EverThere is resting, try again soon" message, once spending passes a configurable cap (default **$120 total**, leaving $30 for our own demo recording).
- There's also a per-user limit of 20 sessions a day.
- The guard can be checked and adjusted from an admin-only endpoint.

**Uptime**
- Napster's limit of 5 concurrent sessions gets a friendly busy state (§10).
- No auto-deleting of resources before Dec 10.

## 9. Safety design (the guardrails)

1. **System prompt template**, generated on the server. The parent never edits raw prompt text. It contains:
   - **Identity:** "You are [Parent]'s comforting presence for their young child [Child], [age]. You speak like [Parent]: [tone]. Keep sentences short and simple for a [age]-year-old."
   - **Locked rules**, which always come first and can't be changed:
     - Never promise times or events.
     - Never ask the child to keep secrets or hide things from the teacher or caregiver.
     - Never scold, threaten or shame.
     - Never give medical advice or diagnose. If the child mentions pain, injury, illness, being hit, being scared of a person, or anything unsafe, respond warmly, tell them to show the grown-up who is with them, and **call `flag_concern`**.
     - Never say you are physically coming.
     - If asked, say you are a "video helper Mommy/Daddy made for you".
     - No other topics beyond comforting, playing, singing and gentle stories.
   - **Parent plan:** names, favorites, phrases, song, "never talk about", today's note.
2. **Session limits:** 10-minute cap, and a caregiver is always present (badge shown). Sessions can't be started from a parent's account for a child. Parents can only run test calls with themselves.
3. **Flags:** live tool calls plus a sweep of the transcript after the session. Parents are notified right away.
4. **Before any child session:** the parent's test call and approval.
5. **Privacy:**
   - Transcripts are visible to the child's parents, and to caregivers only as the parent allows.
   - The daycare sees summaries and flags for enrolled children.
   - Deleting a child deletes their sessions (including Napster's `DELETE /public/sessions/{id}`).

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The Napster Web SDK doesn't work in Capacitor's Android WebView (mic/camera permissions, WebRTC) | **Day 1 spike** on a real Android device before any UI work. Fallback: open the session in a Chrome Custom Tab, or wrap it in a fullscreen WebView configured for permissions. |
| Avatar generation from a photo is slow or fails | Show progress states. Keep a stock-avatar fallback and a pre-generated demo avatar for the video. |
| The model ignores a locked rule | Strong prompt, flag sweep afterward, test calls during development with an adversarial "child" script. The demo uses rehearsed conversations. |
| "Our song" isn't sung word for word | Accepted. Puppeteer mode (verbatim) needs a different API key type and can't be switched mid-session. Marked as later. |
| Running out of credits | About 2,580 minutes is plenty. Sessions are capped at 10 minutes, and the dashboard tracks cost from the `cost` field. |
| 5 concurrent sessions | Fine for the demo. The API returns a friendly "All avatars are busy, try in a minute" message on a 409. |
| Clerk inside the Capacitor Android WebView (origin `https://localhost`, cookies, redirects) | Check it in the **day-1 spike** alongside Napster. Fallback: Clerk's token-based flow with our own sign-in forms on Clerk's API, so no hosted pages or redirects are needed. |
| Meta muse-image blocks or distorts a prompt (`content_policy_violation`), or the style drifts between images | Art-bible prompts with fixed style wording plus a reference image passed to `/v1/images/edits` to keep the set consistent. Generate 4 candidates each and curate by hand. Failed or blocked images aren't billed. Children are illustrated, not photoreal (§7a), which also avoids photoreal-minor policy issues. |
| No background push without Firebase | Accepted (§5). Parents see alerts when they open or resume the app. Adding FCM later is a small change. |
| Judges may value Azure use | Napster's managed tier runs on Azure OpenAI realtime; this is called out in the submission. |

## 11. Schedule (12 days)

| Days | Work |
|---|---|
| Nov 18–19 | Repo and tooling setup. **Napster-in-WebView spike.** Worker and D1 skeleton. Auth working. |
| Nov 19–20 | **Media asset generation** with Meta muse-image (§7a): art bible, generate, curate, optimize. Runs alongside the Day-1 spike. |
| Nov 20–22 | Design system (tokens and components). Onboarding, invites, roles and switching. Daycare admin screens. |
| Nov 23–25 | Avatar setup (photo, voice, consent, generation). Comfort plan. Test call and approval. Caregiver roster, reason picker and live session. |
| Nov 26–27 | Webhook, Meta summaries, flags, alerts. Session feed and detail. Check-in. Credit guard. |
| Nov 28 | Polish pass: empty, loading and error states, animations, the seeded demo world with AI faces, "Try the demo" accounts and nightly reset. |
| Nov 29 | Demo video recording, README, submission materials. |
| Nov 30 | Buffer and submit. |

### Cut order if we fall behind (my call, after the review)
The plan is to build **everything** in the doc. This list is an emergency fallback only. Cut from the top first. The core loop (parent avatar, comfort plan, test call and approval, caregiver session, check-in, summary) is never cut.
1. PIN switching on the shared tablet. Fallback: a normal sign-out and sign-in.
2. Co-parent invite. Fallback: the second parent exists in seed data only.
3. Weekly insights, usage and billing cards. These are already Nice.
4. Classroom management UI. Fallback: classrooms come from seed data, and enrollment picks from them.
5. Local system notifications. Fallback: the in-app Alerts center only.
6. Live flag tool. Fallback: flags come only from the sweep after the session.
The daycare path and the nanny path both stay, because the "one app, two doors" story depends on them.

## 12. Left to the builder

- Exact folder layout. Monorepo (`apps/mobile`, `apps/api`, `packages/shared`) is recommended.
- Component APIs, animation details, and the exact copy beyond what the mockups show.
- How to poll for avatar generation status. The docs are silent: poll `GET /public/companions/{id}`, or use the `companion.updated` webhook.
- How voice preview clips are produced. Pre-generated static clips bundled in the app are fine.
- Test strategy: unit tests for permission checks, prompt building and the webhook handler; a smoke run of the core loop on a device.
- How the seed script is built.
