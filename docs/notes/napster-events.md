# Napster + Clerk in the Capacitor Android WebView: device spike notes (Task 4)

Date: 2026-11-18. SDK `@touchcastllc/napster-companion-api@2.0.0`, `@capacitor/android@8.6.2` (compileSdk/targetSdk 36),
`@clerk/react@6.19.1` (clerk-js 6 from the FAPI CDN), API on local `wrangler dev`.

Device: **Android emulator only** (AVD `fluent35`, Pixel 7 profile, Android 15 / API 35, google_apis x86_64, WebView Chrome 124).
No physical phone or tablet was attached, so the brief's "physical phone and tablet" gate is still open (see Decision record).

Evidence: `docs/notes/spike/run-log.txt` (every callback and `onData` frame of the measured session, token redacted),
`docs/notes/spike/evidence-a-signed-in.png` (Clerk user id and test email blacked out), `docs/notes/spike/evidence-b-avatar-live.png`.
The Clerk test user id and email are redacted in all evidence (`user_<redacted>`, `<test-email>`).

Shapes below are copied from real frames unless marked **(docs only)**.

---

## 1. Gate results (emulator)

| Gate | Result | How it was verified |
|---|---|---|
| (a) Clerk email/password sign-in in the WebView, API sees a valid JWT | **Works** | `signIn.password()` -> `needs_client_trust` -> `signIn.mfa.sendEmailCode()` + `verifyEmailCode({code:'424242'})` -> `complete` -> `finalize()`. `GET http://10.0.2.2:8787/api/me` with `getToken()` -> **200** with the Clerk user. Session survives an app restart. |
| (b) `init` reaches ready | **Works** | `onSessionStatusChange`: `loading` -> `readyVideo` (no `readyAudio` seen: `avatar_state_changed.details.mode` was `audio_video` straight away). `onAvatarReady(true)` ~7 s after Call. Avatar video renders inline in `#av` (round view). |
| (c) Avatar speaks; events arrive | **Works** | Opening line (triggered by `initialSpeech`) produced `message_received` (assistant `created`/`delta`/`completed`) and `talk_state_changed` `preparing`/`started`/`ended`. Injected user text produced the implicit `flag_concern` call and a spoken reply. |
| (d) `destroy()` ends the session and releases the mic | **Works** | `destroy()` -> `onSessionStatusChange('entry')` -> `onAvatarReady(false)` -> `onDestroy()`. `GET /public/sessions/{connectionId}` -> `status:"closed"`, `closeReason:"connection_closed"`. `dumpsys audio`: `rec stop ... pack:app.everthere` at the moment of `destroy()`; all AudioIn threads in standby. |
| Mic heard by the avatar | **Not verifiable on the emulator** | The emulator has no real voice input. The WebView mic path itself works: Android's RECORD_AUDIO dialog appears on `getUserMedia`, the track is `live`, AudioService logs an active recording for `app.everthere` during the session. Needs a physical device + human voice. |
| Audio audible | **Not verifiable here** | Talk events and audio output tokens prove audio was produced; nobody listened. Needs a physical device. |

Napster usage: 2 real sessions, 1.55 min + 0.62 min = **2.17 session-minutes**, cost `0.1166` + `0.0583`
(= 0.0583 per *started* minute). One extra connection was created and never connected (tags probe): it ended
`status:"failed"`, `closeReason:"connection_timeout"`, `cost:0`.

---

## 2. `onData` payloads (`EventMessage`: `{ event: string, data?: object }`)

### `avatar_state_changed`
```json
{"event":"avatar_state_changed","data":{"state":"preparing","timestamp":"2026-11-19T02:02:52.984261+00:00"}}
{"event":"avatar_state_changed","data":{"state":"preparing","timestamp":"...","details":{"stage":"downloading","progress":42}}}
{"event":"avatar_state_changed","data":{"state":"preparing","timestamp":"...","details":{"stage":"initializing"}}}
{"event":"avatar_state_changed","data":{"state":"ready","timestamp":"...","details":{"mode":"audio_video","video_type":"hd"}}}
```
The first session of a fresh companion streams ~40 `downloading` progress frames (0..100); a warm one skips them.
`ready` came once, with `mode:"audio_video"`, even though the connection was created with `videoPolicy:'deferred'`
(the policy governs the *user's* camera; the avatar's video still renders).

