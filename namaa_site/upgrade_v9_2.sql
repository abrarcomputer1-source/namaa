-- =========================================================
-- منصة نماء V9.2
-- جدول الخطة التنفيذية لكل بند من الخطة الفصلية
-- شغّلي هذا الملف مرة واحدة فقط في SQL Editor
-- =========================================================

create table if not exists public.executive_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references public.plan_items(id) on delete cascade,
  procedure_text text not null default '',
  executed boolean,
  reason text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists executive_plan_steps_plan_item_idx
  on public.executive_plan_steps(plan_item_id, sort_order);

alter table public.executive_plan_steps enable row level security;

revoke all on table public.executive_plan_steps from anon, authenticated;
grant select, insert, update, delete on table public.executive_plan_steps to authenticated;

drop policy if exists "Authenticated can read executive plan" on public.executive_plan_steps;
create policy "Authenticated can read executive plan"
on public.executive_plan_steps
for select
to authenticated
using (true);

drop policy if exists "Admin can insert executive plan" on public.executive_plan_steps;
create policy "Admin can insert executive plan"
on public.executive_plan_steps
for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "Admin can update executive plan" on public.executive_plan_steps;
create policy "Admin can update executive plan"
on public.executive_plan_steps
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Admin can delete executive plan" on public.executive_plan_steps;
create policy "Admin can delete executive plan"
on public.executive_plan_steps
for delete
to authenticated
using ((select public.is_admin()));
