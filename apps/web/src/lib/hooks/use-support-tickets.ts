"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type SupportTicket = {
  id: string;
  requesterUserId: string | null;
  organizationId: string | null;
  category: string;
  priority: string;
  status: string;
  subject: string;
  content: string;
  assigneeUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type TicketListFilters = {
  status?: string;
  limit?: number;
};

function buildTicketQuery(input?: TicketListFilters): string {
  const params = new URLSearchParams();
  if (input?.status) {
    params.set("status", input.status);
  }
  if (input?.limit) {
    params.set("limit", String(input.limit));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useOrgSupportTickets(orgId: string | null, input?: TicketListFilters) {
  return useQuery({
    queryKey: ["org-support-tickets", orgId, input?.status ?? "", input?.limit ?? 100],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ tickets: SupportTicket[] }>(`/v1/org/support-tickets${buildTicketQuery(input)}`, { method: "GET" }, { orgScoped: true });
    },
  });
}

export function useCreateOrgSupportTicket(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { subject: string; content: string; category?: string; priority?: string }) => {
      return apiFetchJson<{ ticket: SupportTicket }>(
        "/v1/org/support-tickets",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org-support-tickets", orgId] });
    },
  });
}

export function usePatchOrgSupportTicket(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; status?: string; priority?: string; assigneeUserId?: string | null }) => {
      const { ticketId, ...body } = input;
      return apiFetchJson<{ ticket: SupportTicket }>(
        `/v1/org/support-tickets/${ticketId}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org-support-tickets", orgId] });
    },
  });
}
