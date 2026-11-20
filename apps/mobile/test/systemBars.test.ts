import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colors } from '../src/theme/tokens';

// Device test M-4: under Android 15 edge-to-edge on WebView < 140, Capacitor pads the window for the system bars and
// StatusBar.setBackgroundColor is ignored, so a flat light strip showed above the yellow and peach screens.
const setColors = vi.fn(async (_o: { top: string; bottom: string }) => {});
const setBackgroundColor = vi.fn(async (_o: { color: string }) => {});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ setColors }),
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: vi.fn(async () => {}), setBackgroundColor },
  Style: { Light: 'LIGHT' },
}));

const { setStatusBar } = await import('../src/lib/native');
const android = (p: string) => readFileSync(path.resolve(import.meta.dirname, '../android/app/src/main', p), 'utf8');

describe('system bar colours (device test M-4)', () => {
  beforeEach(() => {
    setColors.mockClear();
    setBackgroundColor.mockClear();
  });

  it('paints the window behind the system bars to match each screen background', () => {
    setStatusBar('sunGradient');
    expect(setColors).toHaveBeenLastCalledWith({ top: colors.sunSoft, bottom: colors.cream });
    setStatusBar('sunset');
    expect(setColors).toHaveBeenLastCalledWith({ top: colors.sunsetPeach, bottom: colors.sunsetDusk });
    setStatusBar('cream');
    expect(setColors).toHaveBeenLastCalledWith({ top: colors.cream, bottom: colors.cream });
    // Pre-Android-15 devices still get the status bar colour itself.
    expect(setBackgroundColor).toHaveBeenLastCalledWith({ color: colors.cream });
  });

  it('a failing native call never throws', () => {
    setColors.mockRejectedValueOnce(new Error('not implemented'));
    expect(() => setStatusBar('cream')).not.toThrow();
  });

  it('MainActivity registers the WindowBackground plugin and the theme starts on cream (no white flash)', () => {
    const main = android('java/app/everthere/MainActivity.java');
    expect(main).toMatch(/registerPlugin\(WindowBackgroundPlugin\.class\)/);
    const plugin = android('java/app/everthere/WindowBackgroundPlugin.java');
    expect(plugin).toMatch(/@CapacitorPlugin\(name = "WindowBackground"\)/);
    expect(plugin).toMatch(/setColors/);
    expect(android('res/values/styles.xml')).toMatch(/<item name="android:windowBackground">@color\/et_cream<\/item>/);
  });
});
