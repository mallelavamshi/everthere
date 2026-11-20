// Invite codes: shared by the API (createInvite) and scripts/seed (demo fixture codes generated at seed time).

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars: no 0/O/1/I/L
export const CODE_LENGTH = 6;

/** Uniform random code; bytes >= 248 (the largest multiple of 31 <= 256) are rejected to avoid modulo bias. */
export function generateCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < CODE_LENGTH) {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    for (const b of buf) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}
