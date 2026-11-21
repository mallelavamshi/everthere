// EverThere video theme: the app's own palette and font (Fredoka).
import {loadFont} from '@remotion/google-fonts/Fredoka';

export const {fontFamily: font} = loadFont('normal', {weights: ['400', '500', '600', '700'], subsets: ['latin']});
export const FPS = 30;
export const C = {
	ink: '#2B2140',
	cream: '#FFF8EC',
	sun: '#FFD23F',
	gold: '#FFC857',
	coral: '#FF7A59',
	lilac: '#E7DEFF',
	glow: '#FFE7B0',
	peach: '#F6B98E',
	dusk: '#8E6CC0',
};
export const sunset = `radial-gradient(circle at 50% 38%, ${C.glow} 0%, ${C.peach} 42%, ${C.dusk} 100%)`;
