import { useSession } from '../../shell/SessionContext';
import { useOrg } from '../../lib/queries';

/** The daycare this admin runs (their first admin org), with its live name once GET /orgs/:id has answered. */
export function useAdminOrg() {
  const { me } = useSession();
  const first = me.roles.adminOrgs[0];
  const org = useOrg(first?.id);
  return { orgId: first?.id, orgName: org.data?.name ?? first?.name ?? 'your daycare', org, isDemo: me.user.isDemo };
}
