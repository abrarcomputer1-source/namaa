const SUPABASE_URL = 'https://galabglojjvshveamdnx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_O_1C-zuX65vL20bHgPizAg_HXf622Ej';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const MAX_ASSIGNMENT_FILE = 12 * 1024 * 1024;
const MAX_REPORT_FILE = 50 * 1024 * 1024;
const FALLBACK = {
  heroTitle:'الموهوبات صانعات المستقبل',
  heroText:'معًا نحو جيل مبدع يساهم في بناء وطن طموح.',
  vision:'بيئة رقمية محفزة لرعاية الموهوبات واكتشاف قدراتهن وتعزيز فرصهن النوعية وصناعة مستقبل واعد.',
  heroImage:'',
  basic:{
    school:'الثانوية الأولى بينبع البحر',coordinator:'أبرار الهنيدي',principal:'هدى البهيجي',semester:'الفصل الدراسي الأول 1448هـ',assignment:'',
    assignmentFilePath:'',assignmentFileName:'',assignmentFileType:'',assignmentFileUrl:''
  },
  stats:{programs:0,registered:0,participants:0,gifted:0},
  programs:[],opportunities:[],achievements:[],links:[],plan:[]
};
let cloudData = structuredClone(FALLBACK);
let currentRole = 'viewer';
let currentProfile = null;
let editContext = null;
let removeAssignmentRequested = false;

function esc(s=''){return String(s).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function avgProgress(plan){return plan.length?Math.round(plan.reduce((s,p)=>s+(+p.progress||0),0)/plan.length):0}
function setBusy(message='جارِ تحميل بيانات نماء...'){
  let el=document.querySelector('.loading-screen');
  if(!el){el=document.createElement('div');el.className='loading-screen';document.body.appendChild(el)}
  el.textContent=message;
}
function clearBusy(){document.querySelector('.loading-screen')?.remove()}
function showCloudStatus(text){
  let el=document.querySelector('.cloud-status');
  if(!el){el=document.createElement('div');el.className='cloud-status';document.body.appendChild(el)}
  el.textContent=text;
  setTimeout(()=>el.remove(),2600);
}
function publicMediaUrl(path){
  if(!path) return '';
  if(/^https?:|^data:/.test(path)) return path;
  const {data}=sb.storage.from('namaa-media').getPublicUrl(path);
  return data?.publicUrl||'';
}
async function privateFileUrl(path){
  if(!path) return '';
  if(/^https?:|^data:/.test(path)) return path;
  const {data,error}=await sb.storage.from('namaa-private').createSignedUrl(path,3600);
  if(error) return '';
  return data?.signedUrl||'';
}
function validatePrivateFile(file, mode='assignment'){
  if(!file) return;
  const max = mode==='report' ? MAX_REPORT_FILE : MAX_ASSIGNMENT_FILE;
  const maxLabel = mode==='report' ? '50MB' : '12MB';
  if(file.size > max) throw new Error(`حجم الملف أكبر من ${maxLabel}. خففي حجمه ثم أعيدي المحاولة.`);
  if(mode==='report' && file.type!=='application/pdf') throw new Error('تقرير بند الخطة يجب أن يكون بصيغة PDF.');
  if(mode==='assignment' && !(file.type==='application/pdf' || file.type.startsWith('image/'))) throw new Error('مرفق التكليف يجب أن يكون صورة أو PDF.');
}
async function uploadPublicImage(file, folder='general'){
  if(!file) return '';
  if(currentRole!=='admin') throw new Error('هذا الحساب لا يملك صلاحية رفع الصور.');
  const safe=(file.name||'image').replace(/[^a-zA-Z0-9._-]+/g,'-');
  const path=`${folder}/${crypto.randomUUID()}-${safe}`;
  const {error}=await sb.storage.from('namaa-media').upload(path,file,{cacheControl:'3600',upsert:false});
  if(error) throw error;
  return publicMediaUrl(path);
}
async function uploadPrivateFile(file, folder, mode){
  if(!file) return '';
  if(currentRole!=='admin') throw new Error('هذا الحساب لا يملك صلاحية رفع الملفات.');
  validatePrivateFile(file,mode);
  const ext=(file.name.split('.').pop()||'file').toLowerCase().replace(/[^a-z0-9]/g,'');
  const path=`${folder}/${crypto.randomUUID()}.${ext||'file'}`;
  const {error}=await sb.storage.from('namaa-private').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||undefined});
  if(error) throw error;
  return path;
}
async function deletePrivateFile(path){
  if(!path || /^https?:|^data:/.test(path)) return;
  await sb.storage.from('namaa-private').remove([path]);
}
async function touchSiteUpdatedAt(){
  if(currentRole!=='admin'||!cloudData.settingsId)return;
  await sb.from('site_settings').update({updated_at:new Date().toISOString()}).eq('id',cloudData.settingsId);
}
window.downloadPrivate = async (path,name='ملف') => {
  try{
    showCloudStatus('جارِ تجهيز الملف للتنزيل...');
    if(/^https?:/.test(path)){ window.open(path,'_blank','noopener'); return; }
    const {data,error}=await sb.storage.from('namaa-private').download(path);
    if(error) throw error;
    const url=URL.createObjectURL(data);
    const a=document.createElement('a');a.href=url;a.download=name||'ملف';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){alert('تعذر تنزيل الملف: '+e.message)}
};

