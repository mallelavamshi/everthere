import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './env';
import { onError, onNotFound } from './http';
import { authMiddleware, isPublicPath, type ProfileFetcher, type Verifier } from './auth/clerk';
import { meRoutes } from './routes/me';
import { inviteRoutes } from './routes/invites';
import { familyRoutes } from './routes/families';
import { childRoutes } from './routes/children';
import { caregiverRoutes } from './routes/caregivers';
import { orgRoutes } from './routes/orgs';
import { mediaRoutes, publicMediaRoutes } from './routes/media';
import { classroomRoutes } from './routes/classrooms';
import { actingMiddleware, actingRoutes } from './auth/acting';
import type { NapsterSessionDeleter } from './napster/sessions';
import { avatarRoutes } from './routes/avatars';
import { planRoutes } from './routes/plans';
import type { AvatarNapster } from './services/avatars';
import type { SessionNapster } from './services/sessions';
import { sessionRoutes } from './routes/sessions';
import { webhookRoutes } from './routes/webhooks';
import { alertRoutes } from './routes/alerts';
import { demoRoutes } from './routes/demo';
import { adminRoutes } from './routes/admin';
import { devNapsterRoutes } from './routes/devNapster';
import type { SignInTokenMinter } from './auth/demo';
import { scheduled } from './cron';
import type { NapsterClient } from './napster/client';
import type { MetaText } from './meta/client';
import type { AiRunner } from './services/summary';

export type CreateAppOptions = {
  verify?: Verifier;
  fetchProfile?: ProfileFetcher;
  napsterDeleteSession?: NapsterSessionDeleter;
  /** Napster client; defaults to one built from env.NAPSTER_API_KEY. */
  napster?: AvatarNapster & SessionNapster & Pick<NapsterClient, 'getSession'>;
  /** Meta text client for summaries; defaults to one built from env.META_API_KEY. */
  meta?: Pick<MetaText, 'chat'>;
  /** Workers AI fallback for summaries; defaults to env.AI. */
  ai?: AiRunner | null;
  /** Clerk sign-in token minter for POST /api/demo/sign-in; defaults to the Clerk Backend API. */
  signInToken?: SignInTokenMinter;
  /** Tests only: mount extra routes after all middleware. */
  extraRoutes?: (app: Hono<AppEnv>) => void;
};

/** Origins of the mobile WebView (Capacitor). */
// The Capacitor WebView origins, plus the hosted web build judges can open in a browser (apps/mobile/wrangler.web.toml).
export const APP_ORIGINS = ['https://localhost', 'capacitor://localhost', 'https://everthere-web.m-vamshikrishna22.workers.dev'] as const;

export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.notFound(onNotFound);
  // The Capacitor app is a WebView on https://localhost (Android) / capacitor://localhost (iOS): every API call is
  // cross-origin, so preflights must be answered before the auth guard. Bearer tokens only (no cookies/credentials).
  app.use('/api/*', cors({ origin: [...APP_ORIGINS], allowHeaders: ['Authorization', 'Content-Type', 'X-Acting-Token'], maxAge: 600 }));
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Blanket guard on /api/*; only PUBLIC_PATHS and PUBLIC_PREFIXES (/api/admin/: X-Admin-Token) are exempt.
  // `opts` are injectable for tests.
  const auth = authMiddleware(opts.verify, opts.fetchProfile);
  app.use('/api/*', (c, next) => (isPublicPath(c.req.path) ? next() : auth(c, next)));
  // Shared-tablet acting (X-Acting-Token): after auth; sets c.var.actingUserId only for a fully valid token.
  app.use('/api/*', actingMiddleware);
  app.route('/api', meRoutes);
  app.route('/api', inviteRoutes);
  app.route('/api', familyRoutes);
  app.route('/api', childRoutes({ napsterDeleteSession: opts.napsterDeleteSession }));
  app.route('/api', avatarRoutes({ napster: opts.napster }));
  app.route('/api', planRoutes);
  app.route('/api', sessionRoutes({ napster: opts.napster }));
  app.route('/api', caregiverRoutes);
  app.route('/api', orgRoutes);
  app.route('/api', classroomRoutes);
  app.route('/api', actingRoutes);
  app.route('/api', mediaRoutes);
  app.route('/api', alertRoutes);
  // Public (in PUBLIC_PATHS): rate-limited per IP; mints a Clerk ticket for a seeded demo persona.
  app.route('/api', demoRoutes({ signInToken: opts.signInToken }));
  // Public prefix /api/admin/ (no Clerk): X-Admin-Token only.
  app.route('/api', adminRoutes);
  // Dev only: 404 unless env.DEV_ROUTES === '1' (checked per request). Clerk-authenticated like other /api routes.
  app.route('/api', devNapsterRoutes({ napster: opts.napster }));
  // Public (in PUBLIC_PATHS): authorized by the Napster HMAC signature only.
  app.route('/api', webhookRoutes({ napster: opts.napster, meta: opts.meta, ai: opts.ai }));
  // Public by design (outside /api, so no auth guard): authorized by HMAC signature + expiry only.
  app.route('/', publicMediaRoutes);
  opts.extraRoutes?.(app);
  return app;
}

export const app = createApp();

export default {
  fetch: app.fetch,
  // Cron triggers: "*/2 * * * *" (sweeps) and "0 8 * * *" (nightly demo reset). See cron.ts.
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => scheduled(controller, env, ctx),
} satisfies ExportedHandler<Env>;
