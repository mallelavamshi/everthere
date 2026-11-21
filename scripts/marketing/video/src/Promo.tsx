// The EverThere promo (docs/marketing/promo-storyboard.md). Each shot is a Wan 2.2 clip of a Meta muse-image scene with
// the real app's screen keyed into the device (scripts/marketing/promo). Cuts sit on the sections of "Discover"
// (Eugenio Mininni, Mixkit free license): soft open, swell at 12.75 s, quiet dip 19.5-28 s, full from 31.5 s.
// Captions slam in word by word (nidi's Kinetic style) in the app's font; *word* turns sunset gold.
import React from 'react';
import {AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, font, FPS, sunset} from './theme';

type Shot = {clip: string; at: number; dur: number; cap: string; startFrom?: number};

const HERO: Shot[] = [
	{clip: 's01', at: 0, dur: 4.8, cap: 'Drop-off can be *hard*.'},
	{clip: 's04', at: 4.8, dur: 4.8, cap: 'Little hearts miss *home*.'},
	{clip: 's02', at: 9.6, dur: 3.2, cap: 'So their teacher calls *you*.', startFrom: 1.7},
	{clip: 's03', at: 12.8, dur: 4.8, cap: 'Your face. Your *voice*.'},
	{clip: 's05', at: 17.6, dur: 4.2, cap: 'A live AI avatar of you.\nFrom *one photo*.'},
	{clip: 's06', at: 21.8, dur: 4.6, cap: 'It asks. It *listens*. It calms.'},
	{clip: 'flag', at: 26.4, dur: 3.8, cap: 'Hurt? It tells the *grown-up*.'},
	{clip: 's08', at: 30.2, dur: 4.4, cap: "You'll *know*. Every time."},
	{clip: 's07', at: 34.6, dur: 4.6, cap: 'How they felt.\nWhat they *said*.'},
	{clip: 's10', at: 39.2, dur: 4.6, cap: 'Daycare or home.\n*Always there*.'},
];
const HERO_END = 43.8;
export const PROMO_FRAMES = Math.round(52 * FPS);

const SOCIAL: Shot[] = [
	{clip: 's01', at: 0, dur: 3.4, cap: 'Drop-off can be *hard*.'},
	{clip: 's02', at: 3.4, dur: 3.4, cap: 'So their teacher\ncalls *you*.', startFrom: 1.5},
	{clip: 's03', at: 6.8, dur: 4.2, cap: 'Your face.\nYour *voice*.'},
	{clip: 's06', at: 11.0, dur: 3.6, cap: 'It listens.\nIt *calms*.'},
	{clip: 'flag', at: 14.6, dur: 3.4, cap: 'Hurt? It tells\nthe *grown-up*.'},
	{clip: 's08', at: 18.0, dur: 3.8, cap: "You'll *know*.\nEvery time."},
	{clip: 's07', at: 21.8, dur: 3.0, cap: 'How they *felt*.'},
];
const SOCIAL_END = 24.8;
export const SOCIAL_FRAMES = Math.round(30 * FPS);

