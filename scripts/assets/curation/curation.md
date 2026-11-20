# EverThere asset curation

Pick = candidate number (1-4). Note: the generator did not honor requested sizes (candidates come as 1600x1600, 2016x1152 or 1920x1280), so aspect ratios vary per candidate.

## Picks
brand.icon | 4 | clean plump heart, both hands well formed, reads at 64px, isolated, margin all round
brand.iconBackground | 4 | smooth sun-yellow radial gradient, no subject; crop to square (others too busy or too pale)
brand.splash | 1 | heart centered with calm space, stars well spaced; landscape, needs portrait crop/extend
brand.wordmark | 1 | EverThere spelled correctly, coral heart nearest first e, tidy decoration
brand.featureGraphic | 2 | parent and child wave inside phone window, empty left for title, clean hands
brand.cover | 4 | parent (black hair, medium-brown skin) on tablet held by auburn toddler, bunting and confetti, no defects
onboarding.hero | 2 | warm closed-eye hug, hearts, pastel clouds, matches reference exactly (lilac parent hair is from the reference)
onboarding.parentDoor | 2 | coral round door with heart window, adult-looking auburn-haired parent peeking, clean edges
onboarding.daycareDoor | 4 | sky-blue building, rainbow arch, tidy toys at doorstep
onboarding.invite | 1 | envelope with heart seal and ticket-key sticking out, no clutter
onboarding.avatarPhoto | 4 | camera showing a smiling portrait plus flash of stars, reads clearly
onboarding.avatarVoice | 1 | simple mic with rainbow sound waves and notes, no defects
onboarding.avatarConsent | 2 | shield with heart, check and padlock, clearest at small size
moment.creating.1 | 4 | small lilac lump with a face and sparkles (start of lilac character line)
moment.creating.2 | 3 | head and body forming, lilac head with mint/blue body
moment.creating.3 | 4 | lilac-haired bust being sculpted, coral coat
moment.creating.4 | 4 | nearly finished lilac figure in mint overalls, clay hand adds sun badge
moment.creating.5 | 3 | finished smiling figure, lilac curls, coral jacket, mint overalls, glow
moment.creating.6 | 3 | same look as 5 waving with a burst of stars
moment.testCall | 1 | clean smiling phone with party poppers and confetti
moment.avatarApproved | 1 | dark-haired tan figure with gold-star ribbon, confetti all around
moment.checkIn | 2 | blonde parent and brown-haired child high-five across a phone, hearts
moment.feltBetter | 4 | happy child, tan skin, sun badge, thick outline
reason.missing_parent | 3 | child with deep-brown skin hugs bunny, looks up at heart, wistful
reason.upset_at_nap | 3 | auburn child frowning on lilac pillow with moon, clear outline
reason.new_and_nervous | 1 | blonde child shyly peeking from behind blue door with butterflies
reason.boo_boo | 1 | brave face, bandage clearly on knee, star, olive skin, thick outline
empty.noChildren | 4 | empty basket with small heart, calm and inviting
empty.noSessions | 1 | phone on cloud with sleepy moon, waiting
empty.noCaregivers | 3 | two chairs, teacup and heart, welcoming
empty.noAlerts | 1 | calm smiling bell in sleep cap with sparkle
empty.noStaff | 2 | open classroom door, empty desk with plant and apple
empty.rosterEmpty | 1 | row of cubbies with a single little shoe
empty.offline | 1 | wobbly wifi on a cloud, sleepy-confused face, swirls
empty.avatarsBusy | 3 | cosy chatting queue with hourglass, varied skin tones, no clipping
empty.resting | 3 | yellow heart asleep on lilac pillow with zzz stars
empty.error | 1 | apologetic figure with wrench next to wobbly coral cube, sweat drop
sticker.stars | 4 | fallback only: three clear stars but with a fox (see REGENERATE)
sticker.rainbow | 1 | chunky rainbow with two clouds at its feet, clean outline
sticker.bunny | 1 | cute round bunny, long ears, scarf, clean outline
sticker.dino | 2 | mint baby dino with bumps, clean shape, minimal extras
sticker.moon | 3 | smiling lilac crescent with tiny star, high contrast outline
sticker.heart | 4 | plump coral heart with soft shine and smiling face, reads small
sticker.sun | 2 | round sun-yellow sun with short rays, smile, no extra subject
sticker.cloud | 1 | smiling sky-blue cloud, lilac outline, clean
blob.parent | 2 | big warm yellow blob field, full-bleed, no subject
blob.admin | 4 | blue-dominant blob composition, few distractors
blob.caregiver | 3 | large mint blob, calm, no stray dots
classroom.butterflies | 2 | round medallion, clear butterfly, dark ring
classroom.bees | 1 | round lilac medallion, friendly bee, clean
classroom.ladybugs | 1 | round medallion, coral ladybug with ink dots
classroom.owls | 3 | round badge, owl with big friendly eyes
classroom.turtles | 2 | round badge, big friendly mint turtle
classroom.rainbows | 3 | fallback only (see REGENERATE)
classroom.stars | 2 | round medallion with smiling yellow star
classroom.sunflowers | 1 | round dark-ring medallion, simple sunflower, easiest at 64px
video.title | 4 | heart on left, parent and child on right, big empty middle for title
video.end | 2 | waving heart with confetti, empty space at bottom for credits
video.chapterParent | 3 | black-haired deep-brown-skin parent with phone, yellow theme, space left and right
video.chapterDaycare | 4 | teacher plus diverse children, empty upper area for title
video.chapterCall | 3 | child and parent in video-call frames, mint banner for title

## REGENERATE
sticker.stars | all 4 add a character (girl, wolf, boy, fox) instead of just a cluster of three stars | prompt fix: "ONLY three chunky sun-yellow clay stars grouped together, no characters, no animals, no people, no scene, thick rounded sticker outline"
classroom.rainbows | no candidate is a rainbow badge; all show a character wearing a rainbow pin (and 4 is cropped at the bottom) | prompt fix: "A small chunky clay rainbow centered inside a round badge medallion with a thick rounded outline, nothing else, no character, no animal, no person"

## Set-level notes
- Sizes not honored: candidates come out 1600x1600, 2016x1152 or 1920x1280 regardless of spec. brand.splash (portrait) and brand.iconBackground (square) are landscape and need crop or extension. Check the pipeline size mapping.
- Outline styles on stickers and badges vary (dark ink, white, coral, lilac outlines, no outline). Pick one outline recipe (for example thick white plus thin ink) and restate it in the prompts or post-process.
- Heart mascot color is inconsistent: yellow (brand.icon), coral (splash, video.end, video.title), yellow (resting). Decide the canonical color.
- Adult characters: parents tend to look child-like or have lilac hair (onboarding.hero follows the reference). For avatarApproved, checkIn and onboarding.parentDoor, adults read younger than late 20s. Add "adult proportions, defined jaw, late 20s" to the prompt.
- moment.creating frames are separate generations, so character design drifts between frames (hat color, hair, outfit). The picks follow a lilac-hair, coral-coat line but are not frame-perfect. Consider generating the sequence as image edits of one base.
- Several keys drift off-subject by adding animal characters (classroom.*, sticker.stars). Prompts need "no character" for object-only assets.
- Transparent assets still have the cream background; removal should be easy since backgrounds are flat, but soft shadows and sparkles will leave halos (clean up around brand.icon, empty.* and moment.creating).
- Skin-tone variety is good where specified (deep brown, olive, tan, light). video.chapterDaycare is not clearly sky-blue-themed.
