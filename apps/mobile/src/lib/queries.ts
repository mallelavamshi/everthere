import { QueryClient, focusManager, useInfiniteQuery, useQuery, type QueryKey } from '@tanstack/react-query';
import type {
  AlertView, AvatarView, CaregiverChild, CaregiversView, ClassroomView, EnrollmentView, MyClassroom, OrgView, StaffMember, StaffSwitchEntry, ChildView, DashboardView, MeResponse, PlanView, RosterTile, SessionItem, SessionsPage,
} from '@everthere/shared';
import { api, ApiError } from './api';
import { onAppEvent } from './native';

// ---- client ----------------------------------------------------------------------------------------------------

/** One retry for idempotent GETs, but never for an answer the server already gave (4xx). Mutations never retry. */
const retryGet = (count: number, err: unknown) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: retryGet, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();

/** Capacitor `resume` is the mobile "window focus": tell TanStack Query so stale data refetches on return. */
export function wireQueryFocus(): () => void {
  const offResume = onAppEvent('resume', () => focusManager.setFocused(true));
  const offPause = onAppEvent('pause', () => focusManager.setFocused(false));
  return () => {
    offResume();
    offPause();
  };
}

// ---- keys ------------------------------------------------------------------------------------------------------

// Every key starts with the signed-in user's id, so one person's cached data can never answer for another.
let queryUser = 'anon';
export const setQueryUser = (id: string | null) => {
  queryUser = id ?? 'anon';
};
const u = () => queryUser;

export const qk = {
  me: () => [u(), 'me'] as const,
  children: () => [u(), 'children'] as const,
  avatar: () => [u(), 'avatars', 'mine'] as const,
  plan: (childId: string, avatarId: string) => [u(), 'plan', childId, avatarId] as const,
  sessions: (childId: string) => [u(), 'sessions', childId] as const,
  session: (id: string) => [u(), 'session', id] as const,
  alerts: (unreadOnly: boolean) => [u(), 'alerts', unreadOnly] as const,
  /** `actingId` = the acting teacher on a shared tablet: another teacher's roster is never served from this one's cache. */
  roster: (orgId: string, classroomId?: string, actingId?: string | null) => [u(), 'roster', orgId, classroomId ?? null, actingId ?? null] as const,
  /** The roster family: prefix key, so one invalidation refetches every classroom's roster. */
  rosterAll: () => [u(), 'roster'] as const,
  myClassrooms: (orgId: string, actingId?: string | null) => [u(), 'myClassrooms', orgId, actingId ?? null] as const,
  myClassroomsAll: () => [u(), 'myClassrooms'] as const,
  caregiverChildren: () => [u(), 'caregiverChildren'] as const,
  staffSwitch: (orgId: string, deviceId: string) => [u(), 'staffSwitch', orgId, deviceId] as const,
  dashboard: (orgId: string) => [u(), 'dashboard', orgId] as const,
  caregivers: (childId: string) => [u(), 'caregivers', childId] as const,
  org: (orgId: string) => [u(), 'org', orgId] as const,
  orgClassrooms: (orgId: string) => [u(), 'orgClassrooms', orgId] as const,
  orgStaff: (orgId: string) => [u(), 'orgStaff', orgId] as const,
  enrollments: (orgId: string) => [u(), 'enrollments', orgId] as const,
};

const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};
const enc = encodeURIComponent;

// ---- hooks (GET /api/...) --------------------------------------------------------------------------------------

export const useMe = (enabled = true) =>
  useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => get<MeResponse>('/me', signal), enabled, networkMode: 'always' });

export const useChildren = () =>
  useQuery({ queryKey: qk.children(), queryFn: ({ signal }) => get<{ children: ChildView[] }>('/children', signal).then((r) => r.children) });

export const useAvatar = () =>
  useQuery({ queryKey: qk.avatar(), queryFn: ({ signal }) => get<AvatarView[]>('/avatars/mine', signal) });

export const usePlan = (childId?: string, avatarId?: string) =>
  useQuery({
    queryKey: qk.plan(childId ?? '', avatarId ?? ''),
    queryFn: ({ signal }) => get<PlanView>(`/children/${enc(childId!)}/plans/${enc(avatarId!)}`, signal),
    enabled: !!childId && !!avatarId,
  });