async function loadPublicData(includePlan=false){
  const [settingsRes,statsRes,programsRes,oppsRes,achRes,linksRes] = await Promise.all([
    sb.from('site_settings').select('*').order('id',{ascending:true}).limit(1).maybeSingle(),
    sb.from('statistics').select('*').order('id',{ascending:true}).limit(1).maybeSingle(),
    sb.from('programs').select('*').order('sort_order').order('created_at'),
    sb.from('opportunities').select('*').order('sort_order').order('created_at'),
    sb.from('achievements').select('*').order('sort_order').order('created_at'),
    sb.from('important_links').select('*').order('sort_order').order('created_at')
  ]);
  const results=[settingsRes,statsRes,programsRes,oppsRes,achRes,linksRes];
  const err=results.find(r=>r.error)?.error;if(err) throw err;
  const s=settingsRes.data||{}, st=statsRes.data||{};
  cloudData={
    heroTitle:s.hero_title||FALLBACK.heroTitle,
    heroText:s.hero_text||FALLBACK.heroText,
    vision:s.vision||FALLBACK.vision,
    heroImage:s.hero_image_url||'',settingsId:s.id||null,updatedAt:s.updated_at||'',
    basic:{
      school:s.school_name||FALLBACK.basic.school,
      coordinator:s.coordinator_name||FALLBACK.basic.coordinator,
      principal:s.principal_name||FALLBACK.basic.principal,
      semester:s.semester||FALLBACK.basic.semester,
      assignment:s.assignment_notes||'',
      assignmentFilePath:s.assignment_file_path||'',
      assignmentFileName:s.assignment_file_name||'',
      assignmentFileType:s.assignment_file_type||'',
      assignmentFileUrl:''
    },
    stats:{programs:st.programs_count??0,registered:st.registered_count??0,participants:st.participants_count??0,gifted:st.gifted_count??0},statsId:st.id||null,
    programs:(programsRes.data||[]).map(p=>({id:p.id,title:p.title,desc:p.description||'',date:p.program_date||'',status:p.status||'',url:p.external_url||'',coverImage:p.cover_image_url||'',published:p.is_published,sort:p.sort_order})),
    opportunities:(oppsRes.data||[]).map(o=>({id:o.id,title:o.title,date:o.opportunity_date||'',url:o.external_url||'',published:o.is_published,sort:o.sort_order})),
    achievements:(achRes.data||[]).map(a=>({id:a.id,title:a.title,note:a.description||'',image:a.image_url||'',evidence:a.evidence_url||'',published:a.is_published,sort:a.sort_order})),
    links:(linksRes.data||[]).map(l=>({id:l.id,title:l.title,url:l.url,published:l.is_published,sort:l.sort_order})),plan:[]
  };
  if(includePlan){
    const {data,error}=await sb.from('plan_items').select('*').order('sort_order').order('created_at');
    if(error) throw error;
    cloudData.plan=(data||[]).map(p=>({
      id:p.id,title:p.title,date:p.plan_date||'',dateFrom:p.date_from||p.plan_date||'',dateTo:p.date_to||'',status:p.status||'',progress:p.progress||0,notes:p.notes||'',sort:p.sort_order,
      reportPath:p.report_pdf_path||'',reportName:p.report_file_name||'',reportUrl:''
    }));
    cloudData.basic.assignmentFileUrl=await privateFileUrl(cloudData.basic.assignmentFilePath);
    await Promise.all(cloudData.plan.map(async p=>{p.reportUrl=await privateFileUrl(p.reportPath)}));
  }
  return cloudData;
}

function statusClass(status=''){
  const x=String(status).trim();
  if(/منتهي|مغلق/.test(x)) return 'status-ended';
  if(/قريب|قادم/.test(x)) return 'status-soon';
  if(/مفتوح|منشور|متاح|الآن/.test(x)) return 'status-open';
  return 'status-neutral';
}
function formatLastUpdated(value){
  if(!value) return '';
  try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}catch(e){return ''}
}
function renderPublic(){
  if(!document.getElementById('programGrid')) return;
  const d=cloudData;
  heroTitle.textContent=d.heroTitle;heroText.textContent=d.heroText;visionText.textContent=d.vision;
  footerCoordinator.textContent=`منسقة الموهوبات: ${d.basic.coordinator}`;
  footerPrincipal.textContent=`مديرة المدرسة: ${d.basic.principal}`;
  if(document.getElementById('footerLastUpdated')) footerLastUpdated.textContent=d.updatedAt?`آخر تحديث: ${formatLastUpdated(d.updatedAt)}`:'';
  const hm=document.getElementById('heroMedia');
  const heroBg=d.heroImage?publicMediaUrl(d.heroImage):'assets/hero-gifted-future.png';
  hm.style.backgroundImage=`linear-gradient(180deg,rgba(17,59,106,.04),rgba(17,59,106,.12)),url('${esc(heroBg)}')`;
  stats.innerHTML=[['البرامج',d.stats.programs],['المسجلات',d.stats.registered],['المشاركات',d.stats.participants],['الموهوبات',d.stats.gifted]].map((x,i)=>`<div class="stat"><span class="stat-index">${String(i+1).padStart(2,'0')}</span><div class="stat-copy"><b>${esc(x[1])}</b><span>${esc(x[0])}</span></div></div>`).join('');
  const next=d.opportunities?.[0];
  const nextSec=document.getElementById('nextOpportunitySection');
  if(next&&nextSec){nextSec.hidden=false;nextOpportunityTitle.textContent=next.title;nextOpportunityDate.textContent=next.date||'';if(next.url){nextOpportunityLink.href=next.url;nextOpportunityLink.hidden=false}else nextOpportunityLink.hidden=true}else if(nextSec) nextSec.hidden=true;
  programGrid.innerHTML=d.programs.map((p,i)=>{const img=publicMediaUrl(p.coverImage);return `<article class="program-card"><div class="program-cover" ${img?`style="background-image:linear-gradient(180deg,rgba(9,42,83,.04),rgba(9,42,83,.48)),url('${esc(img)}')"`:''}><div class="program-no">${String(i+1).padStart(2,'0')}</div><div class="program-cover-copy"><small>برنامج / إعلان</small><strong>${esc(p.title)}</strong></div></div><div class="program-body"><span class="tag ${statusClass(p.status)}">${esc(p.status||'متاح')}</span><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p><small>${esc(p.date)}</small><div style="margin-top:13px"><a class="btn secondary" target="_blank" rel="noopener" href="${esc(p.url||'#')}">التفاصيل والرابط</a></div></div></article>`}).join('')||'<div class="card padded">لا توجد برامج منشورة حاليًا.</div>';
  opportunityList.innerHTML=d.opportunities.map((o,i)=>`<div class="list-item clean-list"><span class="item-index">${String(i+1).padStart(2,'0')}</span><div style="flex:1"><strong>${esc(o.title)}</strong><div style="color:#7a8aa0;font-size:13px;margin-top:4px">${esc(o.date)}</div>${o.url?`<div class="hint"><a class="inline-link" target="_blank" rel="noopener" href="${esc(o.url)}">فتح الرابط</a></div>`:''}</div></div>`).join('')||'<div class="list-item">لا توجد فرص حالية.</div>';
  const achievementCards=d.achievements.map((a,i)=>{const img=publicMediaUrl(a.image);return `<article class="achievement achievement-celebrate">${img?`<div class="achievement-image" style="background-image:url('${esc(img)}')"></div>`:''}<div class="achievement-content"><span class="achievement-star" aria-hidden="true">★</span><span class="achievement-no">${String(i+1).padStart(2,'0')}</span><h3>${esc(a.title)}</h3><p>${esc(a.note)}</p>${a.evidence?`<a class="achievement-link" href="${esc(a.evidence)}" target="_blank" rel="noopener">عرض الشاهد</a>`:''}</div></article>`}).join('');
  achievementGrid.innerHTML=achievementCards||'<div class="achievement"><h3>قريبًا</h3><p>ستظهر الإنجازات هنا بعد إضافتها.</p></div>';
  const ticker=document.getElementById('achievementsTicker');
  if(ticker){
    if(d.achievements.length){
      const items=d.achievements.map(a=>`<span class="ticker-item"><span class="ticker-star">★</span>${esc(a.title)}</span>`).join('');
      ticker.innerHTML=`<div class="ticker-track">${items}${items}</div>`;
      ticker.hidden=false;
    }else{ticker.hidden=true;ticker.innerHTML=''}
  }
  importantLinks.innerHTML=d.links.map((l,i)=>`<a class="important-link" target="_blank" rel="noopener" href="${esc(l.url)}"><span class="item-index">${String(i+1).padStart(2,'0')}</span><span class="link-title"><strong>${esc(l.title)}</strong><small>فتح الرابط</small></span><span class="link-arrow">‹</span></a>`).join('')||'<div class="important-link">لا توجد روابط مضافة.</div>';
}

