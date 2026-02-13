export type Edition = "community" | "enterprise";

export const communityFeatureCapabilities = [
  "auth_email_oauth",
  "org_rbac_baseline",
  "workflow_dsl_v2",
  "workflow_async_queue",
  "tenant_rls",
] as const;

export type CommunityFeatureCapability = (typeof communityFeatureCapabilities)[number];

export type FeatureCapability =
  | CommunityFeatureCapability
  | "sso"
  | "scim"
  | "audit_export"
  | "advanced_rbac"
  | "compliance_reporting"
  | "enterprise_connector_pack"
  | "approval_policy_pack"
  | (string & {});

export type EnterpriseConnectorContract = {
  id: string;
  displayName: string;
  requiresSecret: boolean;
};

export type EnterpriseProviderContext = {
  organizationId?: string;
  userId?: string;
};

export type EnterpriseProvider = {
  edition: Edition;
  name: string;
  version?: string;
  getCapabilities(context?: EnterpriseProviderContext): FeatureCapability[];
  getEnterpriseConnectors?(context?: EnterpriseProviderContext): EnterpriseConnectorContract[];
};
