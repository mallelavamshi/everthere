# EverThere: demo video storyboard (about 2:45)

Target: 2 to 3 minutes. Voiceover (VO) is calm and warm. Art assets are keys from `apps/mobile/src/assets/manifest.ts`. Record on a real Android device. The demo accounts are Sarah Johnson (Parent) and Ms. Jess Parker (Teacher, Butterflies Room, Little Acorns Daycare).

| Time | Shot | On-screen action | Voiceover |
| --- | --- | --- | --- |
| 0:00 to 0:05 | Title card | `video.title` with the tagline "Be there, even when you can't." | (music only) |
| 0:05 to 0:20 | **Hook** | Split screen. Left: a toddler crying at a daycare cubby, a teacher kneeling beside them. Right: Sarah in a meeting, phone face down. Cut between them. | "Nap time at daycare. Mia is crying and asking for her mom. Her mom is in a meeting and can't pick up. Neither of them should have to wait." |
| 0:20 to 0:25 | Chapter card | `video.chapterParent` | "So Sarah set up EverThere." |
| 0:25 to 0:50 | **Parent setup (fast-cut)** | Sarah's phone: Welcome, then My Avatar. Quick cuts: photo step, pick the `marin` voice, consent, "Creating your avatar", the finished avatar. Then the comfort plan: nicknames Mia Bug and Sweet pea, tone, favorites, song. Test call with her own avatar, tap Approve. The locked safety rules are visible. | "She turns one photo into a live avatar on Napster, picks a voice, and teaches it how she comforts Mia: her nicknames, her song, what never to talk about. She tests it herself, then approves it. Nothing reaches a child before that." |
| 0:50 to 0:55 | Chapter card | `video.chapterDaycare` | "At Little Acorns Daycare." |
| 0:55 to 1:00 | Chapter card | `video.chapterCall` | (beat of silence, then the call opens) |
| 1:00 to 1:25 | **Teacher tablet: reason, live call, "Our song"** | Ms. Jess on a tablet. Peek as a Teacher registers the tablet, then "Who's teaching?" appears: pick Jess Parker, PIN 1234. Roster, tap Mia. Reason picker, tap **Missing Mommy**. Live screen: Sarah's avatar fills the screen, captions, LIVE timer, a "with Mia" badge. Mia (a small hand, off screen) says "I want my mommy". Avatar answers softly. Jess taps **🎵 Song** ("Our song"). A toast reads 🎵 Singing "Twinkle, Twinkle, Little Star" and the avatar sings Mia's seeded song. | "Ms. Jess picks Missing Mommy. Sarah appears on the screen, in her own face and voice, saying 'I'm here with you on the screen.' When Mia needs more, one tap brings their song." |
| 1:25 to 1:45 | **The flag moment** | Mia: "I fell and hurt my knee." Orange flag banner slides down. Avatar: kind, short reply, tells her to show Ms. Jess. Close-up on the banner. Cut to Sarah's phone buzzing with "Heads up". | "When Mia mentions a hurt knee, the avatar doesn't give medical advice. It tells her to show her teacher, and a live Napster function call flags the moment. Sarah is alerted at once." |
| 1:45 to 1:55 | End and check-in | Jess taps End. Check-in: **Calmer**, a short note, **Send to Sarah**. | "Ms. Jess ends the call and checks in: calmer." |
| 1:55 to 2:15 | **Mom's phone: summary and transcript** | Sarah's phone: tap the bell (Alerts), which shows "💛 Mia's comfort session" and "⚑ Heads up about Mia". Open Sessions. A two-line summary, mood before and after, the flag with the child's exact words. Scroll the transcript. (The seeded flag reads "I fell off the slide and my knee is bleeding." That is a different, earlier session from the live call, so cut to it as "another day" or re-record.) | "Usually within about a minute, Sarah has a two-line summary from Meta's Muse Spark, Mia's mood, the flag in her own words, and the full transcript." |
| 2:15 to 2:25 | **The nanny path (10s)** | Fast cut: Leo's dad David invites his nanny Rosa from Caregivers. Rosa's phone shows Leo's tile, then the reasons sheet with the button "💛 Call Daddy's avatar" (Leo has one ready avatar, so there is no picker). Toggle transcript access on and off. | "No daycare? A parent can invite a nanny or grandparent, and choose whether they see transcripts." |
| 2:25 to 2:40 | **Safety slide** | A clean slide, five bullets appearing one by one: caregiver always present. 10-minute cap, warning at 8. Child's camera never sent. Test call and parent approval first. Locked rules, no secrets, no promises, no medical advice. Flags live and after the call. Parent-controlled transcripts. | "Safety isn't a feature we added. A caregiver is always there. Calls stop at ten minutes. The child's camera is never sent. The rules are locked, and the parent controls who reads what." |
| 2:40 to 2:45 | **End card** | `video.end`, then the title text: "EverThere. Be there, even when you can't." and the credits: Napster on Azure OpenAI realtime, Meta Muse, Clerk, Cloudflare. | "EverThere. Be there, even when you can't." |

## Recording notes

- Record the live call at least twice. Say "I fell and hurt my knee" on a take where the avatar is already speaking, to make the flag banner land.
- Use a tablet 700px or wider for the teacher shots, so Peek as a Teacher registers the tablet and the "Who's teaching?" sheet appears.
- Do the recording before 08:00 UTC resets the demo, or reseed. Check the credit guard first. A recorded call counts toward the $120 cap.
- All faces are AI-generated. Mention it in the end credits.
- **Nanny path:** Try the demo can't do this (it only offers Parent and Teacher; David and Rosa have no sign-in). Film it with two real accounts made for the video: a parent account that invites a nanny from Caregivers, and the nanny's own account.
- **Parent setup shots** (creating an avatar, test call, Approve) need a fresh real account, because the demo Sarah is already approved.
- Existing art: `video.title`, `video.chapterParent`, `video.chapterDaycare`, `video.chapterCall`, `video.end`.
