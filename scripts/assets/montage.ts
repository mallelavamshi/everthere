// Dev helper: tsx assets/montage.ts out.png file1 file2 ... (tiles at 400px over magenta to expose halos)
import sharp from 'sharp';
const [out, ...files] = process.argv.slice(2);
const bg = process.env.MBG ?? '#888888';
const tiles = await Promise.all(files.map((f) => sharp(f).resize(400, 400, { fit: 'contain', background: bg }).png().toBuffer()));
await sharp({ create: { width: 400 * tiles.length, height: 400, channels: 3, background: bg } })
  .composite(tiles.map((input, i) => ({ input, left: i * 400, top: 0 }))).png().toFile(out!);
