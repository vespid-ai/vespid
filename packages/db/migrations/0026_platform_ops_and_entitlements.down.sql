drop index if exists platform_audit_logs_action_created_at_idx;
drop index if exists platform_audit_logs_created_at_idx;
drop table if exists platform_audit_logs;

drop index if exists support_ticket_events_ticket_created_at_idx;
drop table if exists support_ticket_events;

drop index if exists support_tickets_requester_created_at_idx;
drop index if exists support_tickets_status_priority_updated_at_idx;
drop table if exists support_tickets;

drop index if exists user_entitlements_user_active_idx;
drop index if exists user_entitlements_source_unique;
drop table if exists user_entitlements;

drop index if exists user_payment_events_provider_status_created_at_idx;
drop index if exists user_payment_events_payer_created_at_idx;
drop index if exists user_payment_events_provider_event_unique;
drop table if exists user_payment_events;

drop table if exists platform_settings;

drop index if exists platform_user_roles_role_created_at_idx;
drop index if exists platform_user_roles_user_role_unique;
drop table if exists platform_user_roles;
