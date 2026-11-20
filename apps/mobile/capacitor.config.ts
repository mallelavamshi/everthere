import type { CapacitorConfig } from '@capacitor/cli';
import type { KeyboardResize } from '@capacitor/keyboard';

// CAP_DEV_HTTP_API=1 at `cap sync` time lets the https://localhost WebView call the local dev API over http
// (http://10.0.2.2:8787 on the emulator). Never set it for release builds.
const devHttpApi = process.env.CAP_DEV_HTTP_API === '1';

const config: CapacitorConfig = {
  appId: 'app.everthere',
  appName: 'EverThere',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: devHttpApi },
  // Shrink the WebView above the keyboard so a sticky footer sits on top of it (iOS honours this; see lib/native.ts).
  plugins: { Keyboard: { resize: 'native' as unknown as KeyboardResize } },
};

export default config;
