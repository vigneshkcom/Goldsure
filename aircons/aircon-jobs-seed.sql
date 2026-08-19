-- OPTIONAL seed for aircon_jobs — run AFTER aircon-jobs-schema.sql.
--
-- ⚠ ONLY run this on an EMPTY table. If you already seeded the earlier
-- version, the schema migration has already converted those rows — running
-- this again would duplicate all 34 jobs.
--
-- ⚠ PLEASE CHECK THIS BEFORE RUNNING IT.
-- These 34 rows were transcribed by eye from a screenshot of the tracking
-- spreadsheet, so names, addresses and amounts may contain typos. Nothing
-- here is verified against a source system.
--
-- Notes on the mapping from the spreadsheet:
--   • Installation Date → booked_date. AC Assessment and Days to Install are
--     not carried over; the board does not use them.
--   • Amount Received → out_of_pocket, with deposit left empty, so every job
--     starts out reading as fully pending. If those amounts were in fact
--     already collected, run afterwards:
--         update aircon_jobs set deposit = out_of_pocket;
--   • BPOINT Ref → comments, so the payment references are not lost. To start
--     with blank comments instead:
--         update aircon_jobs set comments = null;
--   • Job Status collapses onto the three groups: Completed → Installed;
--     assigned and Overdue Assigned → Scheduled; Date Pending → To Book.
--   • The two struck-through rows (HYCINTH ADOLPHUS, Brandon Hernandez) are
--     seeded cancelled = true: struck through on the board and excluded from
--     the money totals.

insert into aircon_jobs
  (job_no, customer, address, booked_date,
   out_of_pocket, deposit, comments, status, cancelled, position)
values
  -- ── To Book ─────────────────────────────────────────────
  ('152082','Naomi Fletcher','31 PENGANA AVENUE GLENROY','2026-08-25',800.00,null,'152082, 152082','to_book',false,1000),
  ('152442','JOSEPH SCHWARTZ','66 BARTER CRESCENT FOREST HILL','2026-09-04',1000.00,null,'152442','to_book',false,2000),
  ('152176','Brandon Hernandez','1 LAWSON STREET MOONEE PONDS',null,1500.00,null,'152176, 152176','to_book',true,3000),
  ('152237','AAKASH D SUNUWAR','21 EADES STREET LAVERTON',null,550.00,null,'152237, 152237','to_book',false,4000),
  ('152413','REZA RUDD','42 JADE CRESCENT WYNDHAM VALE','2026-08-26',800.00,null,'Stripe, 152413','to_book',false,5000),
  ('152376','ZSOLT STEFAN','6 BASALT STREET OFFICER',null,2600.00,null,'152376, 152376','to_book',false,6000),
  ('152407','SANDA JUKIC','17 ORTON RISE ENDEAVOUR HILLS',null,200.00,null,'152407','to_book',false,7000),

  -- ── Scheduled ───────────────────────────────────────────
  ('152151','KAUMIL PAREKH','274 JELLS ROAD WHEELERS HILL','2026-08-17',2200.00,null,'Stripe+Bank Transfer','scheduled',false,8000),
  ('151746','MIKAELA HENRY','UNIT 1/25 ARMSTRONG ROAD HEATHMONT','2026-08-19',1800.00,null,'Xero','scheduled',false,9000),
  ('152380','HYCINTH ADOLPHUS','1/30 MCMILLAN STREET CLAYTON SOUTH','2026-08-20',500.00,null,'152380','scheduled',true,10000),
  ('152267','Graeme J Black','5 TRAFALGAR CRESCENT LILYDALE','2026-08-21',1500.00,null,'152267, 152267','scheduled',false,11000),
  ('152385','JOSEPH SCHWARTZ','UNIT 2/78 HILTON STREET MOUNT WAVERLEY','2026-08-27',1000.00,null,'152385','scheduled',false,12000),

  -- ── Installed ───────────────────────────────────────────
  ('151109','Kathryn Wilkinson','Talbett Street Burwood','2026-06-12',1800.00,null,'860052, 861286','installed',false,13000),
  ('151141','Michael K Kang','10 Clerehan Ct, Wantirna South','2026-06-22',1682.00,null,'859803, 862624, Refund $218','installed',false,14000),
  ('151347','Michael S Bishop','2 Argyle Court, Pakenham','2026-06-24',1200.00,null,'861453, 862168','installed',false,15000),
  ('151357','Fiona Vuong','3 Tamar Road, Springvale South Vic','2026-06-25',700.00,null,'861419','installed',false,16000),
  ('151567','Michael Gravina','433 HIGH STREET LALOR','2026-07-06',1700.00,null,'151567','installed',false,17000),
  ('151218','Tae H Yeon','7 HIGHMONT DRIVE VERMONT SOUTH','2026-07-07',1000.00,null,'151218, INV-0071','installed',false,18000),
  ('151548','Brendon D Harbour','3 GANAWAY DRIVE BERWICK','2026-07-08',1800.00,null,'151548','installed',false,19000),
  ('151281','Genalyn T Ca-Ayon','7 St Clair Boulevard, Roxburgh Park','2026-07-22',500.00,null,'860960','installed',false,20000),
  ('151682','Dominic Alderman','3 OWEN COURT WERRIBEE','2026-07-24',2000.00,null,'151682','installed',false,21000),
  ('151853','Justin Hopkins','241 LIBERTY PARADE HEIDELBERG WEST','2026-07-27',1600.00,null,'151853, 151853','installed',false,22000),
  ('152062','Shiva Karki','34 HAMILTON HUME PARADE CRAIGIEBURN','2026-07-28',600.00,null,'152062, 152062','installed',false,23000),
  ('152037','Dae In Kang','5 MUNRO CLOSE HAMPTON PARK','2026-07-29',1800.00,null,'152037','installed',false,24000),
  ('151687','Diane Dodunski','57 LEOPOLD CRESCENT HAMPTON PARK','2026-08-03',1000.00,null,'151687','installed',false,25000),
  ('151901','Caroline Holland','17 FLORENCE AVENUE DONVALE','2026-08-04',800.00,null,'151901','installed',false,26000),
  ('151977','Chun Min Fan','260A NELL STREET WATSONIA','2026-08-06',1300.00,null,'151977','installed',false,27000),
  ('151823','Liz Andrea','32 TULLOCH AVENUE KURUNJANG','2026-08-07',1300.00,null,'151823','installed',false,28000),
  ('152137','Kevin Taylor','UNIT 2/10 THE FAIRWAY ROWVILLE','2026-08-10',1100.00,null,'152137, 152137','installed',false,29000),
  ('151729','Daanish M Antulay','533 SPRINGVALE ROAD VERMONT SOUTH','2026-08-13',1300.00,null,'151729','installed',false,30000),
  ('151483','Kiwan Ha','2 Ferndale Road Upper Ferntree Gully','2026-08-17',2500.00,null,'862448, 862801','installed',false,31000),
  ('152425','JOSEPH SCHWARTZ','4 FOY COURT GLEN WAVERLEY','2026-08-17',1100.00,null,'152425','installed',false,32000),
  ('151708','Kadir Bozok','17 ORBIS AVENUE FRASER RISE','2026-08-30',1700.00,null,'151708','installed',false,33000),
  ('152263','MICHELLE MARCHMENT','18 THE CIRCUIT GLADSTONE PARK','2026-08-19',1100.00,null,'Stripe+Bank Transfer','installed',false,34000);
