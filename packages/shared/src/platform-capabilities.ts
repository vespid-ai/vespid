export const platformCapabilities = [
  "auth_email_oauth",
  "org_rbac_baseline",
  "workflow_dsl_v2",
  "workflow_async_queue",
  "tenant_rls",
  "sso",
  "scim",
  "audit_export",
  "advanced_rbac",
  "compliance_reporting",
  "enterprise_connector_pack",
  "approval_policy_pack",
] as const;

export type PlatformCapability = (typeof platformCapabilities)[number] | (string & {});

export function listPlatformCapabilities(): PlatformCapability[] {
  return [...platformCapabilities];
}
