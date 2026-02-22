"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Textarea } from "../../../../components/ui/textarea";
import { isUnauthorizedError } from "../../../../lib/api";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useMe } from "../../../../lib/hooks/use-me";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useCreateOrgSupportTicket, useOrgSupportTickets, usePatchOrgSupportTicket } from "../../../../lib/hooks/use-support-tickets";

const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export default function SupportPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");

  const authSession = useAuthSession();
  const meQuery = useMe(Boolean(authSession.data?.session));
  const orgId = useActiveOrgId();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<string>("normal");
  const [category, setCategory] = useState<string>("general");
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});

  const ticketsQuery = useOrgSupportTickets(scopedOrgId, {
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    limit: 200,
  });
  const createTicketMutation = useCreateOrgSupportTicket(scopedOrgId);
  const patchTicketMutation = usePatchOrgSupportTicket(scopedOrgId);

  const activeRoleKey = useMemo(() => {
    if (!orgId) return null;
    const matched = (meQuery.data?.orgs ?? []).find((org) => org.id === orgId);
    return matched?.roleKey ?? null;
  }, [meQuery.data?.orgs, orgId]);
  const canManageTickets = activeRoleKey === "owner" || activeRoleKey === "admin";

  const unauthorized = (meQuery.isError && isUnauthorizedError(meQuery.error)) || (ticketsQuery.isError && isUnauthorizedError(ticketsQuery.error));

  async function onCreateTicket() {
    if (!orgId) {
      toast.error(t("org.requireActive"));
      return;
    }
    if (!subject.trim() || !content.trim()) {
      toast.error(t("support.errors.subjectContentRequired"));
      return;
    }
    try {
      await createTicketMutation.mutateAsync({
        subject: subject.trim(),
        content: content.trim(),
        category,
        priority,
      });
      setSubject("");
      setContent("");
      setCategory("general");
      setPriority("normal");
      toast.success(t("common.created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  async function onUpdateTicket(ticketId: string) {
    const ticket = (ticketsQuery.data?.tickets ?? []).find((item) => item.id === ticketId);
    if (!ticket) return;
    const nextStatus = statusDrafts[ticketId] ?? ticket.status;
    const nextPriority = priorityDrafts[ticketId] ?? ticket.priority;
    if (nextStatus === ticket.status && nextPriority === ticket.priority) {
      return;
    }
    try {
      await patchTicketMutation.mutateAsync({
        ticketId,
        status: nextStatus,
        priority: nextPriority,
      });
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("support.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("support.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void meQuery.refetch();
            void ticketsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("support.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("support.subtitle")}</div>
        </div>
        <EmptyState
          title={t("org.requireActive")}
          action={
            <Button variant="accent" onClick={() => router.push(`/${locale}/org`)}>
              {t("onboarding.goOrg")}
            </Button>
          }
        />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("support.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("support.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void meQuery.refetch();
            void ticketsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("support.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("support.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("support.create.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={t("support.create.subject")} />
          <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} placeholder={t("support.create.content")} />
          <div className="grid gap-2 md:grid-cols-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">{t("support.category.general")}</SelectItem>
                <SelectItem value="billing">{t("support.category.billing")}</SelectItem>
                <SelectItem value="workflow">{t("support.category.workflow")}</SelectItem>
                <SelectItem value="incident">{t("support.category.incident")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`support.priority.${item}` as any)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button
              variant="accent"
              onClick={() => void onCreateTicket()}
              disabled={!subject.trim() || !content.trim() || createTicketMutation.isPending}
            >
              {t("common.create")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("support.list.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="w-full md:max-w-xs">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("support.filter.all")}</SelectItem>
                {TICKET_STATUSES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`support.status.${item}` as any)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(ticketsQuery.data?.tickets ?? []).length === 0 ? (
            <div className="rounded border border-borderSubtle bg-panel/30 px-3 py-4 text-sm text-muted">{t("support.list.empty")}</div>
          ) : (
            <div className="grid gap-2">
              {(ticketsQuery.data?.tickets ?? []).map((ticket) => {
                const nextStatus = statusDrafts[ticket.id] ?? ticket.status;
                const nextPriority = priorityDrafts[ticket.id] ?? ticket.priority;
                const dirty = nextStatus !== ticket.status || nextPriority !== ticket.priority;
                return (
                  <div key={ticket.id} className="rounded border border-borderSubtle bg-panel/30 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{ticket.subject}</div>
                      <div className="text-xs text-muted">{new Date(ticket.updatedAt).toLocaleString()}</div>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-muted">{ticket.content}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{t("support.list.category")}: {t(`support.category.${ticket.category}` as any)}</span>
                      <span>{t("support.list.priority")}: {t(`support.priority.${ticket.priority}` as any)}</span>
                      <span>{t("support.list.status")}: {t(`support.status.${ticket.status}` as any)}</span>
                    </div>

                    {canManageTickets ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Select
                          value={nextStatus}
                          onValueChange={(value) => setStatusDrafts((prev) => ({ ...prev, [ticket.id]: value }))}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TICKET_STATUSES.map((item) => (
                              <SelectItem key={item} value={item}>
                                {t(`support.status.${item}` as any)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={nextPriority}
                          onValueChange={(value) => setPriorityDrafts((prev) => ({ ...prev, [ticket.id]: value }))}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TICKET_PRIORITIES.map((item) => (
                              <SelectItem key={item} value={item}>
                                {t(`support.priority.${item}` as any)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void onUpdateTicket(ticket.id)}
                          disabled={!dirty || patchTicketMutation.isPending}
                        >
                          {t("support.list.update")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
