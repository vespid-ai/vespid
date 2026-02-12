# ADR 0002: Foundation Auth Model

## Status
Accepted

## Context
Foundation phase needs fast iteration with secure baseline auth and future enterprise SSO compatibility.

## Decision
- Primary auth flows: email/password and OAuth callback endpoint.
- Use signed bearer token sessions from API.
- Keep OAuth callback minimal in foundation (state validation + account provisioning).
- Reserve enterprise SSO (SAML/OIDC) for later phase.

## Consequences
- Fast delivery for MVP onboarding.
- OAuth provider integrations can be progressively hardened without breaking auth contracts.
