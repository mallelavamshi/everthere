import type { AvatarView, Voice } from '@everthere/shared';
import { api } from '../../lib/api';

export type MediaPurpose = 'avatar' | 'child' | 'logo';

/** POST /api/media (multipart). The server accepts jpeg/png/webp up to 8MB and answers with the stored key. */
export async function uploadMedia(file: Blob, purpose: MediaPurpose, filename = 'photo.jpg', extra: Record<string, string> = {}): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append('purpose', purpose);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append('file', file, filename);
  return api<{ key: string; url: string }>('/media', { method: 'POST', body: form });
}

export interface ConsentBody {
  consentName: string;
  consentAccepted: true;
}

export const createAvatar = (b: ConsentBody & { photoKey: string; voiceId: Voice; parentTitle: string }) =>
  api<AvatarView>('/avatars', { method: 'POST', json: b });

/** A photo change REQUIRES fresh consent; a voice change does not. */
export const changePhoto = (id: string, photoKey: string, consent: ConsentBody) =>
  api<AvatarView>(`/avatars/${encodeURIComponent(id)}`, { method: 'PATCH', json: { photoKey, ...consent } });

export const changeVoice = (id: string, voiceId: Voice) => api<AvatarView>(`/avatars/${encodeURIComponent(id)}`, { method: 'PATCH', json: { voiceId } });

export const approveAvatar = (id: string) => api<AvatarView>(`/avatars/${encodeURIComponent(id)}/approve`, { method: 'POST' });

export const fetchAvatar = (id: string, signal?: AbortSignal) => api<AvatarView>(`/avatars/${encodeURIComponent(id)}`, { signal });
