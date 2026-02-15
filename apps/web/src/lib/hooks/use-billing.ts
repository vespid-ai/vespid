import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type CreditPack = {
  packId: string;
  credits: number;
  currency?: string;
  unitAmount?: number;
  productName?: string;
};

export function useCreditPacks() {
  return useQuery({
    queryKey: ["billing", "packs"],
    queryFn: async () => {
      return apiFetchJson<{ enabled: boolean; packs: CreditPack[] }>(`/v1/billing/credits/packs`, { method: "GET" });
    },
    staleTime: 60_000,
  });
}

export type CreditLedgerEntry = {
  id: string;
  deltaCredits: number;
  reason: string;
  stripeEventId: string | null;
  workflowRunId: string | null;
  createdByUserId: string | null;
  metadata: unknown;
  createdAt: string;
};

export function useCreditLedger(orgId: string | null, input: { limit: number; cursor?: string | null }) {
  return useQuery({
    queryKey: ["billing", "ledger", orgId, input.limit, input.cursor ?? null],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(input.limit));
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }
      return apiFetchJson<{ entries: CreditLedgerEntry[]; nextCursor: string | null }>(
        `/v1/orgs/${orgId}/billing/credits/ledger?${params.toString()}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    staleTime: 15_000,
  });
}

export function useCreditsBalance(orgId: string | null) {
  return useQuery({
    queryKey: ["billing", "balance", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ balanceCredits: number; lastUpdatedAt: string }>(
        `/v1/orgs/${orgId}/billing/credits`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    staleTime: 15_000,
  });
}

export function useCheckoutCredits(orgId: string | null) {
  return useMutation({
    mutationFn: async (input: { packId: string }) => {
      return apiFetchJson<{ checkoutUrl: string }>(
        `/v1/orgs/${orgId}/billing/credits/checkout`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
  });
}

