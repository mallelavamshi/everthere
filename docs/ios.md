# EverThere on iPhone (iOS)

The iOS app is the same React app as the Android one (`apps/mobile`), wrapped by Capacitor 8 in a native iOS
project at `apps/mobile/ios`. Nobody on the team has a Mac, so the iOS build runs on a GitHub macOS runner. It
produces an **unsigned iOS Simulator build**. It runs in a simulator (locally on a Mac, or in a browser through
Appetize.io) but cannot be installed on a real iPhone. A real-device or TestFlight build needs signing. See the last
section.

## What is in the iOS project

| Piece | Where | Notes |
| --- | --- | --- |
| Native project | `apps/mobile/ios/App/App.xcodeproj` | Capacitor plugins come in through Swift Package Manager (`ios/App/CapApp-SPM`), not CocoaPods. `cap sync ios` rewrites `Package.swift`. |
| App name, bundle id, version | `Info.plist`, `project.pbxproj` | "EverThere", `app.everthere`, 1.1 (2), the same as the APK. |
| Permission prompts | `ios/App/App/Info.plist` | Microphone (comfort and test calls), camera (avatar photo, daycare logo), photo library (pick an existing photo). |
| Icon and splash | `ios/App/App/Assets.xcassets` | Built by `node scripts/marketing/icon/buildIosAssets.mjs` from `everthere-icon.svg` and `apps/mobile/assets/splash.png`. |
| WebView origin | `capacitor://localhost` | Allowed by the API's CORS list (`APP_ORIGINS`) and Clerk's `CLERK_AUTHORIZED_PARTIES` (`apps/api/wrangler.toml`). |

The app code that behaves differently on iOS:

- **Backgrounding** (`src/lib/native.ts`, `onAppBackground`). iOS reports "inactive" (willResignActive) for the
  microphone permission alert, Control Center and the notification shade. On iOS the call therefore ends only on a
  real move to the background (`pause`, didEnterBackground). Android keeps its old rule, because there `pause` is
  the overlay event.
- **Microphone blocked screen** (`src/live/errorViews.ts`). On iOS it says: Settings → EverThere → turn on
  Microphone.
- **Platform-neutral copy.** The notification primer and the "security check" sign-in error no longer mention
  Android.

Capacitor's iOS WebView already allows inline video, autoplay with sound, and grants WebRTC mic access once iOS has
allowed it. The Napster avatar needs no extra native code.

## Get the simulator build from CI

The workflow `.github/workflows/ios.yml` ("iOS simulator build") runs on every push that touches `apps/mobile/**`,
`packages/shared/**` or the lockfile. You can also start it by hand. After building, it installs the app in an iPhone simulator and
runs the Maestro smoke test, so a green run means the app also starts and signs in.

1. Go to GitHub → **Actions** → **iOS simulator build**. To build now, click **Run workflow** and choose a branch.
2. Open a green run. Under **Artifacts**, download **EverThere-ios-simulator**.
3. GitHub wraps artifacts in a zip, so unzip it once. Inside is **`EverThere-simulator.zip`**, which is the zipped
   `App.app`. Keep it zipped for Appetize.

From a terminal:

```powershell
gh run list -R mallelavamshi/everthere --workflow ios.yml --limit 5
```

```powershell
gh run download <run-id> -R mallelavamshi/everthere -n EverThere-ios-simulator
```

The build reads two values from repo secrets: `VITE_API_BASE` (the deployed API URL) and
`VITE_CLERK_PUBLISHABLE_KEY`. Both are public by design, because they ship inside every app bundle. Change them under
GitHub → Settings → Secrets and variables → Actions. No signing certificate or Apple account is involved.

The repo is public, so the macOS runner minutes are free.

## Run it in a browser with Appetize.io

Appetize streams a real iOS Simulator into a browser tab, so anyone can try the app from Windows. Creating the
Appetize account is your call (it has a free tier with limited monthly minutes; check their pricing page).

1. Sign up at appetize.io.
2. Choose **Upload** and pick `EverThere-simulator.zip` (the zipped `.app`, not the GitHub artifact wrapper).
   Platform: iOS.
3. Open the app's page and pick an iPhone model and iOS version. The build targets iOS 15 and later.
4. To share it, copy the public link from the app's page. Judges can open it with no install.
5. For a new build, use **Update** on the same app so the link stays the same.

What to expect in Appetize (none of this has been tried yet):

- Sign-in, the demo, plans, summaries and alerts work as they do on the web build, since they are plain HTTPS to the
  API.
- **Live calls need a microphone.** An Appetize session may not pass the computer's microphone into the simulator.
  The call can then stop at the "We need the microphone" screen, or the avatar may not hear the child. The hosted
  web build (https://everthere-web.m-vamshikrishna22.workers.dev) is still the most reliable way to show a live call
  from a laptop.
- The camera in a simulator is a placeholder. The avatar photo step falls back to "pick a photo".

## A real iPhone or TestFlight build (needs you)

A signed build can be installed on a phone or sent through TestFlight and the App Store. It needs things only the
account owner can do:

1. **Join the Apple Developer Program** ($99 per year, at developer.apple.com) with your own Apple ID. Enrolment can
   take a day or two.
2. **Register the bundle id** `app.everthere` (or change it) under Certificates, Identifiers & Profiles.
3. **Create signing material.** You need an Apple Distribution certificate and an App Store provisioning profile.
   The other option is an App Store Connect API key for automatic signing. Never commit these. In CI they would go
   into GitHub encrypted secrets and a temporary keychain on the runner. For example, Fastlane `match`, or
   `xcodebuild -allowProvisioningUpdates` with the API key.
4. **Create the app in App Store Connect.** Add the name, privacy details and the microphone/camera usage strings,
   which already exist in `Info.plist`.
5. **Archive and upload.** That means `xcodebuild archive` on a `generic/platform=iOS` destination, then
   `xcodebuild -exportArchive` and an upload with `xcrun altool` or Transporter. TestFlight internal testers can then
   install it. External testers need a short Beta App Review.

This repo does not try any of this yet. The CI workflow stays unsigned (`CODE_SIGNING_ALLOWED=NO`).

## What has and has not been verified

- Verified:
  - The iOS project is generated and committed.
  - The API and mobile unit tests pass, including the new iOS-specific tests (`apps/mobile/test/ios.test.tsx`,
    `apps/api/test/cors.test.ts`).
  - The CI workflow compiles the simulator `.app`
    ([first green run](https://github.com/mallelavamshi/everthere/actions/runs/44991692505)).
  - The artifact was inspected: a universal simulator binary (x86_64 and arm64), the web bundle pointed at the
    deployed API, the three permission strings, and version 1.1.
  - The app runs in an iPhone simulator on CI. A Maestro test (`apps/mobile/e2e/ios-demo-parent.yaml`) starts the
    app and taps **Try the demo** → **Peek as a Parent**. It then reaches the parent home, which needs Clerk sign-in
    from `capacitor://localhost` and an authorized call to the deployed API
    ([run with screenshots](https://github.com/mallelavamshi/everthere/actions/runs/44992370247), artifact
    **EverThere-ios-screenshots**).
- Not verified: nothing has run on a real iPhone. CI has no microphone, so the simulator test stops before a call.
  Still to check on a device or in Appetize:
  - The microphone prompt and a live Napster call.
  - Audio routing to the speaker during a call.
  - Keeping the screen awake during a call. The Wake Lock API is only in recent iOS versions.
  - Local notifications.
