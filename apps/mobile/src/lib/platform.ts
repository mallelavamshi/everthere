import { Capacitor } from '@capacitor/core';

/** Where the app is running: the Android app, the iOS app (WKWebView), or a browser (the hosted web build). */
export type AppPlatform = 'ios' | 'android' | 'web';

/** Never throws: anything Capacitor cannot name (or a missing bridge) counts as the web. */
export function appPlatform(): AppPlatform {
  try {
    const p = Capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}
