import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fredoka is bundled locally (never loaded from a CDN at runtime).
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './theme/global.css';
import { Capacitor } from '@capacitor/core';
import { App } from './App';
import { PhoneFrame, shouldFrame } from './shell/PhoneFrame';

// On a wide browser (the hosted web build), show the app inside a phone; the app itself then boots in the iframe.
const framed = shouldFrame({ native: Capacitor.isNativePlatform(), isTop: window.self === window.top, width: window.innerWidth, search: window.location.search });

createRoot(document.getElementById('root')!).render(<StrictMode>{framed ? <PhoneFrame /> : <App />}</StrictMode>);
