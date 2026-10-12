-- Extend the existing live constraints to cover in-progress and uncertain sends.
-- No customer records or delivery history are changed.
begin;

alter table public.email_campaign_recipients
  drop constraint if exists email_campaign_recipients_delivery_status_check;
alter table public.email_campaign_recipients
  add constraint email_campaign_recipients_delivery_status_check
  check (delivery_status in ('pending', 'sending', 'sent', 'failed', 'bounced', 'unsubscribed', 'unknown'));

alter table public.email_campaign_events
  drop constraint if exists email_campaign_events_event_type_check;
alter table public.email_campaign_events
  add constraint email_campaign_events_event_type_check
  check (event_type in ('sent', 'failed', 'bounced', 'open', 'click', 'unsubscribe', 'callback', 'unknown'));

commit;