### `message_received`: session frame (skip it; `type:"session"`, no `role`)
```json
{"event":"message_received","data":{"message":{"action":"created","type":"session","session":{"id":"sess_Ellm9qvhZOFS7okbbC3I0"},"is_forced":false,"timestamp":"..."}}}
```
`session.id` (`sess_...`) is the *provider* session id. It is NOT the id for `GET /public/sessions/{id}`
(that returns 400). The REST session id equals the **connection id** from `POST /agents/{id}/connections`, which is
also what `instance.sessionId` returns.

### `message_received`: assistant caption (role `assistant`)
```json
{"event":"message_received","data":{"message":{"action":"created","role":"assistant","response_id":"resp_EllmApFP2rBWwMidCMc5Y","is_forced":false,"timestamp":"..."}}}
{"event":"message_received","data":{"message":{"action":"created","type":"message","role":"assistant","response_id":"resp_...","item_id":"item_EllmA2TcYZC9UHC8XWqaK","is_forced":false,"timestamp":"..."}}}
{"event":"message_received","data":{"message":{"action":"delta","type":"message","role":"assistant","response_id":"resp_...","item_id":"item_...","content":"Hello","content_index":0,"emotion":"neutral","is_forced":false,"timestamp":"..."}}}
{"event":"message_received","data":{"message":{"action":"completed","type":"message","role":"assistant","response_id":"resp_...","item_id":"item_...","content":"Hello! How are you feeling today?","emotion":"neutral","is_forced":false,"timestamp":"..."}}}
{"event":"message_received","data":{"message":{"action":"completed","role":"assistant","response_id":"resp_...","usage":{"input_tokens":1422,"output_tokens":76,"total_tokens":1498,"input_token_details":{...},"output_token_details":{"text_tokens":20,"audio_tokens":56},"cached_tokens":0,"cached_token_details":{...}},"is_forced":false,"timestamp":"..."}}}
```
Caption rule: show `data.message.content` when `event==='message_received' && message.type==='message' && message.role==='assistant'`;
`delta` frames append per `item_id`, `completed` carries the full text. The response-level `completed` frame
(no `type`, has `usage`) has no `content`: ignore it for captions. A duplicate `created` frame with `previous_item_id` also arrives.

### `message_received`: user turn (role `user`). Injected text produced:
```json
{"event":"message_received","data":{"message":{"action":"created","type":"message","role":"user","item_id":"item_EllmQaO2gOMTkXoALC0vm","content":"I fell and hurt my knee","previous_item_id":"item_...","is_forced":false,"timestamp":"..."}}}
{"event":"message_received","data":{"message":{"action":"completed","type":"message","role":"user","item_id":"item_EllmQaO2gOMTkXoALC0vm","content":"I fell and hurt my knee","previous_item_id":"item_...","is_forced":false,"timestamp":"..."}}}
```
Spoken user turns also emit `speech_started` / `speech_stopped` / `completed` (transcript in `content`) **(docs only; no voice on the emulator)**.

### `talk_state_changed`
```json
{"event":"talk_state_changed","data":{"talk_id":"item_EllmA2TcYZC9UHC8XWqaK","state":"preparing"}}
{"event":"talk_state_changed","data":{"talk_id":"item_EllmA2TcYZC9UHC8XWqaK","state":"started","sentence_index":null,"is_forced":false}}
{"event":"talk_state_changed","data":{"talk_id":"item_EllmA2TcYZC9UHC8XWqaK","state":"ended","sentence_index":null}}
```
`talk_id` equals the assistant message `item_id`. `canceled` / `in_progress` exist per docs, not seen.

### Implicit function call (`flag_concern`): two views of the same call
1. Transcript frames (`message_received`, `type:"function_call"`, **no `role`**):
```json
{"event":"message_received","data":{"message":{"action":"created","type":"function_call","response_id":"resp_EllmQjq3ULpskjI7vXNO8","item_id":"item_EllmQTXWcUKSeFtbqHkle","call_id":"call_nvLJ7jPEYa5DDMbQ","is_forced":false,"timestamp":"..."}}}
{"event":"message_received","data":{"message":{"action":"completed","type":"function_call","response_id":"resp_...","item_id":"item_EllmQTXWcUKSeFtbqHkle","content":"{  \n  \"category\": \"injury\", \n  \"quote\": \"I fell and hurt my knee\",  \n  \"severity\": \"low\" \n} \n","call_id":"call_nvLJ7jPEYa5DDMbQ","tool":"flag_concern","is_forced":false,"timestamp":"..."}}}
```
(`tool` = function name, `content` = arguments as a JSON **string**.)

