drop table if exists organization_billing_accounts;
drop table if exists organization_credit_ledger;
drop table if exists organization_credit_balances;
drop table if exists user_entitlements;
drop table if exists user_payment_events;

delete from platform_settings
where key = 'payments.providers';
