// The EverThere demo: one continuous real recording of the app on a phone (demo_cut.mp4, built by
// scripts/marketing/demo/build_cut.py), framed on the app's sunset gradient with step captions.
// 16:9 puts the phone left and the captions right; vertical puts the captions above the phone.
import React from 'react';
import {AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import cut from './demo_cut.json';
import {C, font, FPS, sunset} from './theme';

const INTRO = 3.5 * FPS;
const OUTRO = 6 * FPS;
const CUT = Math.round(cut.duration * FPS);
export const DEMO_FRAMES = INTRO + CUT + OUTRO;

type Step = {title: string; sub: string; at: number};
const seg = (label: string) => cut.segments.find((s) => s.label === label)!.outStart;
const calls = cut.segments.filter((s) => s.label === 'call');

// Steps, timed against the cut (seconds from the start of demo_cut.mp4).
const STEPS: Step[] = [
	{at: 0, title: 'Open EverThere', sub: 'The real app on a real phone. Pauses trimmed, nothing staged.'},
	{at: seg('teacher'), title: 'Try the demo as a teacher', sub: 'Butterflies Room at Little Acorns Daycare'},
	{at: seg('pick'), title: 'Mia is upset', sub: 'Pick who to call, Mommy or Daddy, and why'},
	{at: seg('dialing'), title: 'Calling Daddy', sub: 'His own face while the call connects (wait shortened)'},
	{at: seg('live'), title: "Daddy's live AI avatar", sub: 'His face and his cloned voice, a Napster digital twin'},
	{at: calls[0].outStart + 12, title: 'It names the feeling', sub: 'Asks one easy question, then listens'},
	{at: calls[1].outStart, title: 'Our song', sub: 'Mia asks, and Daddy sings it softly'},
	{at: calls[2].outStart, title: 'A hurt gets flagged', sub: 'Mia says she hurt her knee. The safety flag fires and Daddy sends her to her teacher.'},
	{at: calls[3].outStart, title: 'Calm, then a warm goodbye', sub: 'A pocket hug, some praise, and back to Ms. Jess'},
	{at: seg('end'), title: 'Bye-bye for now', sub: 'Calls are capped at 10 minutes'},
	{at: seg('checkin'), title: 'Teacher check-in', sub: 'How is Mia now? Calmer, and her parents are told'},
	{at: seg('switch'), title: "Meanwhile, Mom's phone", sub: 'Peek as the parent'},
	{at: seg('home'), title: 'Every call, summarized', sub: '"Mia felt better", with a moment worth a look'},
	{at: seg('alerts'), title: 'Alerts', sub: 'The comfort session, and a heads-up about the knee'},
	{at: seg('transcript'), title: 'The full transcript', sub: 'The flagged moment on top, every word below'},
];

const Caption: React.FC<{step: Step; vertical: boolean}> = ({step, vertical}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame, fps, config: {damping: 14, stiffness: 160}});
	const sub = spring({frame: frame - 6, fps, config: {damping: 16, stiffness: 140}});
	return (
		<div style={{position: 'absolute', ...(vertical ? {left: 70, right: 70, top: 150} : {left: 900, right: 110, top: 360}), color: C.ink, fontFamily: font}}>
			<div style={{fontSize: vertical ? 74 : 80, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1, opacity: s, transform: `translateY(${(1 - s) * 30}px)`}}>{step.title}</div>
			<div style={{marginTop: 22, fontSize: vertical ? 40 : 40, fontWeight: 500, lineHeight: 1.3, color: '#3f3358', opacity: sub, transform: `translateY(${(1 - sub) * 20}px)`}}>{step.sub}</div>
		</div>
	);
};

const Badge: React.FC<{vertical: boolean}> = ({vertical}) => (
	<div style={{position: 'absolute', ...(vertical ? {left: 0, right: 0, bottom: 34, textAlign: 'center'} : {right: 60, bottom: 44}), fontFamily: font, fontSize: 26, fontWeight: 500, color: 'rgba(43,33,64,0.72)'}}>
		Real app · real call · Mia's voice is a text-to-speech child voice
	</div>
);

