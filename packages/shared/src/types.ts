export type Role = {
  id: string;
  key: "owner" | "admin" | "member";
  name: string;
};

export type Organization = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
};

export type Membership = {
  id: string;
  organizationId: string;
  userId: string;
  role: Role["key"];
  createdAt: string;
};

export type AuthSession = {
  token: string;
  userId: string;
  email: string;
  sessionId: string;
  tokenType: "access";
  issuedAt: number;
  expiresAt: number;
};

export type AccessTokenClaims = {
  userId: string;
  email: string;
  sessionId: string;
  tokenType: "access";
  issuedAt: number;
  expiresAt: number;
};

export type SessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
};

export type SessionCookieOptions = {
  name: string;
  path: string;
  maxAgeSec: number;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
};

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type PublicUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

export type InvitationAcceptResult = {
  invitationId: string;
  organizationId: string;
  membershipId: string;
  accepted: boolean;
};

export type OrgContextError = "ORG_CONTEXT_REQUIRED" | "ORG_ACCESS_DENIED" | "INVALID_ORG_CONTEXT";
