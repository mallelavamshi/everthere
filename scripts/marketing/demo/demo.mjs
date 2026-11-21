// Drives the real EverThere app on the user's phone through the whole judge journey while scrcpy records the screen and
// the app's audio. The child's lines (edge-tts, en-US-AnaNeural) are played from the PC speakers so the phone's mic
// really hears them; each plays only after the avatar has finished talking (its caption has stopped changing).
// Step times (seconds from the start of the recording) go to out/demo/<take>.log for the edit.
//
// Run from scripts/marketing/demo:  node demo.mjs <take>      (phone unlocked, app open, CDP forwarded to :9444)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { click, connect, evaluate, text } from './cdp.mjs';

const take = process.argv[2] ?? 'take1';
const OUT = path.resolve(import.meta.dirname, '../out/demo');
const SERIAL = 'adb-R5CY12KVHMD-CNOGdt._adb-tls-connect._tcp';
const ADB = 'V:/android-sdk/platform-tools/adb.exe';
const SCRCPY = 'V:/tools/scrcpy-v5.0.1/scrcpy-win64-v5.0.1/scrcpy.exe';
fs.mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `${take}.log`);
fs.writeFileSync(logFile, '');

let t0 = 0;
const now = () => ((Date.now() - t0) / 1000).toFixed(2);
const log = (m) => {
  const line = `${now()}\t${m}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => spawnSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8' });
const say = (name) => {
  log(`CHILD ${name}`);
  spawnSync('python', ['-I', path.join(import.meta.dirname, 'play.py'), path.join(import.meta.dirname, 'audio', `${name}-loud.mp3`), process.env.GAIN ?? '1.0']);
  log(`CHILD done ${name}`);
};
const tap = async (re, wait = 1500) => {
  log(`${await click(re)}`);
  await sleep(wait);
};
const waitFor = async (re, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (new RegExp(re, 'i').test((await text()) ?? '')) return true;
    await sleep(400);
  }
  log(`TIMEOUT waiting for ${re}`);
  return false;
};
const captions = () => evaluate(`(document.querySelector('[data-testid=live-captions]')?.innerText || '').trim()`);
const state = () => evaluate(`document.querySelector('[data-testid=live-session]')?.dataset.state || 'none'`);

/** The avatar has spoken something new and its caption has not changed for `quiet` ms. */
async function avatarDone(before, quiet = 2200, ms = 60000) {
  // The caption text streams faster than the voice, so a quiet caption isn't the end of speech (take 1 spoke over the
  // song). Also wait until the reply's estimated speaking time (about 2 words a second, slower when singing) has passed since it began.
  const end = Date.now() + ms;
  let last = before, changed = 0, started = 0, sawNew = false;
  while (Date.now() < end) {
    const c = (await captions()) ?? '';
    if (c !== last) { last = c; changed = Date.now(); if (c && c !== before) { if (!sawNew) started = Date.now(); sawNew = true; } }
    if (sawNew && Date.now() - changed >= quiet) {
      const fresh = c.startsWith(before) ? c.slice(before.length) : c;
      const words = fresh.split(/\s+/).filter(Boolean).length;
      const speakEnd = started + (words / 2.0) * 1000 + 1500;
      if (Date.now() < speakEnd) await sleep(speakEnd - Date.now());
      log(`AVATAR said (${words} words): ${c.replace(/\s+/g, ' ').slice(-160)}`);
      return (await captions()) ?? c;
    }
    await sleep(250);
  }
  log('TIMEOUT avatar');
  return last;
}

await connect();

// ---- off camera: start signed out, on the Welcome screen
if (!/onboarding/.test((await text()) ?? '')) {
  await click('Open profile'); await sleep(1000); await click('^\\s*Sign out'); await sleep(3500);
}
adb('shell', 'am', 'force-stop', 'app.everthere');
await sleep(1500);
// The take opens on the home screen and taps the real EverThere icon (the user asked for it); find it first.
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
await sleep(2000);
adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
const ui = adb('shell', 'cat', '/sdcard/ui.xml').stdout;
const m = /content-desc="EverThere"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(ui);
if (!m) throw new Error('EverThere icon not found on the home screen');
const icon = { x: Math.round((+m[1] + +m[3]) / 2), y: Math.round((+m[2] + +m[4]) / 2) };
console.log('icon at', icon);

// ---- recording
// Video only: Android won't let scrcpy capture call (VoIP) audio, so the phone plays the avatar aloud and the laptop
// mic records the room (the avatar from the phone, the child from the PC speakers). scrcpy stops on its own timer
// (killing it can lose a file), so the take has a fixed length.
const LIMIT = Number(process.env.LIMIT ?? 420);
const rec = spawn(SCRCPY, ['-s', SERIAL, '--no-window', '--no-control', '--no-audio', `--record=${path.join(OUT, take + '.mkv')}`, '--max-fps=30', '--video-bit-rate=14M', `--time-limit=${LIMIT}`], {
  env: { ...process.env, ADB },
  stdio: 'ignore',
});
const stopFile = path.join(OUT, take + '.mic.stop');
fs.rmSync(stopFile, { force: true });
const mic = spawn('python', ['-I', path.join(import.meta.dirname, 'record_mic.py'), path.join(OUT, take + '.mic.wav'), stopFile], { stdio: 'ignore' });
await sleep(2500);
t0 = Date.now();
log(`REC start epoch ${t0}`);
await sleep(1500);

await sleep(2500); // a beat on the home screen
adb('shell', 'input', 'tap', String(icon.x), String(icon.y));
log('tap icon');
await sleep(4500);
// the WebView restarted: reconnect CDP to the new process
{
  const pid = adb('shell', 'pidof', 'app.everthere').stdout.trim();
  spawnSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9444', `localabstract:webview_devtools_remote_${pid}`]);
  await connect();
}
await waitFor('Try the demo');
await sleep(1500);

// ---- teacher: call Daddy for Mia
await tap('Try the demo', 2500);
await tap('Peek as a Teacher', 1000);
await waitFor('Butterflies Room');
await sleep(2500);
await tap('Daddy \\+ Mommy', 3000); // Mia's tile -> "Who should Mia talk to?" with both parents' faces
await tap('Call Daddy$', 2500);
await tap('Missing Daddy', 1500);
await tap("Call Daddy's avatar", 500);

let c = await avatarDone('', 2400, 90000); // dialing face, then Daddy's greeting
for (const [line, quiet] of [['01-miss', 2400], ['02-song', 3500], ['03-knee', 2600], ['04-okay', 2400], ['05-bye', 2400]]) {
  await sleep(700);
  say(line);
  c = await avatarDone(c, quiet);
}
await sleep(1500);
log(`state ${await state()}`);
await tap('End call', 6500);

// ---- check-in
await tap('Calmer', 1500);
await tap('Send to (Sarah|Vamshi)', 3500);
await tap('Back to the classroom', 2500);

// ---- parent: Sarah sees it
await tap('Open profile', 1200);
await tap('^\\s*Sign out', 3500);
await tap('Try the demo', 2500);
await tap('Peek as a Parent', 1000);
await waitFor('how things look for Mia');
await sleep(3000);
log('waiting for the summary (cut in the edit)');
await sleep(55000);
await evaluate('location.reload()');
await sleep(7000);
await tap('Alerts', 7000);
await evaluate(`(document.scrollingElement).scrollBy({ top: 400, behavior: 'smooth' })`);
await sleep(2500);
await tap('^\s*Back', 2500);
await tap('Sessions', 3500);
log(await evaluate(`(() => { const a = [...document.querySelectorAll('a,button,[role=button]')].find(e => /comfort call|felt better|still a little|calmer/i.test(e.innerText)); if (!a) return 'no session'; a.click(); return 'opened newest'; })()`));
await sleep(5000);
for (let i = 0; i < 7; i++) {
  await evaluate(`(() => { const s = [...document.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); (s || document.scrollingElement).scrollBy({ top: 240, behavior: 'smooth' }); })()`);
  await sleep(1600);
}
await sleep(2500);
log('END');
fs.writeFileSync(stopFile, '');
await new Promise((r) => mic.on('exit', r));
log('mic saved; waiting for the screen recording to reach its time limit');
await new Promise((r) => rec.on('exit', r));
log('video saved');
process.exit(0);