2. **The one to act on**: a dedicated event with parsed arguments:
```json
{"event":"function_implicitly_called","data":{
  "item_id":"item_EllmQTXWcUKSeFtbqHkle",
  "call_id":"call_nvLJ7jPEYa5DDMbQ",
  "name":"flag_concern",
  "arguments":{"category":"injury","quote":"I fell and hurt my knee","severity":"low"},
  "metadata":{"tags":null,"external_client_id":"spike_bddd0778ec035dc259924dbb","external_client_profile":null}}}
```
Fields: name = `data.name`, call id = `data.call_id`, arguments = `data.arguments` (an **object** here).

### Function output: the `sendCommand` shape that worked
```ts
instance.sendCommand({
  type: DataChannelMessageType.FUNCTION_CALL_OUTPUT, // "send_function_output"
  data: { call_id: 'call_nvLJ7jPEYa5DDMbQ', output: { ok: true }, delay: false },
});
```
Napster acknowledged it with
```json
{"event":"message_received","data":{"message":{"action":"created","type":"function_call_output","item_id":"item_...","content":"{\"ok\": true}","previous_item_id":"item_EllmQTXWcUKSeFtbqHkle","call_id":"call_nvLJ7jPEYa5DDMbQ","is_forced":false,"timestamp":"..."}}}
```
and the agent then spoke ("I'm sorry to hear that. I hope your knee feels better soon."). The whole round trip took ~0.3 s.
Without an output the call times out after 10 s and the client gets `function_call_timeout {call_id, function_name}` **(docs only)**.
`GET /public/sessions/{id}` afterwards had `functionStates: []` and only the 3 spoken items in `conversation.items`
(the function call is not in the REST transcript).

### Injecting a user message
```ts
instance.sendCommand({ type: DataChannelMessageType.SEND_MESSAGE, data: { text: 'I fell and hurt my knee', role: 'user', trigger_response: true } });
```

### `avatar_connection_warning`, `session_expired`, others: **(docs only; not triggered in the spike)**
```json
{"event":"avatar_connection_warning","data":{"disconnect_after":30}}   // server idle warning at 60, 30, 10 s
{"event":"session_expired","data":null}                                 // session closes, closeReason "session_expired"
{"event":"no_credits_left","data":null}                                 // closeReason "no_credits_left"
{"event":"reaching_rate_limits","data":{"name":"...","remaining_rate":0,"reset_seconds":0}}
{"event":"provider_connection_aborted","data":{"error":{"code":"invalid_voice|invalid_credentials|instructions_too_long|connection_failed|invalid_model"}}}
{"event":"error","data":{"message":"..."}}                              // log only; text may change
```
The SDK also routes `session_expired`/`no_credits_left` to `onError` as a `ConnectionError` (`context.reason`).

---

## 3. SDK lifecycle observed (callbacks, in order)

`init()` resolves immediately after `onReady` (before the token is minted) -> `onSessionStatusChange('loading')` ->
`getToken()` called (after mic permission settled) -> `avatar_state_changed` frames -> `onSessionStatusChange('readyVideo')`
-> `onAvatarReady(true)` -> ... -> `destroy()` -> `onSessionStatusChange('entry')` -> `onAvatarReady(false)` -> `onDestroy()`.

**Client inactivity timeout (important for children who go quiet):** with no user speech, the SDK fired
`onInactivityStatusChange(true)` 60 s after ready, showed a 30 s countdown, then tore the session down by itself
(`entry` -> `onAvatarReady(false)` -> `onDestroy()`), closeReason `connection_closed`. `onDestroy` therefore also fires
for SDK-initiated teardown, not only for `destroy()`. Configurable via `features.inactiveTimeout {enabled, duration<=180000, countdown 20..60}`.
Any user message (`send_message`) resets it (`onInactivityStatusChange(false)`).
**Task 19 decision:** the live session passes `features.inactiveTimeout: { enabled: false }`. In the 2.0.0 bundle the idle timer is
only armed when `inactiveTimeout.enabled` is truthy, so the SDK never auto-ends a quiet child; our own 10-minute cap
(`LIMITS.sessionMaxMs`) ends the call. `onInactivityStatusChange(true)` is still handled defensively ("Still there?" card).