const Kinetic: React.FC<{text: string; size: number; vertical: boolean}> = ({text, size, vertical}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	let index = 0;
	const lines = text.split('\n').map((l) => l.split(' ').filter(Boolean));
	return (
		<div style={{position: 'absolute', ...(vertical ? {left: 60, right: 60, top: 1330, textAlign: 'center'} : {left: 110, right: 600, bottom: 120}), fontFamily: font, fontWeight: 700, fontSize: size, lineHeight: 1.08, letterSpacing: -1}}>
			{lines.map((words, li) => (
				<div key={li}>
					{words.map((raw, wi) => {
						const i = index++;
						const gold = raw.startsWith('*');
						const word = raw.replace(/\*/g, '');
						const local = frame - 4 - i * 3;
						const s = spring({frame: local, fps, config: {damping: 11, stiffness: 190, mass: 0.6}});
						return (
							<span
								key={wi}
								style={{
									display: 'inline-block',
									marginRight: size * 0.24,
									opacity: interpolate(local, [0, 3], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
									transform: `translateY(${(1 - s) * 34}px) scale(${interpolate(s, [0, 1], [1.6, 1])})`,
									filter: `blur(${Math.max(0, (1 - s) * 8)}px)`,
									color: gold ? C.gold : '#FFFFFF',
									textShadow: gold ? '0 0 26px rgba(255,200,87,0.7), 0 4px 18px rgba(0,0,0,0.55)' : '0 4px 22px rgba(0,0,0,0.6)',
								}}
							>
								{word}
							</span>
						);
					})}
				</div>
			))}
		</div>
	);
};

/** One shot: the keyed clip with a slow push-in; the flag shot is the real phone recording in a phone frame. */
const ShotView: React.FC<{shot: Shot; vertical: boolean}> = ({shot, vertical}) => {
	const frame = useCurrentFrame();
	const durF = Math.round(shot.dur * FPS);
	const push = interpolate(frame, [0, durF], [1.0, 1.05]);
	const fadeIn = interpolate(frame, [0, 5], [0, 1], {extrapolateRight: 'clamp'});
	if (shot.clip === 'flag') {
		const h = vertical ? 1000 : 1000;
		const w = Math.round((h * 1080) / 2340);
		return (
			<AbsoluteFill style={{background: sunset, opacity: fadeIn}}>
				<div style={{position: 'absolute', width: w, height: h, left: vertical ? (1080 - w) / 2 : 1920 - w - 110, top: vertical ? 250 : 40, borderRadius: 46, overflow: 'hidden', border: '10px solid #1d1730', boxShadow: '0 30px 80px rgba(43,33,64,0.45)', transform: `scale(${interpolate(frame, [0, durF], [1, 1.06])})`, transformOrigin: '50% 18%'}}>
					<OffthreadVideo src={staticFile('promo/flag.mp4')} muted style={{width: '100%', height: '100%'}} />
				</div>
			</AbsoluteFill>
		);
	}
	const video = (
		<OffthreadVideo
			src={staticFile(`promo/${shot.clip}.mp4`)}
			muted
			startFrom={Math.round((shot.startFrom ?? 0) * FPS)}
			style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${push})`}}
		/>
	);
	if (vertical) {
		// Vertical: the 16:9 shot sits full width in the middle; the sunset fills above and below.
		return (
			<AbsoluteFill style={{background: sunset, opacity: fadeIn}}>
				<div style={{position: 'absolute', left: -150, width: 1380, top: 520, height: 776, overflow: 'hidden', borderRadius: 0}}>{video}</div>
			</AbsoluteFill>
		);
	}
	return <AbsoluteFill style={{opacity: fadeIn}}>{video}</AbsoluteFill>;
};

const Shade: React.FC<{vertical: boolean}> = ({vertical}) =>
	vertical ? null : <AbsoluteFill style={{background: 'linear-gradient(to top, rgba(20,12,35,0.62) 0%, rgba(20,12,35,0.0) 38%)'}} />;

const Note: React.FC<{vertical: boolean}> = ({vertical}) => (
	<div style={{position: 'absolute', ...(vertical ? {left: 0, right: 0, bottom: 60, textAlign: 'center', color: 'rgba(43,33,64,0.7)'} : {right: 46, bottom: 34, color: 'rgba(255,255,255,0.72)'}), fontFamily: font, fontSize: vertical ? 26 : 22, fontWeight: 500}}>
		Real app screens and calls · AI-generated people
	</div>
);

const Brand: React.FC = () => (
	<div style={{position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22, fontFamily: font, fontWeight: 700, fontSize: 64, color: C.ink}}>
		<Img src={staticFile('everthere-icon.svg')} style={{width: 92, height: 92, borderRadius: 22}} />
		EverThere
	</div>
);

const EndCard: React.FC<{vertical: boolean}> = ({vertical}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame, fps, config: {damping: 12, stiffness: 110}});
	const fade = (a: number) => interpolate(frame, [a, a + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{background: sunset, alignItems: 'center', justifyContent: 'center', fontFamily: font, color: C.ink, textAlign: 'center', padding: 70}}>
			<Img src={staticFile('everthere-icon.svg')} style={{width: vertical ? 300 : 240, height: vertical ? 300 : 240, borderRadius: 60, transform: `scale(${s})`, boxShadow: '0 28px 70px rgba(43,33,64,0.35)'}} />
			<div style={{marginTop: 44, fontSize: vertical ? 120 : 110, fontWeight: 700, opacity: fade(6)}}>EverThere</div>
			<div style={{marginTop: 8, fontSize: vertical ? 54 : 52, fontWeight: 600, opacity: fade(14)}}>Be there, even when you can’t.</div>
			<div style={{marginTop: 34, fontSize: vertical ? 32 : 30, fontWeight: 500, color: '#3f3358', opacity: fade(24)}}>Live AI avatars by Napster · on Microsoft Azure</div>
			<div style={{marginTop: 10, fontSize: vertical ? 30 : 28, fontWeight: 500, color: '#3f3358', opacity: fade(30)}}>github.com/mallelavamshi/everthere-app</div>
		</AbsoluteFill>
	);
};

const Cut: React.FC<{shots: Shot[]; end: number; total: number; vertical: boolean; musicFrom: number}> = ({shots, end, total, vertical, musicFrom}) => {
	const frame = useCurrentFrame();
	const musicVol = interpolate(frame, [0, 10, total - 50, total - 2], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{background: sunset}}>
			<Audio src={staticFile('music/discover.mp3')} startFrom={Math.round(musicFrom * FPS)} volume={musicVol} />
			{shots.map((shot, i) => (
				<Sequence key={i} from={Math.round(shot.at * FPS)} durationInFrames={Math.round(shot.dur * FPS)}>
					<ShotView shot={shot} vertical={vertical} />
					<Shade vertical={vertical} />
					{vertical ? <Brand /> : null}
					<Kinetic text={shot.cap} size={vertical ? 86 : 92} vertical={vertical} />
					<Note vertical={vertical} />
				</Sequence>
			))}
			<Sequence from={Math.round(end * FPS)}>
				<EndCard vertical={vertical} />
			</Sequence>
		</AbsoluteFill>
	);
};

export const Promo: React.FC = () => <Cut shots={HERO} end={HERO_END} total={PROMO_FRAMES} vertical={false} musicFrom={0} />;
export const PromoSocial: React.FC = () => <Cut shots={SOCIAL} end={SOCIAL_END} total={SOCIAL_FRAMES} vertical musicFrom={28.0} />;
