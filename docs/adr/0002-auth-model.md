# ADR 0002: Foundation Auth Model

## Status
Accepted

## Context
Foundation phase needs fast iteration with secure baseline auth and future enterprise SSO compatibility.

## Decision
- Primary auth flows: email/password and OAuth authorization code callbacks.
- Use short-lived signed bearer access tokens with DB-backed refresh sessions (`auth_sessions`).
- Support both bearer and HttpOnly cookie authentication on protected APIs.
- OAuth providers in foundation: Google + GitHub with state + PKCE and nonce checks.
- Reserve enterprise SSO (SAML/OIDC) for later phase.

## Consequences
- Fast delivery for MVP onboarding.
- Session revocation and logout-all are first-class foundation operations.
- OAuth provider configuration is environment-driven and can be disabled safely per environment.
