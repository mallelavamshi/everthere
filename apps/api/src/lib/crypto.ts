const utf8 = new TextEncoder();

/** Lowercase hex HMAC-SHA256 of `msg` under the UTF-8 string `key`. */
export async function hmacHex(key: string, msg: string): Promise<string> {
  return hmacHexBytes(utf8.encode(key), msg);
}

/** Lowercase hex HMAC-SHA256 of `msg` (UTF-8) under raw key bytes (e.g. a base64-decoded secret). */
export async function hmacHexBytes(keyBytes: Uint8Array, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings (byte-wise); differing lengths compare unequal without early exit. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
