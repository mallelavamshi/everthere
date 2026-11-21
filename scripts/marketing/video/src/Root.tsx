import React from 'react';
import {Composition} from 'remotion';
import {Demo, DEMO_FRAMES} from './Demo';
import {FPS} from './theme';
import {Promo, PROMO_FRAMES, PromoSocial, SOCIAL_FRAMES} from './Promo';

export const RemotionRoot: React.FC = () => (
	<>
		<Composition id="Demo" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{vertical: false}} />
		<Composition id="Promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={FPS} width={1920} height={1080} />
		<Composition id="PromoSocial" component={PromoSocial} durationInFrames={SOCIAL_FRAMES} fps={FPS} width={1080} height={1920} />
		<Composition id="DemoVertical" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1080} height={1920} defaultProps={{vertical: true}} />
	</>
);
