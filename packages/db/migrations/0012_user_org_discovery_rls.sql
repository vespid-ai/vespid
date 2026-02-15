-- Allow a signed-in user to discover their organizations without requiring X-Org-Id.
-- This is needed for /v1/me (org switcher + personal workspace bootstrap).
--
-- Guardrails:
-- - memberships: user can only SELECT their own membership rows
-- - organizations: user can only SELECT orgs where they have a membership
-- - writes still require tenant context via existing strict policies

drop policy if exists memberships_user_self_select on memberships;
create policy memberships_user_self_select
on memberships
for select
using (user_id = app.current_user_uuid());

drop policy if exists organizations_user_membership_select on organizations;
create policy organizations_user_membership_select
on organizations
for select
using (
  exists (
    select 1
    from memberships m
    where m.organization_id = organizations.id
      and m.user_id = app.current_user_uuid()
  )
);

