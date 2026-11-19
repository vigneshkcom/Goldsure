-- Run once in the Supabase SQL editor: allow Bharath on the team To Do board.
-- (todo/schema.sql already includes him for fresh installs.)
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.portal_tasks'::regclass, 'public.portal_task_notes'::regclass)
      and pg_get_constraintdef(oid) ilike '%''Shanira''%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.portal_tasks
  add constraint portal_tasks_assignee_check check (assignee in ('Vignesh','David','Shanira','Alda','Amit','Bharath')),
  add constraint portal_tasks_created_by_check check (created_by in ('Vignesh','David','Shanira','Alda','Amit','Bharath')),
  add constraint portal_tasks_completed_by_check check (completed_by is null or completed_by in ('Vignesh','David','Shanira','Alda','Amit','Bharath'));
alter table public.portal_task_notes
  add constraint portal_task_notes_author_check check (author in ('Vignesh','David','Shanira','Alda','Amit','Bharath'));
