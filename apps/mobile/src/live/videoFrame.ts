import { useEffect, useState, type RefObject } from 'react';

/** Napster streams landscape video; this stands in until the SDK's <video> reports its real size. */
export const DEFAULT_VIDEO = { width: 1280, height: 720 } as const;

export interface VideoFrame {
  /** width / height of the video, which is also the avatar frame's aspect ratio. */
  aspect: number;
  /** The video's intrinsic width in px: the frame is never wider in CSS px (so it is never upscaled past DPR). */
  maxWidth: number;
}

/**
 * A transparent 1x1 GIF. The SDK's own poster (a dark square when no avatar photo is set) showed in the frame while
 * connecting, and with no poster at all Android WebView draws its own grey placeholder with a big play icon (phone
 * recheck, task 26c round 3). This one draws nothing.
 */
export const TRANSPARENT_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** HTMLMediaElement.HAVE_CURRENT_DATA: there is a frame to show. */
const HAVE_CURRENT_DATA = 2;

export function videoFrame(width?: number, height?: number): VideoFrame {
  const ok = !!width && !!height && width > 0 && height > 0;
  const w = ok ? width : DEFAULT_VIDEO.width;
  const h = ok ? height : DEFAULT_VIDEO.height;
  return { aspect: w / h, maxWidth: w };
}

/**
 * Device test P-3: the frame takes the avatar video's own aspect ratio, so there is no empty area above or below it.
 * Watches the SDK's mount container for its <video> (`.np_companion-avatar-video`, 2.0.0 bundle) and reads
 * videoWidth/videoHeight on loadedmetadata and resize (the stream can change size). 16:9 until then.
 */
export function useVideoFrame(container: RefObject<HTMLElement | null>): VideoFrame {
  const [frame, setFrame] = useState<VideoFrame>(() => videoFrame());
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let video: HTMLVideoElement | null = null;
    const read = () => {
      if (!video || !video.videoWidth || !video.videoHeight) return;
      const next = videoFrame(video.videoWidth, video.videoHeight);
      setFrame((cur) => (cur.aspect === next.aspect && cur.maxWidth === next.maxWidth ? cur : next));
    };
    // Until the stream has a frame the video is kept invisible (opacity 0 via [data-et-waiting] in global.css, never
    // display:none, so playback is unaffected): only our own connecting UI shows in the frame (task 26c round 3).
    const reveal = () => video?.removeAttribute('data-et-waiting');
    const attach = () => {
      const v = root.querySelector<HTMLVideoElement>('video.np_companion-avatar-video') ?? root.querySelector('video');
      if (v === video) return;
      video?.removeEventListener('loadedmetadata', read);
      video?.removeEventListener('resize', read);
      video?.removeEventListener('playing', reveal);
      video?.removeEventListener('loadeddata', reveal);
      video = v;
      if (video) {
        video.setAttribute('poster', TRANSPARENT_POSTER);
        if (video.readyState < HAVE_CURRENT_DATA) video.setAttribute('data-et-waiting', '');
        video.addEventListener('playing', reveal);
        video.addEventListener('loadeddata', reveal);
      }
      video?.addEventListener('loadedmetadata', read);
      video?.addEventListener('resize', read);
      read();
    };
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      video?.removeEventListener('loadedmetadata', read);
      video?.removeEventListener('resize', read);
      video?.removeEventListener('playing', reveal);
      video?.removeEventListener('loadeddata', reveal);
    };
  }, [container]);
  return frame;
}

const landscapeQuery = '(orientation: landscape)';
const isLandscape = () => typeof window !== 'undefined' && !!window.matchMedia?.(landscapeQuery).matches;

/** True in landscape; follows rotation. Captions overlay the frame in landscape and sit below it in portrait. */
export function useLandscape(): boolean {
  const [on, setOn] = useState(isLandscape);
  useEffect(() => {
    const mq = window.matchMedia?.(landscapeQuery);
    const update = () => setOn(isLandscape());
    update();
    mq?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return on;
}
