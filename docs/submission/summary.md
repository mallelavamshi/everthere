# EverThere: be there, even when you can't

## What we built

EverThere is an Android and web app that puts a parent's live AI avatar on a caregiver's screen when a young child is upset. A parent turns one photo into a talking avatar and writes a comfort plan for each child: nicknames, tone, favorite things, a song, and topics never to raise. When a toddler cries at drop-off or nap time, the teacher or nanny taps the child, picks a reason ("Missing Mommy", "Got a boo-boo"), and starts a short live call with Mommy or Daddy. Afterward the parent gets a summary, the child's mood before and after, the transcript, and any flagged moment.

## The problem

Separation distress is one of the hardest parts of early childcare. A teacher can't reach a parent in a meeting, and the parent hears about a hard morning hours later. EverThere gives the child a familiar face and voice right away, and gives the parent a clear picture afterward.

## How it uses the Napster API

- **Companions from a photo.** Each parent's photo becomes a companion. In the demo, Mia's Daddy is the maker's own digital twin, with their real face and cloned voice.
- **Agents.** Each avatar's instructions pair a child-comfort method (connect, name the feeling, breathe, redirect, hand back) with locked safety rules parents can't edit.
- **Per-child memory.** A hashed `externalClientId` on every connection lets each avatar remember each child between calls, and no raw id leaves our server.
- **Per-call context.** `externalClientProfile` and `initialSpeech` tell the avatar why this call is happening, who holds the screen, and where the child is, so it opens on the reason for the call.
- **FAQs and a knowledge base.** Every agent gets 20 gentle answers to children's questions ("When are you coming?") and a library of calm-down games and stories.
- **Function calling.** A `flag_concern` tool fires mid-call when a child says something like "I hurt my knee". The caregiver sees a banner, and the parent is alerted at once.
- **Webhooks and cost.** The `session.closed` webhook starts our summary pipeline (Meta `muse-spark`). Session cost feeds a hard spend cap.
- **Privacy.** `videoPolicy` is always `deferred`, so the child's camera is never sent.

Napster runs each conversation on Azure OpenAI realtime.

## Technical execution

- **Stack.** Capacitor and React, with a Hono API on Cloudflare Workers, D1, R2 (private photos, short-lived signed links), Cron and Clerk.
- **Safeguards.** Every permission is enforced on the server. No child call starts until the parent has test-called and approved their avatar. A caregiver is always present, and calls cap at 10 minutes.
- **Two-layer flags.** Concerns are caught live and again in a post-call sweep.
- **Tests.** 1,127 automated tests pass.

## Try it

- Web app: https://everthere-web.m-vamshikrishna22.workers.dev
- APK and judge guide: https://github.com/mallelavamshi/everthere-app
- Source: https://github.com/mallelavamshi/everthere
- Demo video: https://www.youtube.com/watch?v=8u4zYBWxMKQ

Tap **Try the demo** to join as Sarah (a parent) or Ms. Jess (a teacher). No account needed.
