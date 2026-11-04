-- Apply after the API deployment uses explicit booking-to-quote joins.
alter table public.battery_quotes add constraint battery_quotes_assessment_booking_id_fkey
 foreign key(assessment_booking_id) references public.battery_iha_bookings(id) on delete restrict;
notify pgrst,'reload schema';
