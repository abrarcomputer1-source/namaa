-- =========================================================
-- منصة نماء V10 — ترقية آمنة تحفظ البيانات الحالية
-- شغّلي هذا الملف مرة واحدة في Supabase SQL Editor قبل رفع V10
-- لا يحذف أي بيانات قديمة، ويضيف الأعمدة والوظائف الجديدة فقط.
-- =========================================================

-- هوية المنصة: الرؤية والرسالة والقيم
alter table public.site_settings add column if not exists message text;
alter table public.site_settings add column if not exists values_text text;

-- الخطة الفصلية
alter table public.plan_items add column if not exists registered_count integer;
alter table public.plan_items add column if not exists updated_at timestamptz not null default now();

-- الخطة التنفيذية: نحافظ على procedure_text / executed / reason كما هي
alter table public.executive_plan_steps add column if not exists phase_timing text;
alter table public.executive_plan_steps add column if not exists responsible text;
alter table public.executive_plan_steps add column if not exists evidence_options text[] not null default '{}'::text[];
alter table public.executive_plan_steps add column if not exists completion_percent integer;

-- نملأ المسؤول في السجلات القديمة باسم المنسقة الحالي دون المساس بالإجراءات القديمة
update public.executive_plan_steps e
set responsible = coalesce(nullif(e.responsible,''), (select coordinator_name from public.site_settings order by id limit 1), 'منسقة الموهوبات')
where e.responsible is null or e.responsible='';

-- تحويل التنفيذ القديم إلى نسبة مبدئية فقط إذا كانت النسبة الجديدة فارغة
update public.executive_plan_steps
set completion_percent = case when executed is true then 100 when executed is false then 0 else null end
where completion_percent is null;

-- الفرص يمكن ربطها ببند من الخطة الفصلية، مع الاحتفاظ بالفرص القديمة
alter table public.opportunities add column if not exists plan_item_id uuid references public.plan_items(id) on delete set null;

-- أرشفة البرامج بدل حذفها
alter table public.programs add column if not exists archived boolean not null default false;

-- دالة حساب نسبة إنجاز بند الخطة من متوسط نسب مراحل الخطة التنفيذية
create or replace function public.recalc_plan_progress(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_progress integer;
begin
  select round(avg(coalesce(completion_percent,0)))::integer
  into v_progress
  from public.executive_plan_steps
  where plan_item_id = p_plan_id;

  update public.plan_items
  set progress = coalesce(v_progress,0), updated_at = now()
  where id = p_plan_id;
end;
$$;

create or replace function public.trg_recalc_plan_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_plan_progress(coalesce(new.plan_item_id, old.plan_item_id));
  return coalesce(new,old);
end;
$$;

drop trigger if exists executive_steps_recalc_progress on public.executive_plan_steps;
create trigger executive_steps_recalc_progress
after insert or update or delete on public.executive_plan_steps
for each row execute function public.trg_recalc_plan_progress();

-- تحديث النسب الحالية مرة واحدة بعد الترقية
DO $$
declare r record;
begin
  for r in select id from public.plan_items loop
    perform public.recalc_plan_progress(r.id);
  end loop;
end $$;

-- مزامنة تاريخ الفرصة مع تاريخ نهاية/بداية بند الخطة المرتبط
create or replace function public.sync_opportunity_plan_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan_item_id is not null then
    select coalesce(nullif(date_to,''), nullif(date_from,''), nullif(plan_date,''))
      into new.opportunity_date
    from public.plan_items where id = new.plan_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_sync_plan_date on public.opportunities;
create trigger opportunities_sync_plan_date
before insert or update of plan_item_id on public.opportunities
for each row execute function public.sync_opportunity_plan_date();

create or replace function public.sync_linked_opportunities_from_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.opportunities
  set opportunity_date = coalesce(nullif(new.date_to,''), nullif(new.date_from,''), nullif(new.plan_date,''))
  where plan_item_id = new.id;
  return new;
end;
$$;

drop trigger if exists plan_sync_linked_opportunities on public.plan_items;
create trigger plan_sync_linked_opportunities
after update of date_from, date_to, plan_date on public.plan_items
for each row execute function public.sync_linked_opportunities_from_plan();

NOTIFY pgrst, 'reload schema';
