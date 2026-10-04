-- =========================================================
-- منصة نماء V8
-- إضافة مرفق التكليف + فترة من/إلى + تقرير PDF لكل بند خطة
-- شغّلي هذا الملف مرة واحدة فقط في SQL Editor
-- =========================================================

-- 1) أعمدة مرفق التكليف
alter table public.site_settings
  add column if not exists assignment_file_path text,
  add column if not exists assignment_file_name text,
  add column if not exists assignment_file_type text;

-- 2) أعمدة الخطة الفصلية الجديدة
alter table public.plan_items
  add column if not exists date_from text,
  add column if not exists date_to text,
  add column if not exists report_pdf_path text,
  add column if not exists report_file_name text;

-- نسخ التاريخ القديم إلى "من" للحفاظ على البيانات السابقة
update public.plan_items
set date_from = coalesce(date_from, plan_date)
where date_from is null and plan_date is not null;

-- 3) حاوية خاصة للملفات الداخلية: التكليف وتقارير الخطة
insert into storage.buckets (id, name, public)
values ('namaa-private', 'namaa-private', false)
on conflict (id) do update set public = false;

-- القراءة: فقط المستخدمون المسجلون (المنسقة والمديرة)
drop policy if exists "Namaa private authenticated reads" on storage.objects;
create policy "Namaa private authenticated reads"
on storage.objects for select to authenticated
using (bucket_id = 'namaa-private');

-- الرفع/التعديل/الحذف: المنسقة admin فقط
drop policy if exists "Namaa private admin uploads" on storage.objects;
create policy "Namaa private admin uploads"
on storage.objects for insert to authenticated
with check (bucket_id = 'namaa-private' and (select public.is_admin()));

drop policy if exists "Namaa private admin updates" on storage.objects;
create policy "Namaa private admin updates"
on storage.objects for update to authenticated
using (bucket_id = 'namaa-private' and (select public.is_admin()))
with check (bucket_id = 'namaa-private' and (select public.is_admin()));

drop policy if exists "Namaa private admin deletes" on storage.objects;
create policy "Namaa private admin deletes"
on storage.objects for delete to authenticated
using (bucket_id = 'namaa-private' and (select public.is_admin()));
