-- =========================================================
-- منصة نماء V11 — ترقية آمنة لا تحذف البيانات السابقة
-- شغّلي هذا الملف مرة واحدة بعد V10
-- =========================================================

-- تاريخ مستقل لكل مرحلة تنفيذية (النص القديم في phase_timing يبقى كما هو)
alter table public.executive_plan_steps add column if not exists phase_date text;

-- نهاية التسجيل للفرص والمسابقات
alter table public.opportunities add column if not exists registration_end_date text;
update public.opportunities
set registration_end_date = opportunity_date
where registration_end_date is null or btrim(registration_end_date)='';

-- الإحصاءات التلقائية مع إمكانية التحويل للوضع اليدوي
alter table public.statistics add column if not exists programs_auto boolean not null default true;
alter table public.statistics add column if not exists registered_auto boolean not null default true;

create or replace function public.recalc_namaa_statistics()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programs integer := 0;
  v_registered integer := 0;
  v_programs_auto boolean := true;
  v_registered_auto boolean := true;
begin
  select (count(*) filter (where coalesce(progress,0) >= 90))::integer,
         coalesce(sum(coalesce(registered_count,0)),0)
    into v_programs, v_registered
  from public.plan_items;

  if exists (select 1 from public.statistics) then
    select coalesce(programs_auto,true), coalesce(registered_auto,true)
      into v_programs_auto, v_registered_auto
    from public.statistics order by id limit 1;

    update public.statistics
       set programs_count = case when v_programs_auto then v_programs else programs_count end,
           registered_count = case when v_registered_auto then v_registered else registered_count end,
           updated_at = now()
     where id = (select id from public.statistics order by id limit 1);
  else
    insert into public.statistics(programs_count,registered_count,participants_count,gifted_count,programs_auto,registered_auto)
    values(v_programs,v_registered,0,0,true,true);
  end if;
end;
$$;

create or replace function public.trg_recalc_namaa_statistics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_namaa_statistics();
  return coalesce(new,old);
end;
$$;

drop trigger if exists plan_recalc_namaa_statistics on public.plan_items;
create trigger plan_recalc_namaa_statistics
after insert or update or delete on public.plan_items
for each row execute function public.trg_recalc_namaa_statistics();

-- عند ربط فرصة ببند من الخطة يكون تاريخ نهاية التسجيل من نهاية البند
create or replace function public.sync_opportunity_plan_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_date text;
begin
  if new.plan_item_id is not null then
    select coalesce(nullif(date_to,''), nullif(date_from,''), nullif(plan_date,''))
      into v_date from public.plan_items where id = new.plan_item_id;
    new.opportunity_date := v_date;
    new.registration_end_date := v_date;
  end if;
  return new;
end;
$$;

create or replace function public.sync_linked_opportunities_from_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_date text;
begin
  v_date := coalesce(nullif(new.date_to,''), nullif(new.date_from,''), nullif(new.plan_date,''));
  update public.opportunities
     set opportunity_date = v_date, registration_end_date = v_date
   where plan_item_id = new.id;
  return new;
end;
$$;



drop trigger if exists opportunities_sync_plan_date on public.opportunities;
create trigger opportunities_sync_plan_date
before insert or update of plan_item_id on public.opportunities
for each row execute function public.sync_opportunity_plan_date();

drop trigger if exists plan_sync_linked_opportunities on public.plan_items;
create trigger plan_sync_linked_opportunities
after update of date_from, date_to, plan_date on public.plan_items
for each row execute function public.sync_linked_opportunities_from_plan();

select public.recalc_namaa_statistics();
NOTIFY pgrst, 'reload schema';
