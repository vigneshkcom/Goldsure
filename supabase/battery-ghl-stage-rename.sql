-- GHL renamed the Battery Customers stage "Proposal Sent" to "Quote Sent" (same stage id df0161df-ca17-4d67-9dd0-6e2cb2138ff0).
-- The quote system checks stage names before sending, so the saved name must match GHL.
update public.battery_quote_settings
set proposal_stage_name = 'Quote Sent'
where id = 'default'
  and pipeline_id = 'vNOSzOo0pXEnGS38xuNw'
  and proposal_stage_id = 'df0161df-ca17-4d67-9dd0-6e2cb2138ff0';
