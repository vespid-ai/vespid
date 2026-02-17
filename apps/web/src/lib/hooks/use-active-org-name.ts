"use client";

import { useMemo } from "react";
import { useActiveOrgId } from "./use-active-org-id";
import { useMe } from "./use-me";
import { useSession } from "./use-session";

export function useActiveOrgName(): { orgId: string | null; orgName: string | null } {
  const orgId = useActiveOrgId();
  const authSession = useSession();
  const meQuery = useMe(Boolean(authSession.data?.session));

  const orgName = useMemo(() => {
    if (!orgId) return null;
    const match = meQuery.data?.orgs?.find((org) => org.id === orgId);
    return match?.name ?? null;
  }, [meQuery.data?.orgs, orgId]);

  return { orgId, orgName };
}
