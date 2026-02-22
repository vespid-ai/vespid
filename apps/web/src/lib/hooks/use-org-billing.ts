"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type OrgBillingEntitlementsResponse = {
  organizationId: string;
  plan: {
    tier: "free" | "pro" | "enterprise" | string;
    status: "active" | "trialing" | "past_due" | "canceled" | string;
  };
  entitlements: {
    monthlyRunLimit: number | null;
    inflightRunLimit: number | null;
  };
  defaults: {
    monthlyRunLimit: number | null;
    inflightRunLimit: number | null;
  };
  overrides: {
    monthlyRunLimit: number | null;
    inflightRunLimit: number | null;
  };
  subscription: {
    updatedAt: string;
    updatedByUserId: string | null;
    metadata: unknown;
  } | null;
};

export type OrgBillingUsageResponse = {
  organizationId: string;
  usageMonth: string;
  plan: {
    tier: "free" | "pro" | "enterprise" | string;
    status: "active" | "trialing" | "past_due" | "canceled" | string;
  };
  runs: {
    used: number;
    limit: number | null;
    remaining: number | null;
  };
  inFlight: {
    current: number;
    limit: number | null;
  };
};

export function useOrgBillingEntitlements(orgId: string | null) {
  return useQuery({
    queryKey: ["org-billing-entitlements", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<OrgBillingEntitlementsResponse>(`/v1/orgs/${orgId}/billing/entitlements`, { method: "GET" }, { orgScoped: true });
    },
    staleTime: 30_000,
  });
}

export function useOrgBillingUsage(orgId: string | null) {
  return useQuery({
    queryKey: ["org-billing-usage", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<OrgBillingUsageResponse>(`/v1/orgs/${orgId}/billing/usage`, { method: "GET" }, { orgScoped: true });
    },
    staleTime: 15_000,
  });
}
