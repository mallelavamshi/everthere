import { newId } from './ids';

export type MediaPurpose = 'child' | 'avatar' | 'logo';
export const MEDIA_PURPOSES: readonly MediaPurpose[] = ['child', 'avatar', 'logo'];
export const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type ImageType = keyof typeof IMAGE_EXT;

/** Server-generated key: `<purpose>/<ownerId>/<nanoid21>.<ext>`. */
export function makeMediaKey(purpose: MediaPurpose, ownerId: string, contentType: ImageType): string {
  return `${purpose}/${ownerId}/${newId()}.${IMAGE_EXT[contentType]}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True only for a key this server could have issued for exactly this purpose and owner. */
export function isOwnedKey(key: string, purpose: MediaPurpose, ownerId: string): boolean {
  return new RegExp(`^${escapeRe(purpose)}/${escapeRe(ownerId)}/[A-Za-z0-9_-]{21}\\.(jpg|png|webp)$`).test(key);
}