function table(headers,rows){return `<div class="responsive-table-wrap"><table class="responsive-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td data-label="${esc(headers[i]||'')}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function actions(type,id){return currentRole==='admin'?`<button class="action-btn row-edit edit-only" onclick="openEdit('${type}','${id}')">تعديل</button><button class="action-btn danger row-delete edit-only" onclick="removeItem('${type}','${id}')">حذف</button>`:'مشاهدة فقط'}
function dateRangeHtml(p){
  const from=p.dateFrom||p.date||'—',to=p.dateTo||'—';
  return `<div class="date-range"><span><b>من:</b> ${esc(from)}</span><span><b>إلى:</b> ${esc(to)}</span></div>`;
}
function reportButton(p){
  if(!p.reportPath) return '<span class="hint">لا يوجد تقرير</span>';
  const preview=p.reportUrl?`<a class="report-link preview-report" target="_blank" rel="noopener" href="${esc(p.reportUrl)}#toolbar=1">معاينة التقرير</a>`:'';
  const download=`<button class="report-link download-report" type="button" onclick="downloadPrivate('${esc(p.reportPath)}','${esc(p.reportName||'تقرير.pdf')}')">تنزيل التقرير</button>`;
  return `<div class="report-actions">${preview}${download}</div>`;
}
let currentPlanFilter='all';
function renderPlanTable(){
  const wrap=document.getElementById('planTableWrap');if(!wrap)return;
  const rows=cloudData.plan.filter(p=>currentPlanFilter==='all'||p.status===currentPlanFilter);
  wrap.innerHTML=table(['البند','الفترة','الحالة','الإنجاز','التقرير','الخطة التنفيذية','إجراءات'],rows.map(p=>[esc(p.title),dateRangeHtml(p),`<span class="status-pill">${esc(p.status)}</span>`,p.progress+'%',reportButton(p),`<a class="action-btn executive-plan-link" href="executive-plan.html?plan_id=${encodeURIComponent(p.id)}">فتح الخطة</a>`,actions('plan',p.id)]));
  if(!rows.length) wrap.innerHTML='<div class="empty-state">لا توجد بنود مطابقة للتصفية الحالية.</div>';
}
function assignmentDocumentHtml(){
  const b=cloudData.basic;
  if(!b.assignmentFilePath) return `<div class="assignment-document"><div class="assignment-preview"><div class="assignment-empty">لم يتم رفع صورة أو ملف التكليف بعد.</div></div><div class="assignment-actions"><strong>مرفق التكليف</strong><p>سيظهر المرفق هنا بعد رفعه من حساب المنسقة.</p></div></div>`;
  const isPdf=(b.assignmentFileType||'').includes('pdf') || (b.assignmentFileName||'').toLowerCase().endsWith('.pdf');
  const preview=b.assignmentFileUrl ? (isPdf?`<iframe src="${esc(b.assignmentFileUrl)}#toolbar=0" title="معاينة التكليف"></iframe>`:`<img src="${esc(b.assignmentFileUrl)}" alt="صورة التكليف">`) : `<div class="assignment-empty">تعذر إنشاء معاينة للمرفق، ويمكن تنزيله مباشرة.</div>`;
  return `<div class="assignment-document"><div class="assignment-preview">${preview}</div><div class="assignment-actions"><strong>مرفق التكليف</strong><p>${esc(b.assignmentFileName||'ملف التكليف')}</p><button class="btn primary" type="button" onclick="downloadPrivate('${esc(b.assignmentFilePath)}','${esc(b.assignmentFileName||'تكليف')}')">تنزيل ${isPdf?'الملف':'الصورة'}</button>${b.assignmentFileUrl?`<a class="btn secondary" target="_blank" rel="noopener" href="${esc(b.assignmentFileUrl)}">فتح بالحجم الكامل</a>`:''}</div></div>`;
}
function renderBasicSummary(){
  if(!document.getElementById('basicSummary')) return;
  const b=cloudData.basic;
  basicSummary.innerHTML=`<h3 class="viewer-card-title">بيانات منسقة الموهوبات والتكليف</h3><div class="basic-summary-grid"><div class="info-tile"><small>المدرسة</small><strong>${esc(b.school)}</strong></div><div class="info-tile"><small>منسقة الموهوبات</small><strong>${esc(b.coordinator)}</strong></div><div class="info-tile"><small>مديرة المدرسة</small><strong>${esc(b.principal)}</strong></div><div class="info-tile"><small>الفصل الدراسي</small><strong>${esc(b.semester)}</strong></div></div>${b.assignment?`<div class="assignment-note"><strong>بيانات التكليف</strong><br>${esc(b.assignment)}</div>`:''}${assignmentDocumentHtml()}`;
}

function renderAdmin(){
  if(!document.querySelector('.admin-shell')) return;
  const d=cloudData,avg=avgProgress(d.plan);
  document.body.classList.toggle('viewer',currentRole!=='admin');
  currentUserName.textContent=currentProfile?.full_name||'مستخدم';
  currentRoleBadge.textContent=currentRole==='admin'?'منسقة — تعديل كامل':'مديرة — مشاهدة فقط';
  document.querySelectorAll('.admin-only-nav,.admin-only-block,.admin-only-panel').forEach(el=>{el.hidden=currentRole!=='admin'});
  if(currentRole!=='admin' && document.querySelector('[data-panel="account"]')?.classList.contains('active')){
    document.querySelectorAll('.admin-panel').forEach(x=>x.classList.remove('active'));
    document.querySelector('[data-panel="dashboard"]')?.classList.add('active');
  }
  if(document.getElementById('currentUserEmail')) currentUserEmail.textContent=window.__currentUserEmail||'—';
  const reportCount=d.plan.filter(x=>x.reportPath).length;
  dashboardStats.innerHTML=[['نسبة تنفيذ الخطة',avg+'%'],['برامج منفذة',d.plan.filter(x=>x.progress>=100).length],['تقارير مرفوعة',reportCount],['برامج قادمة',d.plan.filter(x=>x.progress===0).length]].map((x,i)=>`<div class="stat"><span class="stat-index">${String(i+1).padStart(2,'0')}</span><div class="stat-copy"><b>${esc(x[1])}</b><span>${esc(x[0])}</span></div></div>`).join('');
  overallProgress.textContent=avg+'%';progressBar.style.width=avg+'%';
  planMiniList.innerHTML=d.plan.map(p=>`<div class="list-item"><div><strong>${esc(p.title)}</strong><div class="hint">${esc(p.dateFrom||p.date||'')} ${p.dateTo?`— ${esc(p.dateTo)}`:''}</div></div><strong>${p.progress}%</strong></div>`).join('')||'<div class="list-item">لم تتم إضافة بنود للخطة بعد.</div>';
  followupList.innerHTML=d.plan.map(p=>`<div class="list-item"><div><strong>${esc(p.title)}</strong><div style="color:#64748b;margin-top:5px">${esc(p.status)} • ${esc(p.dateFrom||p.date||'')} ${p.dateTo?`إلى ${esc(p.dateTo)}`:''}</div>${p.notes?`<div class="hint">${esc(p.notes)}</div>`:''}<div class="followup-report">${reportButton(p)}</div></div><strong>${p.progress}%</strong></div>`).join('');
  renderPlanTable();
  programTableWrap.innerHTML=table(['البرنامج / الإعلان','التاريخ','الحالة','الخلفية','إجراءات'],d.programs.map(p=>[esc(p.title),esc(p.date),esc(p.status),p.coverImage?'مضافة':'افتراضية',actions('programs',p.id)]));
  opportunitiesTableWrap.innerHTML=table(['الفرصة / المسابقة','التاريخ','الرابط','إجراءات'],d.opportunities.map(o=>[esc(o.title),esc(o.date),o.url?`<a class="inline-link" target="_blank" href="${esc(o.url)}">فتح</a>`:'—',actions('opportunities',o.id)]));
  achievementTableWrap.innerHTML=table(['الإنجاز','ملاحظة','إجراءات'],d.achievements.map(a=>[esc(a.title),esc(a.note),actions('achievements',a.id)]));
  linksTableWrap.innerHTML=table(['العنوان','الرابط','إجراءات'],d.links.map(l=>[esc(l.title),`<a class="inline-link" target="_blank" href="${esc(l.url)}">فتح الرابط</a>`,actions('links',l.id)]));
  fHeroTitle.value=d.heroTitle;fHeroText.value=d.heroText;fVision.value=d.vision;fHeroImageUrl.value=d.heroImage||'';setPreview(heroPreview,publicMediaUrl(d.heroImage));
  fSchool.value=d.basic.school;fCoordinator.value=d.basic.coordinator;fPrincipal.value=d.basic.principal;fSemester.value=d.basic.semester;fAssignment.value=d.basic.assignment;
  sPrograms.value=d.stats.programs;sRegistered.value=d.stats.registered;sParticipants.value=d.stats.participants;sGifted.value=d.stats.gifted;
  renderBasicSummary();
  renderAssignmentUploadPreview();
  statsViewer.innerHTML=`<h3 class="viewer-card-title">الإحصائيات الحالية</h3><div class="stats-viewer-grid"><div class="info-tile"><small>البرامج</small><strong>${d.stats.programs}</strong></div><div class="info-tile"><small>المسجلات</small><strong>${d.stats.registered}</strong></div><div class="info-tile"><small>المشاركات</small><strong>${d.stats.participants}</strong></div><div class="info-tile"><small>الموهوبات</small><strong>${d.stats.gifted}</strong></div></div>`;
}
function setPreview(img,value){if(!img)return;const box=img.closest('.preview-box');if(value){img.src=value;box?.classList.add('has-image')}else{img.removeAttribute('src');box?.classList.remove('has-image')}}
function renderAssignmentUploadPreview(){
  const el=document.getElementById('assignmentUploadPreview');if(!el)return;
  const b=cloudData.basic;
  if(removeAssignmentRequested){el.innerHTML='<div class="file-pill"><strong>سيتم حذف المرفق الحالي عند الحفظ.</strong></div>';return}
  if(fAssignmentFile?.files?.[0]){const f=fAssignmentFile.files[0];el.innerHTML=`<div class="file-pill"><strong>ملف جديد: ${esc(f.name)}</strong><span>${Math.round(f.size/1024)} KB</span></div>`;return}
  if(b.assignmentFilePath){el.innerHTML=`<div class="file-pill"><strong>المرفق الحالي: ${esc(b.assignmentFileName||'ملف التكليف')}</strong><button class="report-link" type="button" onclick="downloadPrivate('${esc(b.assignmentFilePath)}','${esc(b.assignmentFileName||'تكليف')}')">تنزيل</button></div>`;return}
  el.innerHTML='';
}

function dialogContent(type,item={}){
  if(type==='plan')return `<div class="dialog-fields-grid"><label class="full">اسم البند<input name="title" value="${esc(item.title||'')}"></label><label>التاريخ من<input name="dateFrom" value="${esc(item.dateFrom||item.date||'')}" placeholder="مثال: 1/4/1448هـ"></label><label>التاريخ إلى<input name="dateTo" value="${esc(item.dateTo||'')}" placeholder="مثال: 15/4/1448هـ"></label><label>الحالة<input name="status" value="${esc(item.status||'')}"></label><label>نسبة الإنجاز<input name="progress" type="number" min="0" max="100" value="${esc(item.progress??'')}"></label><label class="full">ملاحظات<textarea name="notes" rows="3">${esc(item.notes||'')}</textarea></label><label class="full">تقرير البند PDF<span class="file-pick">اختيار ملف PDF<input name="reportFile" type="file" accept="application/pdf"></span><div class="hint">الحد الأقصى 50MB. ${item.reportPath?`يوجد تقرير حالي: ${esc(item.reportName||'تقرير.pdf')}`:'لا يوجد تقرير مرفوع حاليًا.'}</div></label>${item.reportPath?`<label class="checkbox-row"><input name="removeReport" type="checkbox" value="1"> إزالة التقرير الحالي عند الحفظ</label>`:''}</div>`;
  if(type==='programs')return `<div class="dialog-fields-grid"><label class="full">اسم البرنامج / الإعلان<input name="title" value="${esc(item.title||'')}"></label><label>التاريخ<input name="date" value="${esc(item.date||'')}"></label><label>الحالة<input name="status" value="${esc(item.status||'')}"></label><label class="full">الوصف<textarea name="desc" rows="4">${esc(item.desc||'')}</textarea></label><label class="full">الرابط<input name="url" type="url" value="${esc(item.url||'')}"></label><label class="full">رابط صورة / خلفية<input name="coverImage" value="${esc(item.coverImage||'')}"></label><label class="full">أو ارفعي صورة من الجهاز<span class="file-pick">اختيار صورة<input type="file" accept="image/*" data-upload="program"></span></label><div class="preview-box full ${item.coverImage?'has-image':''}"><img id="dialogImagePreview" ${item.coverImage?`src="${esc(publicMediaUrl(item.coverImage))}"`:''} alt="معاينة"></div></div>`;
  if(type==='opportunities')return `<div class="dialog-fields-grid"><label class="full">اسم الفرصة / المسابقة<input name="title" value="${esc(item.title||'')}"></label><label>التاريخ<input name="date" value="${esc(item.date||'')}"></label><label>الرابط<input name="url" type="url" value="${esc(item.url||'')}"></label></div>`;
  if(type==='achievements')return `<div class="dialog-fields-grid"><label class="full">عنوان الإنجاز<input name="title" value="${esc(item.title||'')}"></label><label class="full">ملاحظة / وصف<textarea name="note" rows="4">${esc(item.note||'')}</textarea></label><label class="full">رابط الشاهد<input name="evidence" type="url" value="${esc(item.evidence||'')}"></label><label class="full">صورة الإنجاز<input name="achievementImage" value="${esc(item.image||'')}" placeholder="رابط صورة أو ارفعي صورة من الجهاز"></label><label class="full"><span class="file-pick">اختيار صورة<input type="file" accept="image/*" data-upload="achievement" data-target="achievementImage"></span></label><div class="preview-box full ${item.image?'has-image':''}"><img id="dialogAchievementPreview" ${item.image?`src="${esc(publicMediaUrl(item.image))}"`:''} alt="معاينة الإنجاز"></div></div>`;
  return `<div class="dialog-fields-grid"><label class="full">اسم الرابط<input name="title" value="${esc(item.title||'')}"></label><label class="full">الرابط<input name="url" type="url" value="${esc(item.url||'')}"></label></div>`;
}
function openDialog(type,item=null){if(currentRole!=='admin')return;editContext={type,id:item?.id||null,oldReportPath:item?.reportPath||''};dialogTitle.textContent=item?'تعديل':'إضافة';dialogFields.innerHTML=dialogContent(type,item||{});document.body.classList.add('modal-open');editorDialog.showModal();requestAnimationFrame(()=>editorDialog.querySelector('input,textarea,select')?.focus({preventScroll:true}))}
window.openEdit=(type,id)=>{const item=cloudData[type].find(x=>String(x.id)===String(id));openDialog(type,item)};
async function removeItem(type,id){
  if(currentRole!=='admin'||!confirm('هل تريدين حذف هذا العنصر؟'))return;
  const map={plan:'plan_items',programs:'programs',opportunities:'opportunities',achievements:'achievements',links:'important_links'};
  const item=cloudData[type].find(x=>String(x.id)===String(id));
  const {error}=await sb.from(map[type]).delete().eq('id',id);if(error)return alert(error.message);
  if(type==='plan'&&item?.reportPath) await deletePrivateFile(item.reportPath);
  await touchSiteUpdatedAt();
  await refreshAdmin('تم الحذف');
}
window.removeItem=removeItem;
async function refreshAdmin(msg=''){await loadPublicData(true);renderAdmin();if(msg)showCloudStatus(msg)}

async function saveSimple(type){
  if(currentRole!=='admin')return;
  try{
    if(type==='intro'){
      let image=fHeroImageUrl.value.trim();
      if(fHeroImageFile?.files?.[0]){showCloudStatus('جارِ رفع الصورة...');image=await uploadPublicImage(fHeroImageFile.files[0],'hero')}
      const payload={hero_title:fHeroTitle.value.trim(),hero_text:fHeroText.value.trim(),vision:fVision.value.trim(),hero_image_url:image,updated_at:new Date().toISOString()};
      const {error}=await sb.from('site_settings').update(payload).eq('id',cloudData.settingsId);if(error)throw error;
    }else if(type==='basic'){
      const oldPath=cloudData.basic.assignmentFilePath||'';
      let path=oldPath,name=cloudData.basic.assignmentFileName||'',mime=cloudData.basic.assignmentFileType||'';
      const file=fAssignmentFile?.files?.[0];
      if(file){
        showCloudStatus('جارِ رفع ملف التكليف...');
        path=await uploadPrivateFile(file,'assignments','assignment');name=file.name;mime=file.type;
      }else if(removeAssignmentRequested){path='';name='';mime=''}
      const payload={school_name:fSchool.value.trim(),coordinator_name:fCoordinator.value.trim(),principal_name:fPrincipal.value.trim(),semester:fSemester.value.trim(),assignment_notes:fAssignment.value.trim(),assignment_file_path:path||null,assignment_file_name:name||null,assignment_file_type:mime||null,updated_at:new Date().toISOString()};
      const {error}=await sb.from('site_settings').update(payload).eq('id',cloudData.settingsId);if(error)throw error;
      if(oldPath && oldPath!==path) await deletePrivateFile(oldPath);
      removeAssignmentRequested=false;fAssignmentFile.value='';
    }else if(type==='stats'){
      const payload={programs_count:+sPrograms.value||0,registered_count:+sRegistered.value||0,participants_count:+sParticipants.value||0,gifted_count:+sGifted.value||0,updated_at:new Date().toISOString()};
      const q=cloudData.statsId?sb.from('statistics').update(payload).eq('id',cloudData.statsId):sb.from('statistics').insert(payload);const {error}=await q;if(error)throw error;
    }
    await touchSiteUpdatedAt();
    await refreshAdmin('تم الحفظ في قاعدة البيانات');
  }catch(e){alert('تعذر الحفظ: '+e.message)}
}

function setupPasswordToggles(root=document){
  root.querySelectorAll('[data-toggle-password]').forEach(btn=>btn.addEventListener('click',()=>{
    const input=document.getElementById(btn.dataset.togglePassword);if(!input)return;
    const show=input.type==='password';input.type=show?'text':'password';
    btn.classList.toggle('is-visible',show);
    btn.setAttribute('aria-label',show?'إخفاء كلمة المرور':'إظهار كلمة المرور');
    btn.setAttribute('title',show?'إخفاء كلمة المرور':'إظهار كلمة المرور');
  }));
}
function siteBaseUrl(){return new URL('.',location.href).href}
async function setupLogin(){
  const form=document.getElementById('loginForm');if(!form)return;
  setupPasswordToggles();
  const {data:{session}}=await sb.auth.getSession();if(session){location.replace('admin.html');return}
  form.addEventListener('submit',async e=>{e.preventDefault();loginMessage.textContent='جارِ تسجيل الدخول...';const {error}=await sb.auth.signInWithPassword({email:loginEmail.value.trim(),password:loginPassword.value});if(error){loginMessage.textContent='تعذر تسجيل الدخول: '+error.message;return}loginMessage.classList.add('success');loginMessage.textContent='تم تسجيل الدخول';location.replace('admin.html')});
}
async function setupForgotPassword(){
  const form=document.getElementById('forgotForm');if(!form)return;
  form.addEventListener('submit',async e=>{e.preventDefault();forgotMessage.textContent='جارِ إرسال الرابط...';const redirectTo=siteBaseUrl()+'reset-password.html';const {error}=await sb.auth.resetPasswordForEmail(forgotEmail.value.trim(),{redirectTo});if(error){forgotMessage.textContent='تعذر الإرسال: '+error.message;return}forgotMessage.classList.add('success');forgotMessage.textContent='تم إرسال رابط الاستعادة. تحققي من البريد.'});
}
async function setupResetPassword(){
  const form=document.getElementById('resetPasswordForm');if(!form)return;
  setupPasswordToggles();
  form.addEventListener('submit',async e=>{e.preventDefault();if(resetPassword.value!==resetPasswordConfirm.value){resetMessage.textContent='كلمتا المرور غير متطابقتين.';return}resetMessage.textContent='جارِ حفظ كلمة المرور...';const {error}=await sb.auth.updateUser({password:resetPassword.value});if(error){resetMessage.textContent='تعذر التحديث: '+error.message;return}resetMessage.classList.add('success');resetMessage.textContent='تم تحديث كلمة المرور. يمكنك العودة لتسجيل الدخول.'});
}

async function setupAdmin(){
  if(!document.querySelector('.admin-shell'))return;
  setBusy('جارِ التحقق من الحساب والصلاحيات...');
  const {data:{session}}=await sb.auth.getSession();if(!session){location.replace('login.html');return}
  window.__currentUserEmail=session.user.email||'';
  const {data:profile,error}=await sb.from('profiles').select('full_name,role').eq('id',session.user.id).single();
  if(error||!profile){await sb.auth.signOut();clearBusy();alert('لم يتم العثور على صلاحية لهذا الحساب.');location.replace('login.html');return}
  currentProfile=profile;currentRole=profile.role;
  setupPasswordToggles();
  document.querySelectorAll('.admin-only-nav,.admin-only-block,.admin-only-panel').forEach(el=>{el.hidden=currentRole!=='admin'});
  if(currentRole!=='admin' && document.querySelector('[data-panel="account"]')?.classList.contains('active')){
    document.querySelectorAll('.admin-panel').forEach(x=>x.classList.remove('active'));
    document.querySelector('[data-panel="dashboard"]')?.classList.add('active');
  }
  logoutBtn.addEventListener('click',async()=>{await sb.auth.signOut();location.replace('login.html')});
  document.querySelectorAll('.side-link[data-section]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.side-link').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.admin-panel').forEach(x=>x.classList.remove('active'));document.querySelector(`[data-panel="${btn.dataset.section}"]`).classList.add('active')}));
  planStatusFilter?.addEventListener('change',e=>{currentPlanFilter=e.target.value;renderPlanTable()});
  document.querySelectorAll('.save-btn').forEach(btn=>btn.addEventListener('click',()=>saveSimple(btn.dataset.save)));
  addPlanBtn.addEventListener('click',()=>openDialog('plan'));addProgramBtn.addEventListener('click',()=>openDialog('programs'));addOpportunityBtn.addEventListener('click',()=>openDialog('opportunities'));addAchievementBtn.addEventListener('click',()=>openDialog('achievements'));addLinkBtn.addEventListener('click',()=>openDialog('links'));
  clearHeroImageBtn.addEventListener('click',()=>{fHeroImageUrl.value='';fHeroImageFile.value='';setPreview(heroPreview,'')});
  fHeroImageFile.addEventListener('change',()=>{const f=fHeroImageFile.files?.[0];if(f)setPreview(heroPreview,URL.createObjectURL(f))});
  fAssignmentFile.addEventListener('change',()=>{removeAssignmentRequested=false;try{validatePrivateFile(fAssignmentFile.files?.[0],'assignment');renderAssignmentUploadPreview()}catch(e){fAssignmentFile.value='';alert(e.message)}});
  clearAssignmentFileBtn.addEventListener('click',()=>{fAssignmentFile.value='';removeAssignmentRequested=true;renderAssignmentUploadPreview()});
  editorDialog.addEventListener('change',async e=>{if(!e.target.matches('[data-upload]'))return;const file=e.target.files?.[0];if(!file)return;try{showCloudStatus('جارِ رفع الصورة...');const kind=e.target.dataset.upload;const folder=kind==='achievement'?'achievements':'programs';const target=e.target.dataset.target||(kind==='achievement'?'achievementImage':'coverImage');const url=await uploadPublicImage(file,folder);const inp=editorDialog.querySelector(`[name="${target}"]`);if(inp)inp.value=url;const previewId=kind==='achievement'?'dialogAchievementPreview':'dialogImagePreview';setPreview(document.getElementById(previewId),url);showCloudStatus('تم رفع الصورة')}catch(err){alert('تعذر رفع الصورة: '+err.message)}});
  editorDialog.addEventListener('change',e=>{if(e.target.name==='reportFile'&&e.target.files?.[0]){try{validatePrivateFile(e.target.files[0],'report');showCloudStatus(`تم اختيار التقرير — ${(e.target.files[0].size/1024/1024).toFixed(1)} MB`)}catch(err){e.target.value='';alert(err.message)}}});
  editorForm.addEventListener('submit',async e=>{
    e.preventDefault();if(currentRole!=='admin')return;
    const fd=new FormData(editorForm),o=Object.fromEntries(fd.entries());
    try{
      let cfg;
      if(editContext.type==='plan'){
        let reportPath=editContext.oldReportPath||'';
        let reportName=cloudData.plan.find(x=>String(x.id)===String(editContext.id))?.reportName||'';
        const reportFile=editorDialog.querySelector('[name="reportFile"]')?.files?.[0];
        if(reportFile){showCloudStatus('جارِ رفع تقرير PDF...');const newPath=await uploadPrivateFile(reportFile,'plan-reports','report');if(reportPath)await deletePrivateFile(reportPath);reportPath=newPath;reportName=reportFile.name}
        else if(o.removeReport==='1'&&reportPath){await deletePrivateFile(reportPath);reportPath='';reportName=''}
        cfg={table:'plan_items',payload:{title:o.title,plan_date:o.dateFrom||'',date_from:o.dateFrom||'',date_to:o.dateTo||'',status:o.status||'',progress:Math.max(0,Math.min(100,+o.progress||0)),notes:o.notes||'',report_pdf_path:reportPath||null,report_file_name:reportName||null}};
      }else if(editContext.type==='programs') cfg={table:'programs',payload:{title:o.title,description:o.desc||'',program_date:o.date||'',status:o.status||'',external_url:o.url||null,cover_image_url:o.coverImage||null,is_published:true}};
      else if(editContext.type==='opportunities') cfg={table:'opportunities',payload:{title:o.title,opportunity_date:o.date||'',external_url:o.url||null,is_published:true}};
      else if(editContext.type==='achievements') cfg={table:'achievements',payload:{title:o.title,description:o.note||'',image_url:o.achievementImage||null,evidence_url:o.evidence||null,is_published:true}};
      else cfg={table:'important_links',payload:{title:o.title,url:o.url,is_published:true}};
      const q=editContext.id?sb.from(cfg.table).update(cfg.payload).eq('id',editContext.id):sb.from(cfg.table).insert(cfg.payload);const {error}=await q;if(error)throw error;
      await touchSiteUpdatedAt();
      editorDialog.close();await refreshAdmin('تم حفظ التعديل');
    }catch(err){alert('تعذر الحفظ: '+err.message)}
  });
  changePasswordForm?.addEventListener('submit',async e=>{e.preventDefault();accountPasswordMessage.textContent='';if(accountNewPassword.value!==accountNewPasswordConfirm.value){accountPasswordMessage.textContent='كلمتا المرور غير متطابقتين.';return}const {error}=await sb.auth.updateUser({password:accountNewPassword.value});if(error){accountPasswordMessage.textContent='تعذر تغيير كلمة المرور: '+error.message;return}accountPasswordMessage.classList.add('success');accountPasswordMessage.textContent='تم تغيير كلمة المرور بنجاح.';changePasswordForm.reset()});
  directorResetForm?.addEventListener('submit',async e=>{e.preventDefault();if(currentRole!=='admin')return;directorResetMessage.textContent='جارِ إرسال الرابط...';const redirectTo=siteBaseUrl()+'reset-password.html';const {error}=await sb.auth.resetPasswordForEmail(directorResetEmail.value.trim(),{redirectTo});if(error){directorResetMessage.textContent='تعذر الإرسال: '+error.message;return}directorResetMessage.classList.add('success');directorResetMessage.textContent='تم إرسال رابط استعادة آمن إلى بريد المديرة.'});
  try{await loadPublicData(true);renderAdmin()}catch(e){alert('تعذر تحميل البيانات: '+e.message)}finally{clearBusy()}
}

async function initPublic(){
  if(!document.getElementById('programGrid'))return;
  setBusy();
  try{await loadPublicData(false);renderPublic()}catch(e){console.error(e);cloudData=structuredClone(FALLBACK);renderPublic();alert('تعذر الاتصال بقاعدة البيانات مؤقتًا.')}finally{clearBusy()}
}

document.getElementById('navToggle')?.addEventListener('click',()=>{const nav=document.getElementById('navLinks');const btn=document.getElementById('navToggle');const open=nav.classList.toggle('open');btn?.setAttribute('aria-expanded',String(open));btn?.classList.toggle('is-open',open)});
document.querySelectorAll('#navLinks a').forEach(a=>a.addEventListener('click',()=>document.getElementById('navLinks')?.classList.remove('open')));

// تحسينات الاستخدام على الجوال: تثبيت الخلفية في النوافذ المنبثقة وقائمة لوحة التحكم.
const editorDialogEl=document.getElementById('editorDialog');
editorDialogEl?.addEventListener('close',()=>document.body.classList.remove('modal-open'));
editorDialogEl?.addEventListener('cancel',()=>document.body.classList.remove('modal-open'));
const adminMenuToggle=document.getElementById('adminMenuToggle');
const adminSidebar=document.getElementById('adminSidebar');
function setAdminMenu(open){
  adminSidebar?.classList.toggle('mobile-open',open);
  document.body.classList.toggle('admin-nav-open',open);
  adminMenuToggle?.classList.toggle('is-open',open);
  adminMenuToggle?.setAttribute('aria-expanded',String(open));
}
adminMenuToggle?.addEventListener('click',()=>setAdminMenu(!adminSidebar?.classList.contains('mobile-open')));
document.querySelectorAll('#adminSidebar .side-link').forEach(el=>el.addEventListener('click',()=>{if(matchMedia('(max-width:900px)').matches)setAdminMenu(false)}));
document.addEventListener('click',e=>{if(!matchMedia('(max-width:900px)').matches)return;if(!document.body.classList.contains('admin-nav-open'))return;if(adminSidebar?.contains(e.target)||adminMenuToggle?.contains(e.target))return;setAdminMenu(false)});
window.addEventListener('resize',()=>{if(!matchMedia('(max-width:900px)').matches)setAdminMenu(false)});

setupLogin();setupForgotPassword();setupResetPassword();setupAdmin();initPublic();


// ==============================
// صفحة الخطة التنفيذية لكل بند
// ==============================
async function setupExecutivePlan(){
  const page=document.getElementById('executivePlanPage');
  if(!page)return;
  setBusy('جارِ تحميل الخطة التنفيذية...');
  try{
    const {data:{session}}=await sb.auth.getSession();
    if(!session){location.replace('login.html');return}
    const {data:profile,error:profileError}=await sb.from('profiles').select('full_name,role').eq('id',session.user.id).single();
    if(profileError||!profile){await sb.auth.signOut();location.replace('login.html');return}
    currentProfile=profile;currentRole=profile.role;
    document.body.classList.toggle('viewer',currentRole!=='admin');
    document.querySelectorAll('.exec-admin-only').forEach(el=>{el.hidden=currentRole!=='admin'});

    const planId=new URLSearchParams(location.search).get('plan_id');
    if(!planId)throw new Error('لم يتم تحديد بند الخطة.');
    const {data:plan,error:planError}=await sb.from('plan_items').select('id,title,date_from,date_to,status,progress').eq('id',planId).single();
    if(planError)throw planError;
    document.getElementById('execPlanTitle').textContent=`الخطة التنفيذية: ${plan.title}`;
    document.getElementById('execPlanMeta').innerHTML=`<span>${esc(plan.date_from||'')}</span>${plan.date_to?`<span>إلى ${esc(plan.date_to)}</span>`:''}<span class="status-pill">${esc(plan.status||'')}</span><span>${Number(plan.progress||0)}%</span>`;

    const rowsWrap=document.getElementById('execRows');
    const renderRows=async()=>{
      const {data,error}=await sb.from('executive_plan_steps').select('*').eq('plan_item_id',planId).order('sort_order').order('created_at');
      if(error)throw error;
      const rows=data||[];
      if(currentRole==='admin'){
        rowsWrap.innerHTML=rows.map((r,i)=>`<tr data-id="${r.id}">
          <td class="exec-num" data-label="رقم">${i+1}</td>
          <td data-label="الإجراءات"><div class="exec-row-tools"><textarea class="exec-procedure" rows="2" placeholder="اكتبي الإجراء">${esc(r.procedure_text||'')}</textarea><button type="button" class="exec-delete-mini exec-delete" data-id="${r.id}" title="حذف الصف" aria-label="حذف الصف">×</button></div></td>
          <td class="exec-check" data-label="نعم"><input class="exec-choice" type="checkbox" data-choice="yes" ${r.executed===true?'checked':''} aria-label="نعم"></td>
          <td class="exec-check" data-label="لا"><input class="exec-choice" type="checkbox" data-choice="no" ${r.executed===false?'checked':''} aria-label="لا"></td>
          <td data-label="السبب"><textarea class="exec-reason" rows="2" placeholder="اكتبي السبب عند الحاجة">${esc(r.reason||'')}</textarea></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty-state">لم تتم إضافة إجراءات بعد. استخدمي زر «إضافة صف».</td></tr>';
      }else{
        rowsWrap.innerHTML=rows.map((r,i)=>`<tr>
          <td class="exec-num" data-label="رقم">${i+1}</td>
          <td data-label="الإجراءات">${esc(r.procedure_text||'—')}</td>
          <td class="exec-check exec-view-mark" data-label="نعم">${r.executed===true?'✓':'—'}</td>
          <td class="exec-check exec-view-mark" data-label="لا">${r.executed===false?'✓':'—'}</td>
          <td data-label="السبب">${esc(r.reason||'—')}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty-state">لم تتم إضافة إجراءات للخطة التنفيذية بعد.</td></tr>';
      }
    };

    await renderRows();

    document.getElementById('execAddRow')?.addEventListener('click',async()=>{
      if(currentRole!=='admin')return;
      const {data:last}=await sb.from('executive_plan_steps').select('sort_order').eq('plan_item_id',planId).order('sort_order',{ascending:false}).limit(1).maybeSingle();
      const {error}=await sb.from('executive_plan_steps').insert({plan_item_id:planId,procedure_text:'',executed:null,reason:'',sort_order:(last?.sort_order??-1)+1});
      if(error){alert('تعذر إضافة الصف: '+error.message);return}
      await renderRows();
    });

    rowsWrap.addEventListener('change',e=>{
      const box=e.target.closest('.exec-choice');
      if(!box||!box.checked)return;
      const tr=box.closest('tr');
      tr?.querySelectorAll('.exec-choice').forEach(other=>{if(other!==box)other.checked=false});
    });

    document.getElementById('execSave')?.addEventListener('click',async()=>{
      if(currentRole!=='admin')return;
      const rows=[...rowsWrap.querySelectorAll('tr[data-id]')];
      try{
        showCloudStatus('جارِ حفظ الخطة التنفيذية...');
        for(let i=0;i<rows.length;i++){
          const tr=rows[i],id=tr.dataset.id;
          const yes=tr.querySelector('input[data-choice="yes"]')?.checked;
          const no=tr.querySelector('input[data-choice="no"]')?.checked;
          const executed=yes?true:no?false:null;
          const payload={procedure_text:tr.querySelector('.exec-procedure').value.trim(),executed,reason:tr.querySelector('.exec-reason').value.trim(),sort_order:i};
          const {error}=await sb.from('executive_plan_steps').update(payload).eq('id',id);
          if(error)throw error;
        }
        await touchSiteUpdatedAt();
        showCloudStatus('تم حفظ الخطة التنفيذية');
        await renderRows();
      }catch(err){alert('تعذر الحفظ: '+err.message)}
    });

    rowsWrap.addEventListener('click',async e=>{
      const btn=e.target.closest('.exec-delete');
      if(!btn||currentRole!=='admin')return;
      if(!confirm('حذف هذا الإجراء؟'))return;
      const {error}=await sb.from('executive_plan_steps').delete().eq('id',btn.dataset.id);
      if(error){alert('تعذر الحذف: '+error.message);return}
      await renderRows();
    });
  }catch(err){
    document.getElementById('execPlanError').textContent='تعذر تحميل الخطة التنفيذية: '+err.message;
    document.getElementById('execPlanError').hidden=false;
  }finally{clearBusy()}
}

setupExecutivePlan();
