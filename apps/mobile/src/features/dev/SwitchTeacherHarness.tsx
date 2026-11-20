import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '../../theme/global.css';
import { Toaster } from '../../ui';
import { SwitchTeacher } from '../caregiver/SwitchTeacher';

// Dev-only harness for scripts/pin-shots.mjs: the "Who's teaching?" sheet on its own, against a mocked API.
// Loaded only by that script (never imported by the app, so never bundled).

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div className="min-h-dvh bg-sun" />
      <SwitchTeacher
        open
        onClose={() => {}}
        orgId="org1"
        deviceId="dev1"
        acting={null}
        onSwitched={() => {}}
        onEndShift={() => {}}
        onDeviceGone={() => {}}
      />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
