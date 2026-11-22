// Build the iOS app icon and launch splash (apps/mobile/ios/App/App/Assets.xcassets), the iOS twin of
// buildAndroidIcon.mjs. Icon: everthere-icon.svg drawn as designed at 1024 px, square and opaque (iOS rounds the
// corners itself and rejects an icon with an alpha channel). Splash: apps/mobile/assets/splash.png (the hugging-heart
// art) flattened onto the app's cream, written to the three files the Splash image set lists.
// Run: node scripts/marketing/icon/buildIosAssets.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const XC = path.join(ROOT, 'apps/mobile/ios/App/App/Assets.xcassets');
const CREAM = '#FFF8EC'; // et_cream, the Android window background

const svg = fs.readFileSync(path.join(import.meta.dirname, 'everthere-icon.svg'));
const icon = await sharp(svg, { density: 384 }).resize(1024, 1024).flatten({ background: CREAM }).removeAlpha().png().toBuffer();
fs.writeFileSync(path.join(XC, 'AppIcon.appiconset/AppIcon-512@2x.png'), icon);

const splash = await sharp(path.join(ROOT, 'apps/mobile/assets/splash.png'))
  .resize(2732, 2732)
  .flatten({ background: CREAM })
  .removeAlpha()
  .png()
  .toBuffer();
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  fs.writeFileSync(path.join(XC, 'Splash.imageset', f), splash);
}
console.log('ios icon + splash written');
