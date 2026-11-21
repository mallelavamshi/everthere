// Records short real calls on the emulator (signed in as the demo teacher) for the promo's device screens:
// from the Call tap through the dialing face to the avatar's live greeting. Uses the emulator's own recorder
// (adb emu screenrecord; nidi measured it keeps ~28 fps, far better than adb shell screenrecord).
// Run from scripts/marketing/promo:  CDP_PORT=9333 node capture_calls.mjs [phone|tablet] <name>...
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { click, connect, evaluate, text } from '../demo/cdp.mjs';

const ADB = 'V:/android-sdk/platform-tools/adb.exe';
const DEV = 'emulator-5554';
const OUT = path.resolve(import.meta.dirname, '../out/promo/screens');
fs.mkdirSync(OUT, { recursive: true });
const adb = (...a) => spawnSync(ADB, ['-s', DEV, ...a], { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (re, ms = 1500) => { console.log(await click(re)); await sleep(ms); };

const CALLS = {
  'sarah-mia': { tile: 'Daddy \\+ Mommy', pick: 'Call Mommy$', reason: 'Missing Mommy', call: "Call Mommy's avatar" },
  'david-leo': { tile: 'Daddy ready', pick: null, reason: 'Missing Daddy', call: "Call Daddy's avatar" },
  'hannah-ava': { tile: 'Mommy \\+ Baba', pick: 'Call Mommy$', reason: 'Missing Mommy', call: "Call Mommy's avatar" },
  'priya-sam': { tile: 'Mama ready', pick: null, reason: 'Missing Mama', call: "Call Mama's avatar" },
};

const [form, ...names] = process.argv.slice(2);
await connect();
for (const name of names) {
  const c = CALLS[name];
  const file = `/sdcard/${name}-${form}.webm`.replace('/sdcard/', '');
  const host = path.join(OUT, `${name}-${form}.webm`).replace(/\\/g, '/');
  await tap(c.tile, 2500);
  if (c.pick) await tap(c.pick, 2000);
  await tap(c.reason, 1200);
  adb('emu', 'screenrecord', 'start', '--fps', '30', '--bit-rate', '10000000', '--time-limit', '60', host);
  await sleep(800);
  await tap(c.call, 500);
  // until the avatar's greeting has played for a while
  const end = Date.now() + 60000;
  let liveAt = 0;
  while (Date.now() < end) {
    const st = await evaluate(`(document.querySelector('[data-testid=live-session]')?.dataset.state || '') + '|' + (document.querySelector('[data-testid=live-captions]')?.innerText || '').length`);
    const [state, len] = String(st).split('|');
    if (state === 'live' && Number(len) > 20 && !liveAt) liveAt = Date.now();
    if (liveAt && Date.now() - liveAt > 14000) break;
    await sleep(400);
  }
  adb('emu', 'screenrecord', 'stop');
  console.log(name, 'recorded', liveAt ? 'live' : 'NOT LIVE', host, file);
  await tap('End call', 6500);
  await tap('Skip for now', 3000);
}
process.exit(0);
