-- Workflow versioning: immutable published workflows + draft revisions.
-- A "workflow family" groups versions (revisions) of the same conceptual workflow.
-- Each revision is a separate workflow row, keeping published versions immutable.

alter table workflows
  add column if not exists family_id uuid;

alter table workflows
  add column if not exists revision integer;

alter table workflows
  add column if not exists source_workflow_id uuid;

-- Backfill for existing rows.
update workflows
set family_id = id,
    revision = 1
where family_id is null
   or revision is null;

alter table workflows
  alter column family_id set not null;

alter table workflows
  alter column revision set not null;

-- Self-referential "cloned from" pointer (optional).
do $$
begin
  alter table workflows
    add constraint workflows_source_workflow_id_fk
    foreign key (source_workflow_id) references workflows(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

-- Uniqueness per org + workflow family.
create unique index if not exists workflows_org_family_revision_unique
  on workflows(organization_id, family_id, revision);

create index if not exists workflows_org_family_revision_idx
  on workflows(organization_id, family_id, revision desc);

