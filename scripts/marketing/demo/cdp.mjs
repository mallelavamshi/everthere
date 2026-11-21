// Tiny CDP helper for the app's WebView on the phone (forwarded to localhost:PORT). Exports evaluate(js) and click(regex).
const PORT = process.env.CDP_PORT ?? '9444';
let ws, id = 0;
const pending = new Map();
export async function connect() {
  const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
  ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
}
export function evaluate(expression) {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  return new Promise((r) => pending.set(n, (m) => r(m.result?.result?.value)));
}
export const click = (re) => evaluate(`(() => { const re = new RegExp(${JSON.stringify(re)}, 'i');
  const els = [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=option]')].filter(e => e.offsetParent !== null);
  const el = els.find(e => re.test((e.getAttribute('aria-label')||'') + ' ' + e.innerText));
  if (!el) return 'NOT FOUND ' + ${JSON.stringify(re)};
  el.click(); return 'clicked ' + (el.getAttribute('aria-label')||el.innerText).slice(0,40).replace(/\s+/g,' '); })()`);
export const text = () => evaluate("location.pathname + ' | ' + document.body.innerText.slice(0, 200).split(String.fromCharCode(10)).join(' / ')");
export const close = () => ws?.close();
