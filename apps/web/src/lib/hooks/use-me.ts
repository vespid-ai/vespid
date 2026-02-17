"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type MeResponse = {
  user: { id: string; email: string };
  account: { tier: "free" | "paid" | "enterprise"; isSystemAdmin: boolean };
  orgPolicy: {
    canManageOrganizations: boolean;
    maxOrganizations: number | null;
    currentOrganizations: number;
  };
  orgs: Array<{ id: string; name: string; roleKey: string }>;
  defaultOrgId: string | null;
};

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => {
      return apiFetchJson<MeResponse>("/v1/me", { method: "GET" });
    },
    staleTime: 30_000,
  });
}