/** Newest first, cursor-paged. `data.pages[n].items`. */
export const useSessions = (childId?: string) =>
  useInfiniteQuery({
    queryKey: qk.sessions(childId ?? ''),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => get<SessionsPage>(`/sessions${q({ childId, cursor: pageParam })}`, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!childId,
  });

/**
 * One transcript line: `User` is the child, `Assistant` the parent's avatar. The API normalizes `timestamp` to epoch
 * ms (Napster sends unix seconds; device test P-2), or null when there is no usable time.
 */
export interface TranscriptLine {
  role: 'User' | 'Assistant' | 'System';
  text: string;
  timestamp: number | null;
}

/**
 * GET /sessions/:id. `transcript` is present only when the viewer may read it (null = allowed, but none was saved);
 * the key is missing otherwise. `caregiverNote` is the optional one-liner the teacher left at check-in.
 */
export type SessionDetailView = SessionItem & { caregiverNote?: string | null; transcript?: TranscriptLine[] | null };

export const useSession = (id?: string) =>
  useQuery({ queryKey: qk.session(id ?? ''), queryFn: ({ signal }) => get<SessionDetailView>(`/sessions/${enc(id!)}`, signal), enabled: !!id });

export const useAlerts = (unreadOnly = false) =>
  useQuery({
    queryKey: qk.alerts(unreadOnly),
    queryFn: ({ signal }) => get<{ items: AlertView[] }>(`/alerts${unreadOnly ? '?unread=1' : ''}`, signal).then((r) => r.items ?? []),
  });

export const useRoster = (orgId?: string, classroomId?: string, actingId?: string | null) =>
  useQuery({
    queryKey: qk.roster(orgId ?? '', classroomId, actingId),
    queryFn: ({ signal }) => get<{ tiles: RosterTile[] }>(`/orgs/${enc(orgId!)}/roster${q({ classroomId })}`, signal).then((r) => r.tiles),
    enabled: !!orgId,
  });

export const useMyClassrooms = (orgId?: string, actingId?: string | null) =>
  useQuery({
    queryKey: qk.myClassrooms(orgId ?? '', actingId),
    queryFn: ({ signal }) => get<{ classrooms: MyClassroom[] }>(`/orgs/${enc(orgId!)}/my-classrooms`, signal).then((r) => r.classrooms),
    enabled: !!orgId,
  });

/** A home caregiver's (nanny's) children, as roster tiles. */
export const useCaregiverChildren = (enabled = true) =>
  useQuery({
    queryKey: qk.caregiverChildren(),
    queryFn: ({ signal }) => get<{ children: CaregiverChild[] }>('/caregiver/children', signal).then((r) => r.children),
    enabled,
  });

export const useStaffSwitch = (orgId?: string, deviceId?: string, enabled = true) =>
  useQuery({
    queryKey: qk.staffSwitch(orgId ?? '', deviceId ?? ''),
    queryFn: ({ signal }) => get<{ staff: StaffSwitchEntry[] }>(`/orgs/${enc(orgId!)}/staff/switch${q({ deviceId })}`, signal).then((r) => r.staff),
    enabled: enabled && !!orgId && !!deviceId,
    staleTime: 0,
  });

export const useDashboard = (orgId?: string) =>
  useQuery({ queryKey: qk.dashboard(orgId ?? ''), queryFn: ({ signal }) => get<DashboardView>(`/orgs/${enc(orgId!)}/dashboard`, signal), enabled: !!orgId });

export const useCaregivers = (childId?: string) =>
  useQuery({ queryKey: qk.caregivers(childId ?? ''), queryFn: ({ signal }) => get<CaregiversView>(`/children/${enc(childId!)}/caregivers`, signal), enabled: !!childId });

export const useOrg = (orgId?: string) =>
  useQuery({ queryKey: qk.org(orgId ?? ''), queryFn: ({ signal }) => get<OrgView>(`/orgs/${enc(orgId!)}`, signal), enabled: !!orgId });

export const useOrgClassrooms = (orgId?: string) =>
  useQuery({
    queryKey: qk.orgClassrooms(orgId ?? ''),
    queryFn: ({ signal }) => get<{ classrooms: ClassroomView[] }>(`/orgs/${enc(orgId!)}/classrooms`, signal).then((r) => r.classrooms),
    enabled: !!orgId,
  });

export const useOrgStaff = (orgId?: string) =>
  useQuery({
    queryKey: qk.orgStaff(orgId ?? ''),
    queryFn: ({ signal }) => get<{ staff: StaffMember[] }>(`/orgs/${enc(orgId!)}/staff`, signal).then((r) => r.staff),
    enabled: !!orgId,
  });

export const useEnrollments = (orgId?: string) =>
  useQuery({
    queryKey: qk.enrollments(orgId ?? ''),
    queryFn: ({ signal }) => get<{ enrollments: EnrollmentView[] }>(`/orgs/${enc(orgId!)}/enrollments`, signal).then((r) => r.enrollments),
    enabled: !!orgId,
  });

export type { QueryKey };
