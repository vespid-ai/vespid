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
  issuedAt: number;
  expiresAt: number;
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
