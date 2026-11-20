import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppAway } from './useAppAway';
import { lightingVerdict, meanLuma, type Lighting } from '../../lib/image';

export type CameraStatus = 'starting' | 'live' | 'unavailable';
export type Facing = 'user' | 'environment';

/** How often the lighting chip re-reads the picture. */
export const LIGHTING_MS = 500;

/** Mean luma of the current video frame, sampled on a tiny canvas. null while there is nothing to sample. */
function sampleLuma(video: HTMLVideoElement | null, canvas: HTMLCanvasElement): number | null {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  canvas.width = 48;
  canvas.height = 36;
  ctx.drawImage(video, 0, 0, 48, 36);
  return meanLuma(ctx.getImageData(0, 0, 48, 36));
}

/**
 * The live front camera for the avatar photo. While `enabled` (and the app is in the foreground) it holds a
 * MediaStream; when it is turned off, the component unmounts, or the app goes to the background, EVERY track is
 * stopped so the camera light goes out. Coming back to the foreground restarts it only if still `enabled`.
 */
export function useCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [lighting, setLighting] = useState<Lighting | null>(null);
  // Backgrounded: release the camera (the light must go out), and take it back on return if we are still wanted.
  const away = useAppAway();
  const active = enabled && !away;

  useEffect(() => {
    if (!active) return;
    let live = true;
    setStatus('starting');
    setLighting(null);
    const release = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    void (async () => {
      try {
        const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
        if (!md?.getUserMedia) throw new Error('Camera is not available here');
        const stream = await md.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        // Left the screen while the permission prompt was open: do not keep the camera.
        if (!live) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await Promise.resolve(v.play?.()).catch(() => {});
        }
        if (live) setStatus('live');
      } catch {
        if (live) setStatus('unavailable');
      }
    })();
    return () => {
      live = false;
      release();
    };
  }, [active, facing]);

  useEffect(() => {
    if (status !== 'live') return;
    const id = setInterval(() => {
      scratch.current ??= document.createElement('canvas');
      const luma = sampleLuma(videoRef.current, scratch.current);
      if (luma !== null) setLighting(lightingVerdict(luma));
    }, LIGHTING_MS);
    return () => clearInterval(id);
  }, [status]);

  /** A still of the current frame (not mirrored: the preview is, the saved photo is not). */
  const capture = useCallback(async (): Promise<Blob | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
  }, []);

  const flip = useCallback(() => setFacing((f) => (f === 'user' ? 'environment' : 'user')), []);

  return { videoRef, status, lighting, facing, capture, flip };
}
