"use client";

import { useEffect, useState } from "react";
import { getActiveOrgId, subscribeActiveOrg } from "../org-context";

export function useActiveOrgId(): string | null {
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    setOrgId(getActiveOrgId());
    return subscribeActiveOrg((next) => setOrgId(next));
  }, []);

  return orgId;
}
