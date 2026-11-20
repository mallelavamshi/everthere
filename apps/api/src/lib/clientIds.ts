/**
 * Napster `externalClientId` values. Napster keys per-client memory on this id and only accepts
 * `^[A-Za-z0-9_-]{1,32}$`, so raw app ids (which may contain dots, e.g. the seeded `demo.child.mia`) are never sent.
 * Instead the id is derived deterministically from a SHA-256 of a namespaced app id: stable for the same child
 * (memory carries over between sessions), safe for any input, and not reversible to the app id.
 */

/** What Napster accepts as an externalClientId. Every derived id is asserted against it before it leaves the API. */
export const EXTERNAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const utf8 = new TextEncoder();

/** Unpadded base64url of the SHA-256 of `s` (43 chars). */
async function sha256B64url(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(s)));
  let bin = '';
  for (const b of d) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws if `id` is not a valid Napster externalClientId (a programming error: derived ids always match). */
export function assertClientId(id: string): string {
  if (!EXTERNAL_CLIENT_ID_RE.test(id)) throw new Error('derived externalClientId is not valid for Napster');
  return id;
}

/** externalClientId for a child's comfort sessions: first 32 chars of base64url(SHA-256("child:" + childId)). */
export async function childClientId(childId: string): Promise<string> {
  return assertClientId((await sha256B64url(`child:${childId}`)).slice(0, 32));
}

/** externalClientId for an avatar's test calls: "t_" + first 30 chars of base64url(SHA-256("avatar:" + avatarId)). */
export async function testClientId(avatarId: string): Promise<string> {
  return assertClientId(`t_${(await sha256B64url(`avatar:${avatarId}`)).slice(0, 30)}`);
}
