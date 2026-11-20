import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';
import { toast } from '../ui';

/**
 * Picks a photo with the system UI (camera or gallery). Resolves null when the person backs out, which is not an
 * error; any other failure shows a gentle toast. `rear` opens the back camera (a logo, a classroom) instead of the selfie one.
 */
export async function pickPhoto(kind: 'camera' | 'gallery', opts: { rear?: boolean } = {}): Promise<Blob | null> {
  try {
    let path: string | undefined;
    if (kind === 'gallery') {
      const r = await Camera.pickImages({ limit: 1, quality: 92 });
      path = r.photos[0]?.webPath;
    } else {
      const p = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        direction: opts.rear ? CameraDirection.Rear : CameraDirection.Front,
        quality: 92,
        correctOrientation: true,
      });
      path = p.webPath;
    }
    if (!path) return null;
    return await (await fetch(path)).blob();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/cancel/i.test(msg)) toast.error("We couldn't open your photos just now. Please try again 💛");
    return null;
  }
}
