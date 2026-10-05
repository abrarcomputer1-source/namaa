-- منصة نماء: تفعيل تخزين الصور بشكل عام للزوار، والرفع/الحذف للمنسقة فقط

insert into storage.buckets (id, name, public)
values ('namaa-media', 'namaa-media', true)
on conflict (id) do update set public = true;

drop policy if exists "Namaa admin uploads" on storage.objects;
create policy "Namaa admin uploads"
on storage.objects for insert to authenticated
with check (bucket_id = 'namaa-media' and (select public.is_admin()));

drop policy if exists "Namaa admin updates" on storage.objects;
create policy "Namaa admin updates"
on storage.objects for update to authenticated
using (bucket_id = 'namaa-media' and (select public.is_admin()))
with check (bucket_id = 'namaa-media' and (select public.is_admin()));

drop policy if exists "Namaa admin deletes" on storage.objects;
create policy "Namaa admin deletes"
on storage.objects for delete to authenticated
using (bucket_id = 'namaa-media' and (select public.is_admin()));

-- بيانات عرض أولية اختيارية؛ لا تتكرر إذا كانت الجداول غير فارغة
insert into public.programs (title,description,program_date,status,external_url,is_published,sort_order)
select 'البرنامج الوطني للكشف عن الموهوبين','فرصة لاكتشاف الموهوبات وصقل قدراتهن.','10/3/1448هـ','منشور','https://www.mawhiba.org',true,1
where not exists (select 1 from public.programs);

insert into public.opportunities (title,opportunity_date,external_url,is_published,sort_order)
select 'الأولمبياد الوطني للإبداع العلمي (إبداع)','آخر موعد للتسجيل 1/5/1448هـ','https://www.mawhiba.org',true,1
where not exists (select 1 from public.opportunities);

insert into public.achievements (title,description,is_published,sort_order)
select 'مساحة الإنجازات والشواهد','ستظهر هنا إنجازات الطالبات بعد إضافتها من لوحة التحكم.',true,1
where not exists (select 1 from public.achievements);

insert into public.important_links (title,url,is_published,sort_order)
select 'موقع موهبة الرسمي','https://www.mawhiba.org',true,1
where not exists (select 1 from public.important_links);
