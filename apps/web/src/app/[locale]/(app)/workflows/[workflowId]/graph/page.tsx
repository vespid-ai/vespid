"use client";

import "@xyflow/react/dist/style.css";

import { useParams } from "next/navigation";
import { WorkflowGraphEditor } from "../../../../../../components/app/workflow-graph-editor";

export default function WorkflowGraphEditorPage() {
  const params = useParams<{ locale?: string | string[]; workflowId?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const workflowId = Array.isArray(params?.workflowId) ? (params.workflowId[0] ?? "") : (params?.workflowId ?? "");

  return <WorkflowGraphEditor variant="full" locale={locale} workflowId={workflowId} />;
}