const Logo: React.FC<{vertical: boolean}> = ({vertical}) => (
	<div style={{position: 'absolute', ...(vertical ? {left: 70, top: 56} : {left: 900, top: 120}), display: 'flex', alignItems: 'center', gap: 18, fontFamily: font, fontWeight: 700, fontSize: 44, color: C.ink}}>
		<Img src={staticFile('everthere-icon.svg')} style={{width: 64, height: 64, borderRadius: 16}} />
		EverThere
	</div>
);

const Phone: React.FC<{vertical: boolean}> = ({vertical}) => {
	const h = vertical ? 1390 : 980;
	const w = Math.round((h * 1080) / 2340);
	return (
		<div
			style={{
				position: 'absolute',
				width: w,
				height: h,
				...(vertical ? {left: (1080 - w) / 2, top: 395} : {left: 330, top: 50}),
				borderRadius: 46,
				overflow: 'hidden',
				border: '10px solid #1d1730',
				boxShadow: '0 30px 80px rgba(43,33,64,0.45)',
				background: '#000',
			}}
		>
			<OffthreadVideo src={staticFile('clips/demo_cut.mp4')} style={{width: '100%', height: '100%'}} />
		</div>
	);
};

const Card: React.FC<{title: string; lines: string[]; vertical: boolean}> = ({title, lines, vertical}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame, fps, config: {damping: 13, stiffness: 120}});
	return (
		<AbsoluteFill style={{background: sunset, alignItems: 'center', justifyContent: 'center', fontFamily: font, color: C.ink, textAlign: 'center', padding: 80}}>
			<Img src={staticFile('everthere-icon.svg')} style={{width: vertical ? 260 : 220, height: vertical ? 260 : 220, borderRadius: 52, transform: `scale(${s})`, boxShadow: '0 24px 60px rgba(43,33,64,0.35)'}} />
			<div style={{marginTop: 46, fontSize: vertical ? 96 : 92, fontWeight: 700, opacity: s}}>{title}</div>
			{lines.map((l, i) => (
				<div key={i} style={{marginTop: i === 0 ? 18 : 10, fontSize: i === 0 ? (vertical ? 46 : 44) : vertical ? 32 : 30, fontWeight: i === 0 ? 600 : 500, opacity: interpolate(frame, [10 + i * 6, 22 + i * 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), color: i === 0 ? C.ink : '#3f3358'}}>
					{l}
				</div>
			))}
		</AbsoluteFill>
	);
};

export const Demo: React.FC<{vertical: boolean}> = ({vertical}) => (
	<AbsoluteFill style={{background: sunset}}>
		<Sequence durationInFrames={INTRO}>
			<Card vertical={vertical} title="EverThere" lines={["A parent's live AI avatar comforts their child,", 'when they can’t be there.', 'Demo: the real app, recorded on a phone']} />
		</Sequence>
		<Sequence from={INTRO} durationInFrames={CUT}>
			<Phone vertical={vertical} />
			<Logo vertical={vertical} />
			{STEPS.map((step, i) => {
				const from = Math.round(step.at * FPS);
				const to = i + 1 < STEPS.length ? Math.round(STEPS[i + 1].at * FPS) : CUT;
				return (
					<Sequence key={i} from={from} durationInFrames={Math.max(1, to - from)} layout="none">
						<Caption step={step} vertical={vertical} />
					</Sequence>
				);
			})}
			<Badge vertical={vertical} />
		</Sequence>
		<Sequence from={INTRO + CUT} durationInFrames={OUTRO}>
			<Card
				vertical={vertical}
				title="Be there, even when you can’t."
				lines={['Try it: github.com/mallelavamshi/everthere-app', 'Napster live avatars on Azure OpenAI realtime · Meta Model API · Cloudflare Workers, D1, R2 · Clerk · Capacitor']}
			/>
		</Sequence>
	</AbsoluteFill>
);