`initialSpeech` is **not spoken verbatim** in `conversation` mode: with `initialSpeech:"Hi, I am Spike. How are you today?"`
the avatar said "Hello! How are you feeling today?". Without `initialSpeech` the agent stayed silent (it waits for the user).

---

## 4. Companion generation status (`GET /public/companions/{id}` after `POST /companions` with `pictureUrl`, `version:'v1'`)

`POST /companions` response: `{"description":"...","firstName":"Spike","id":"3c044557-...","tags":{},"pictureUrl":"https://..."}`

| t | `status` | other fields |
|---|---|---|
| 0-105 s | `"pending"` | `versions: []`, `previewUrl`/`videoLoopUrl` empty at first; **`previewUrl` filled at ~45 s while still pending**; Napster also auto-fills `lastName`, `gender`, `ethnicity`, `headline` |
| 120 s | `"generationCompleted"` | `videoLoopUrl` set, `versions: ["v1"]` |
| 165 s | **`"readyToUse"`** | final. Docs: "ready to attach to an agent when its status is `readyToUse`" |

Final object keys: `id, firstName, lastName, previewUrl, videoLoopUrl, gender, ethnicity, headline, assistantPrompt (8 KB), status, tags ({}), createdAt (unix s), customVoices ([]), versions (["v1"])`.
Stock companions (`GET /companions/napster-stock`) report `status:"completed"`.
Even at `readyToUse`, `DELETE /companions/{id}` answered `400 [{"code":"CompanionNotCompleted",...}]` shortly after.

### `pictureUrl` acceptance
- A stock companion's seed JPEG (853x480, no query string): **accepted** (above).
- The same URL with `?exp=...&sig=...` appended: `400 [{"code":"ImageValidationFailed","description":"Selfie verification failed. Please try again later."}]`.
  Inconclusive: could be the query string or a duplicate-face check on a reused photo. **Matters**: our `pictureUrl` is a signed media URL with a query string.
- **1920x1080 JPEG: PENDING / inconclusive.** A public 1920x1080 portrait JPEG (picsum id 64, both the redirecting URL and the direct
  `fastly.picsum.photos/...?...` URL) got `500` with an empty body. The same image at 853x480 also got `500`, so the failure is not
  the resolution itself (more likely this host or the image content: sunglasses). Re-test with one of our own uploaded parent photos
  on the deployed Worker before Task 12 relies on 1920x1080.

---

## 5. Connection tags

Napster takes `tags` as a **JSON object of string -> string** (`Dictionary<string,string>`), not a string array:
- `tags: ["childId:abc","kind:child"]` -> `400 {"errors":{"tags":["Cannot deserialize the current JSON array ... into type 'Dictionary<String,String>' ..."]}}`
- `tags: {"childId":"abc","kind":"child"}` -> `200`, and `GET /sessions/{id}` echoes `"tags":{"childId":"abc","kind":"child"}`.
- `function_implicitly_called.data.metadata.tags` echoes them (`null` when none were sent).

---

## 6. Differences from what the code assumes (to fix in the owning tasks)

1. **`companionReadiness` (services/avatars.ts) never reports ready.** Real statuses are `pending` / `generationCompleted` / `readyToUse`.
   Its regex needs a word boundary after `ready`/`completed`, so `readytouse` and `generationcompleted` both stay `creating`, and every
   avatar would time out to `failed` after 30 min. Fix: treat `status === 'readyToUse'` (and stock `completed`) as ready, `/fail/i` as failed.
   Agents should only be created at `readyToUse`.
2. **Connection `tags` are a string array** in `napster/client.ts`, `routes/sessions.ts` and `routes/avatars.ts`: Napster rejects that
   with 400, so **every session start and test call would fail**. Send an object, e.g. `{childId, caregiverId, reason, sessionId, kind:'child'}`.
