# Vespid Mobile (KMP, Android-first)

This module provides an Android-first Kotlin Multiplatform companion app for Vespid sessions.

## Scope
- Email/password login against `/v1/auth/login`.
- Bearer token API access.
- Multi-org switch using `/v1/me`.
- Session list/create/detail for `gateway.codex.v2`, `gateway.claude.v2`, and `gateway.opencode.v2`.
- Terminal-style stream view with command input.
- Real-time updates via `ws/client` with support for:
  - `session_event_v2`
  - `agent_delta`
  - `agent_final`
  - `session_stream_v1`

## Commands in terminal input
- `/stop`
- `/reset`
- `/reset --clear`
- `/new`

## Runtime defaults
- API base URL: `http://127.0.0.1:3001`
- Gateway WS base URL: `ws://127.0.0.1:3002`

These values are configured as Android `BuildConfig` fields in `androidApp/build.gradle.kts`.

The client also includes loopback fallback logic for emulator networking:
- `127.0.0.1` <-> `10.0.2.2`

## Notes
- Token persistence is in-memory for this first cut.
- Automatic refresh-token rotation is intentionally out of scope.
- iOS UI is not included yet; shared module is prepared for follow-up work.
