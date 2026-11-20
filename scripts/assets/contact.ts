// Builds out/contact.html (all candidates, grouped) and out/picks.json (default pick 1 per key).
// Usage: tsx assets/contact.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, type AssetSpec } from './assetList';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const exists = (p: string) => fs.access(p).then(() => true, () => false);

const rows: Record<string, string[]> = {};
const picks: Record<string, number> = {};
const missing: string[] = [];

async function row(a: AssetSpec) {
  const have: number[] = [];
  for (let i = 1; i <= 4; i++) if (await exists(path.join(OUT, 'candidates', a.key, `${i}.png`))) have.push(i);
  if (!have.length) return missing.push(a.key);
  picks[a.key] = 1;
  const cells = have
    .map(
      (i) =>
        `<figure class="${a.transparent ? 'chk' : ''}"><img loading="lazy" src="candidates/${a.key}/${i}.png"><figcaption>${i}</figcaption></figure>`,
    )
    .join('');
  (rows[a.group] ??= []).push(
    `<section><h3>${a.key} <small>${a.size}${a.transparent ? ' · transparent' : ''}</small></h3><div class="r ${a.size === '1792x1024' ? 'w' : ''}">${cells}</div></section>`,
  );
}

for (const a of ASSETS) await row(a);

const html = `<!doctype html><meta charset="utf-8"><title>EverThere asset contact sheet</title>
<style>
body{font-family:system-ui;background:#FFF8EC;color:#2B2140;margin:16px}
h2{margin-top:40px;border-bottom:3px solid #FFD23F;text-transform:capitalize}
h3{margin:18px 0 6px}small{font-weight:400;opacity:.6}
.r{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.r.w{grid-template-columns:repeat(2,1fr)}
figure{margin:0}img{width:100%;display:block;border-radius:10px}
figcaption{font-weight:700;font-size:20px}
.chk{background:conic-gradient(#ddd 25%,#fff 0 50%,#ddd 0 75%,#fff 0) 0 0/20px 20px;border-radius:10px}
.chk img{mix-blend-mode:multiply}
</style><h1>Contact sheet</h1><p>Edit <code>picks.json</code> (key to 1-4). Transparent assets are shown on a checkerboard with the cream background still present until removeBg; the multiply blend only approximates it.</p>
${Object.entries(rows).map(([g, r]) => `<h2>${g}</h2>${r.join('')}`).join('\n')}`;

await fs.writeFile(path.join(OUT, 'contact.html'), html);
await fs.writeFile(path.join(OUT, 'picks.json'), JSON.stringify(picks, null, 2) + '\n');
console.log(`rows: ${Object.keys(picks).length}, missing: ${missing.join(', ') || 'none'}`);