3. **Napster error bodies have three shapes**, and the client only reads `{code,message}`:
   `[{"code":"VoiceIdRequired","description":"...","type":11}]` (array), `{"code":"RequestRateLimitExceeded","description":"...","type":12}`,
   and ASP.NET validation `{"errors":{"field":["..."]}}`. Also some 500s have an empty body. So `code` is `HTTP_400` for array bodies and
   the `ConcurrentSessionLimitReached` -> `BUSY` mapping only works if that error uses the object shape. Parse arrays (`[0].code`) and use `description`.
4. **`POST /agents` requires `voiceId`** (`400 VoiceIdRequired`). `services/avatars.ts` passes `voice_id ?? undefined`.
5. **`deleteConnection`/`deleteCompanion` "404 = gone"** assumption: an expired connection returns `400 ConnectionNotFound`,
   a just-finished companion returns `400 CompanionNotCompleted`.
6. **Session id**: REST session id = connection id = `instance.sessionId` (matches the code storing `connectionId`). Session object uses
   `startedAt` / `closedAt` (unix seconds), `cost` (USD, billed per started minute, 0.0583/min on this key), `closeReason`
   (`connection_closed` on destroy or SDK inactivity, `connection_timeout` for a never-connected token).
7. **Clerk `verifyToken` contract** (fixed in this task): the top-level `verifyToken` from `@clerk/backend` 3.x resolves to the JWT
   payload and throws on failure; `clerkVerify` read `res.data`, so every real token was rejected (401). Now accepts both shapes.
   Clerk session JWT claims: `azp:"https://localhost"`, `iss`, `sid`, `sub`, `sts`, `fva`, `v:2`, 60 s lifetime; no `email`/`name`
   (the API's profile fetch fills those).
8. **CORS** (fixed in this task): the WebView origin `https://localhost` makes every API call cross-origin; the API had no CORS, so the
   preflight hit the auth guard (401). Added `hono/cors` for `https://localhost` and `capacitor://localhost` before the guard.

---

## 7. Android / WebView setup that made it work

- `AndroidManifest.xml`: `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA` (+ camera/microphone `uses-feature required=false`).
- **No `MainActivity` override needed**: Capacitor 8's `BridgeWebChromeClient.onPermissionRequest` maps `AUDIO_CAPTURE` to
  `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`, launches the runtime prompt, then grants the WebView request. Observed: the system
  "Allow EverThere to record audio?" dialog on the first `getUserMedia`; after "While using the app" the session connected.
- `res/xml/network_security_config.xml`: cleartext only to `10.0.2.2` (local `wrangler dev`).
- Mixed content: the page is `https://localhost`, so calling `http://10.0.2.2:8787` needs `android.allowMixedContent`. It is set
  only when `CAP_DEV_HTTP_API=1` is exported at `cap sync` time; release builds must not set it (the deployed API is HTTPS).
- Clerk: `@clerk/clerk-react@5` is **deprecated and blocked** by the Clerk instance (`action_blocked`: "This app uses an outdated version
  of Clerk"). Use `@clerk/react@6` (Core 3 signal API: `signIn.password()`, `signIn.mfa.sendEmailCode()/verifyEmailCode()`,
  `signIn.finalize()`). New devices get `needs_client_trust` (Device Trust email code) after the password step: the real sign-in
  UI must handle that step. No Clerk allowed-origins change was needed in the dev instance (`allowed_origins` is still `null`).
- WebRTC needed no TURN/cleartext tweaks: signaling is `wss://avatar-signaling.napster.ai`, media connected from the emulator NAT.

---

## 8. Decision record

**Outcome: works in the Android WebView; no Custom Tab fallback needed.** Clerk headless email/password sign-in (plan of record) and the
inline Napster avatar both work inside the Capacitor WebView on Android 15 (emulator): sign-in, JWT accepted by the API, avatar renders,
speaks, emits captions/talk states, the implicit `flag_concern` call round-trips, and `destroy()` closes the Napster session and releases
the mic.

**Open before the gate is fully closed:** run the same flow on a physical Android phone and tablet to confirm (1) the avatar is
audible through the speaker and (2) Napster hears the mic (a spoken user turn produces `message_received` role `user` with a transcript).
The emulator cannot prove those two.
