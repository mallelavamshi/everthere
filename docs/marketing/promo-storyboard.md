# EverThere promo: storyboard

**Two cuts from one shoot:**
- **Hero:** 16:9, 60 s, for YouTube, Devpost and the site.
- **Social:** 9:16, 30 s, for X, Instagram and TikTok.

**Look:** real people in real places, warm natural light, with gentle handheld motion. Every screen shows the real app, with real calls, real captions and the real parent avatars.

**Sound:** music only, with no voiceover. A soft piano opening rises to a warm, hopeful build at "It asks. It listens.", then resolves on the end card. Two moments carry real audio from the calls, ducked under the music:
- the parent avatar's greeting;
- Mia's little "I miss you, Daddy".

**Captions:** kinetic, in the nidi style. Short lines of up to 7 words slam in word by word. The key word is set in the app's sunset gold, and each line sits low-left on a soft dark wash.

## How each shot is made

1. **The scene:** a Meta muse-image still (`scripts/marketing/scenes.ts`), with the device screen in flat chroma green.
2. **The motion:** Wan 2.2 image-to-video, A14B on a Modal H100, about 5 s per clip at 720p. The prompt describes only natural human motion: breathing, a head turn, the teacher bringing the tablet closer, the child's face brightening. The screen stays green.
3. **The screen:** a real screen recording of the app is keyed into the green screen, frame by frame. The screen's four corners are tracked each frame, and fingers in front of the screen stay in front. Because the parent on the device really talks and the app text never warps, it is the real app.
4. **The edit:** Remotion (as in nidi), with captions on the music's bar grid. Render a half-scale draft first and check it with a contact sheet.

## Hero cut, 60 s (16:9)

| # | Time | Shot (scene) | Motion (Wan prompt idea) | On the device | Caption |
|---|---|---|---|---|---|
| 1 | 0:00–0:04 | **Mia alone on the classroom carpet**: 01, push-in on her teary face, kids blurred behind | She sniffles and looks down; the classroom bustles softly | (tablet not yet in frame, or still green and turned away) | Drop-off is *hard*. |
| 2 | 0:04–0:09 | **Her teacher kneels with the tablet**: 01 | The teacher (a Black woman) kneels and brings the tablet up to Mia's eye level, smiling | The dialing screen: **Mommy's face**, "Calling Mommy…" | So her teacher calls *Mommy*. |
| 3 | 0:09–0:15 | **Mia sees her mom**: 01, closer | Mia's face lifts and brightens, she leans in, a small smile through tears | **Sarah's avatar live**: "Hi, Mia Bug, it's Mommy! I'm so happy to see you…" | Her face. Her *voice*. |
| 4 | 0:15–0:21 | **Leo and his dad**: 02 (blonde teacher, tablet) | Leo stops fidgeting and watches, his mouth opening to answer | **David's avatar**: "Hi, my little Leo-bear…" | An AI *avatar* of you. From one photo. |
| 5 | 0:21–0:27 | **Mia, phone call with Daddy**: 03 | The teacher holds the phone steady; Mia nods and talks to it | **Vamshi's avatar** (the maker's own twin) talking | It asks. It *listens*. It calms. |
| 6 | 0:27–0:32 | **Ava, a quiet moment**: 04 (East Asian teacher, phone) | Ava wipes a tear and takes a slow breath, copying the screen | **Hannah's avatar**: "smell the flower… blow out the candle" | Breathing. Songs. A *pocket hug*. |
| 7 | 0:32–0:37 | **Home with the nanny**: 05 (Leo, nanny, sofa) | They lean together toward the tablet; Leo's shoulders relax | **David's avatar** | At daycare. Or at *home*. |
| 8 | 0:37–0:41 | **Nap time**: 06 (Sam, nanny, bedroom) | Sam's eyes get heavy; she rests her head; the nanny smiles | **Priya's avatar**, soft and sleepy | Nap time, *sorted*. |
| 9 | 0:41–0:45 | **Safety, app close-up** (a screen-recording insert, punch-in) | (none, the real app) | Mia says "I fell down and hurt my knee"; the orange **⚑ Flagged for Daddy** banner slides in | Hurt? It tells the *grown-up*. |
| 10 | 0:45–0:50 | **Dad at work**: 08 | He glances at his phone between tasks; a relieved smile | **Alerts**: "💛 Mia's comfort session", "⚑ Heads up about Mia" | You'll *know*. Every time. |
| 11 | 0:50–0:55 | **Mom at home**: 07, then 10 at the office | She reads, exhales, smiles; then a gentle look out of the window | **"Mia felt better 💛"** summary, then the transcript | How they felt. What they said. |
| 12 | 0:55–1:00 | **End card** | The icon blooms on the sunset gradient | "EverThere" · *Be there, even when you can't.* · "Live avatars by Napster, on Microsoft Azure" | |

## Social cut, 30 s (9:16)

Re-framed from the same clips. The vertical crop follows each child's face, then the device.

| Time | Shot | Caption |
|---|---|---|
| 0:00–0:03 | 1 (Mia teary) | Drop-off is *hard*. |
| 0:03–0:08 | 2 to 3 (tablet up, Mommy appears) | So she calls *Mommy*. |
| 0:08–0:12 | 3 (Mia smiles) | Her face. Her *voice*. |
| 0:12–0:16 | 5 (phone, Daddy) | It asks. It *listens*. |
| 0:16–0:19 | 8 (nap time) | It *calms*. |
| 0:19–0:22 | 9 (flag banner) | Hurt? It tells the *grown-up*. |
| 0:22–0:26 | 10 (dad, alerts) | You'll *know*. |
| 0:26–0:30 | End card | EverThere. *Be there.* |

## Honesty rules

- Every screen is the real app, keyed from real screen recordings. App text is never generated by AI.
- Calls show real avatar responses. Real lines are only shortened, never rewritten.
- The people are AI-generated (Meta). Mia's Daddy on screen is the maker's own consented digital twin.
- No promises the product doesn't make. There's no "I'll pick you up soon", in keeping with the locked rules.
