import React from 'react';
import {Composition} from 'remotion';
import {Demo, DEMO_FRAMES} from './Demo';
import {FPS} from './theme';

export const RemotionRoot: React.FC = () => (
	<>
		<Composition id="Demo" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{vertical: false}} />
		<Composition id="DemoVertical" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1080} height={1920} defaultProps={{vertical: true}} />
	</>
);
