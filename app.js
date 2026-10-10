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
  message:'تمكين الموهوبات من اكتشاف قدراتهن وتنميتها عبر فرص نوعية وتجارب تعليمية محفزة.',
  values:'الإبداع • التمكين • المبادرة • المسؤولية • التميز',
  heroImage:'',
  basic:{
    school:'الثانوية الأولى بينبع البحر',coordinator:'أبرار الهنيدي',principal:'هدى البهيجي',semester:'الفصل الدراسي الأول 1448هـ',assignment:'',
    assignmentFilePath:'',assignmentFileName:'',assignmentFileType:'',assignmentFileUrl:''
  },
  stats:{programs:0,registered:0,participants:0,gifted:0},
  programs:[],opportunities:[],achievements:[],links:[],plan:[],execSteps:[]
};
let cloudData = structuredClone(FALLBACK);
let currentRole = 'viewer';
let currentProfile = null;
let editContext = null;
let removeAssignmentRequested = false;
let currentProgramFilter = 'active';

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
    message:s.message||FALLBACK.message,
    values:s.values_text||FALLBACK.values,
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
    stats:{programs:st.programs_count??0,registered:st.registered_count??0,participants:st.participants_count??0,gifted:st.gifted_count??0,programsAuto:st.programs_auto!==false,registeredAuto:st.registered_auto!==false},statsId:st.id||null,
    programs:(programsRes.data||[]).map(p=>({id:p.id,title:p.title,desc:p.description||'',date:p.program_date||'',status:p.status||'',url:p.external_url||'',coverImage:p.cover_image_url||'',published:p.is_published,sort:p.sort_order,archived:!!p.archived})),
    opportunities:(oppsRes.data||[]).map(o=>({id:o.id,title:o.title,date:o.opportunity_date||'',registrationEnd:o.registration_end_date||o.opportunity_date||'',url:o.external_url||'',published:o.is_published,sort:o.sort_order,planItemId:o.plan_item_id||''})),
    achievements:(achRes.data||[]).map(a=>({id:a.id,title:a.title,note:a.description||'',image:a.image_url||'',evidence:a.evidence_url||'',published:a.is_published,sort:a.sort_order})),
    links:(linksRes.data||[]).map(l=>({id:l.id,title:l.title,url:l.url,published:l.is_published,sort:l.sort_order})),plan:[]
  };
  if(includePlan){
    const {data,error}=await sb.from('plan_items').select('*').order('sort_order').order('created_at');
    if(error) throw error;
    cloudData.plan=(data||[]).map(p=>({
      id:p.id,title:p.title,date:p.plan_date||'',dateFrom:p.date_from||p.plan_date||'',dateTo:p.date_to||'',status:p.status||'',progress:p.progress||0,notes:p.notes||'',sort:p.sort_order,
      registeredCount:p.registered_count,updatedAt:p.updated_at||'',reportPath:p.report_pdf_path||'',reportName:p.report_file_name||'',reportUrl:''
    }));
    const {data:stepsData,error:stepsError}=await sb.from('executive_plan_steps').select('id,plan_item_id,procedure_text,phase_timing,phase_date,responsible,evidence_options,completion_percent,executed,reason,updated_at,sort_order').order('sort_order');
    if(stepsError) throw stepsError;
    cloudData.execSteps=(stepsData||[]).map(s=>({id:s.id,planItemId:s.plan_item_id,procedure:s.procedure_text||'',phase:s.phase_timing||'',phaseDate:s.phase_date||'',responsible:s.responsible||'',evidence:Array.isArray(s.evidence_options)?s.evidence_options:[],completion:s.completion_percent,executed:s.executed,reason:s.reason||'',updatedAt:s.updated_at||'',sort:s.sort_order}));
    cloudData.basic.assignmentFileUrl=await privateFileUrl(cloudData.basic.assignmentFilePath);
    await Promise.all(cloudData.plan.map(async p=>{p.reportUrl=await privateFileUrl(p.reportPath)}));
  }
  return cloudData;
}

function statusClass(status=''){
  const x=String(status).trim();
  if(/منتهي|انتهى|مغلق/.test(x)) return 'status-ended';
  if(/قريب|قادم/.test(x)) return 'status-soon';
  if(/مفتوح|منشور|متاح|الآن/.test(x)) return 'status-open';
  return 'status-neutral';
}
function formatLastUpdated(value){
  if(!value) return '';
  try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}catch(e){return ''}
}

function normalizeDigits(v=''){return String(v).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))}
const AR_MONTHS={
  'يناير':1,'فبراير':2,'مارس':3,'أبريل':4,'ابريل':4,'مايو':5,'يونيو':6,'يوليو':7,'أغسطس':8,'اغسطس':8,'سبتمبر':9,'أكتوبر':10,'اكتوبر':10,'نوفمبر':11,'ديسمبر':12
};
function dateTuple(value=''){
  const s=normalizeDigits(value).replace(/هـ|ه/g,'').replace(/،/g,' ').trim();
  let all=[...s.matchAll(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{4})/g)];
  if(all.length){const m=all[all.length-1];return {d:+m[1],m:+m[2],y:+m[3]}}
  all=[...s.matchAll(/(\d{4})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})/g)];
  if(all.length){const m=all[all.length-1];return {d:+m[3],m:+m[2],y:+m[1]}}
  const monthExpr=[...s.matchAll(/(\d{1,2})\s+([\u0600-\u06FF]+)(?:\s+(\d{4}))?/g)].filter(m=>AR_MONTHS[m[2]]);
  if(monthExpr.length){const m=monthExpr[monthExpr.length-1];let y=m[3]?+m[3]:null;if(!y){const ym=s.match(/(\d{4})(?!.*\d)/);y=ym?+ym[1]:null}if(y)return {d:+m[1],m:AR_MONTHS[m[2]],y}}
  return null;
}
function todayTupleForYear(y){
  if(y<1700){
    const parts=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',{year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date());
    const g=t=>+parts.find(x=>x.type===t)?.value;
    return {d:g('day'),m:g('month'),y:g('year')};
  }
  const n=new Date();return {d:n.getDate(),m:n.getMonth()+1,y:n.getFullYear()};
}
function tupleCompare(a,b){return a.y-b.y||a.m-b.m||a.d-b.d}
function isExpiredDate(value){
  const t=dateTuple(value);if(!t)return false;
  return tupleCompare(t,todayTupleForYear(t.y))<0;
}
function daysUntilDate(value){const t=dateTuple(value);if(!t||t.y<1700)return null;const target=Date.UTC(t.y,t.m-1,t.d),now=new Date(),today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());return Math.round((target-today)/86400000)}
function attentionState(p){const days=daysUntilDate(p.dateTo||p.dateFrom||p.date);const progress=Number(p.progress)||0;if(days===null)return '';if(days<0&&progress<90)return 'متأخر ويحتاج استكمال';if(days<=14&&days>=0&&progress<50)return 'موعد قريب — يحتاج متابعة';return ''}
function progressTone(v){v=Number(v)||0;return v>=90?'progress-green':v>=50?'progress-yellow':'progress-red'}
function progressMeter(v,label=true){
  v=Math.max(0,Math.min(100,Number(v)||0));
  return `<div class="progress-meter ${progressTone(v)}"><div class="progress-meter-head">${label?`<strong>${v}%</strong>`:''}${v<50?'<span>يحتاج استكمال</span>':''}</div><div class="progress-track"><span style="width:${v}%"></span></div></div>`;
}
function planSteps(planId){return (cloudData.execSteps||[]).filter(s=>String(s.planItemId)===String(planId))}
function planHasEvidence(planId){const xs=planSteps(planId);return xs.length>0&&xs.some(s=>s.evidence?.length)}
function planCompleteness(p){
  const steps=planSteps(p.id);
  const ok=steps.length>0 && steps.every(s=>String(s.procedure||'').trim()&&String(s.phase||'').trim()&&String(s.responsible||'').trim()&&Array.isArray(s.evidence)&&s.evidence.length&&s.completion!==null&&s.completion!==undefined) && p.registeredCount!==null && p.registeredCount!==undefined && !!p.reportPath;
  return ok?'مكتمل البيانات':'يحتاج استكمال';
}

function renderPublic(){
  if(!document.getElementById('programGrid')) return;
  const d=cloudData;
  heroTitle.textContent=d.heroTitle;heroText.textContent=d.heroText;
  if(document.getElementById('visionText')) visionText.textContent=d.vision;
  if(document.getElementById('messageText')) messageText.textContent=d.message||FALLBACK.message;
  if(document.getElementById('valuesText')){const vals=String(d.values||FALLBACK.values).split(/[•،,|\n]/).map(x=>x.trim()).filter(Boolean);valuesText.innerHTML=vals.map(v=>`<span>${esc(v)}</span>`).join('')}
  footerCoordinator.textContent=`منسقة الموهوبات: ${d.basic.coordinator}`;
  footerPrincipal.textContent=`مديرة المدرسة: ${d.basic.principal}`;
  if(document.getElementById('footerLastUpdated')) footerLastUpdated.textContent=d.updatedAt?`آخر تحديث: ${formatLastUpdated(d.updatedAt)}`:'';
  const hm=document.getElementById('heroMedia');
  const heroBg=d.heroImage?publicMediaUrl(d.heroImage):'assets/hero-gifted-future.png?v=11.0.0';
  hm.style.backgroundImage=`linear-gradient(180deg,rgba(17,59,106,.02),rgba(17,59,106,.06)),url('${esc(heroBg)}')`;
  stats.innerHTML=[['البرامج المنفذة',d.stats.programs],['المسجلات',d.stats.registered],['المشاركات',d.stats.participants],['الموهوبات',d.stats.gifted]].map((x,i)=>`<div class="stat"><span class="stat-index">${String(i+1).padStart(2,'0')}</span><div class="stat-copy"><b>${esc(x[1])}</b><span>${esc(x[0])}</span></div></div>`).join('');
  const availableOpps=(d.opportunities||[]).filter(o=>!isExpiredDate(o.registrationEnd||o.date)).sort((a,b)=>{const ta=dateTuple(a.registrationEnd||a.date),tb=dateTuple(b.registrationEnd||b.date);if(!ta&&!tb)return 0;if(!ta)return 1;if(!tb)return -1;return tupleCompare(ta,tb)});
  const next=availableOpps[0];
  const nextSec=document.getElementById('nextOpportunitySection');
  if(next&&nextSec){nextSec.hidden=false;nextOpportunityTitle.textContent=next.title;nextOpportunityDate.textContent=next.registrationEnd?`التسجيل متاح حتى ${next.registrationEnd}`:(next.date||'');if(next.url){nextOpportunityLink.href=next.url;nextOpportunityLink.hidden=false}else nextOpportunityLink.hidden=true}else if(nextSec) nextSec.hidden=true;

  const activePrograms=d.programs.filter(p=>!p.archived);
  programGrid.className=`program-grid program-count-${Math.min(activePrograms.length,6)}`;
  programGrid.innerHTML=activePrograms.map((p,i)=>{
    const img=publicMediaUrl(p.coverImage);
    return `<article class="program-card">
      <div class="program-cover clear-cover">${img?`<img src="${esc(img)}" alt="${esc(p.title)}">`:`<div class="program-cover-placeholder"></div>`}<div class="program-no">${String(i+1).padStart(2,'0')}</div></div>
      <div class="program-body"><span class="tag ${statusClass(p.status)}">${esc(p.status||'متاح')}</span><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p><small>${esc(p.date)}</small><div style="margin-top:13px">${p.url?`<a class="btn secondary" target="_blank" rel="noopener" href="${esc(p.url)}">التفاصيل والرابط</a>`:''}</div></div>
    </article>`}).join('')||'<div class="card padded">لا توجد برامج منشورة حاليًا.</div>';

  opportunityList.innerHTML=availableOpps.map((o,i)=>`<div class="list-item clean-list"><span class="item-index">${String(i+1).padStart(2,'0')}</span><div style="flex:1"><strong>${esc(o.title)}</strong><div class="opportunity-date">${esc(o.registrationEnd?`التسجيل حتى ${o.registrationEnd}`:o.date)}</div>${o.url?`<div class="hint"><a class="inline-link" target="_blank" rel="noopener" href="${esc(o.url)}">فتح الرابط</a></div>`:''}</div></div>`).join('')||'<div class="list-item">لا توجد فرص متاحة حاليًا.</div>';

  const achievementCards=d.achievements.map((a,i)=>{const img=publicMediaUrl(a.image);return `<article class="achievement achievement-celebrate">${img?`<div class="achievement-image" style="background-image:url('${esc(img)}')"></div>`:''}<div class="achievement-content"><span class="achievement-star" aria-hidden="true">★</span><span class="achievement-no">${String(i+1).padStart(2,'0')}</span><h3>${esc(a.title)}</h3><p>${esc(a.note)}</p>${a.evidence?`<a class="achievement-link" href="${esc(a.evidence)}" target="_blank" rel="noopener">عرض الشاهد</a>`:''}</div></article>`}).join('');
  achievementGrid.innerHTML=achievementCards||'<div class="achievement"><h3>قريبًا</h3><p>ستظهر الإنجازات هنا بعد إضافتها.</p></div>';
  const ticker=document.getElementById('achievementsTicker');
  if(ticker){if(d.achievements.length){const items=d.achievements.map(a=>`<span class="ticker-item"><span class="ticker-star">★</span>${esc(a.title)}</span>`).join('');ticker.innerHTML=`<div class="ticker-track">${items}${items}</div>`;ticker.hidden=false}else{ticker.hidden=true;ticker.innerHTML=''}}
  importantLinks.innerHTML=d.links.map((l,i)=>`<a class="important-link" target="_blank" rel="noopener" href="${esc(l.url)}"><span class="item-index">${String(i+1).padStart(2,'0')}</span><span class="link-title"><strong>${esc(l.title)}</strong><small>فتح الرابط</small></span><span class="link-arrow">‹</span></a>`).join('')||'<div class="important-link">لا توجد روابط مضافة.</div>';
}

function table(headers,rows){return `<div class="responsive-table-wrap"><table class="responsive-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td data-label="${esc(headers[i]||'')}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function actions(type,id){
  if(currentRole!=='admin')return 'مشاهدة فقط';
  if(type==='programs'){
    const item=cloudData.programs.find(x=>String(x.id)===String(id));
    return `<button class="action-btn row-edit edit-only" onclick="openEdit('${type}','${id}')">تعديل</button>${item?.archived?`<button class="action-btn edit-only" onclick="restoreProgram('${id}')">استعادة</button>`:`<button class="action-btn danger row-delete edit-only" onclick="removeItem('${type}','${id}')">أرشفة</button>`}`;
  }
  return `<button class="action-btn row-edit edit-only" onclick="openEdit('${type}','${id}')">تعديل</button><button class="action-btn danger row-delete edit-only" onclick="removeItem('${type}','${id}')">حذف</button>`;
}
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
  const rows=cloudData.plan.filter(p=>{
    if(currentPlanFilter==='all')return true;
    if(['مكتمل','جار التنفيذ','لم يبدأ'].includes(currentPlanFilter))return p.status===currentPlanFilter;
    if(currentPlanFilter==='low')return Number(p.progress)<50;
    if(currentPlanFilter==='no-report')return !p.reportPath;
    if(currentPlanFilter==='no-evidence')return !planHasEvidence(p.id);
    if(currentPlanFilter==='no-registered')return p.registeredCount===null||p.registeredCount===undefined||p.registeredCount==='';
    if(currentPlanFilter==='needs-completion')return planCompleteness(p)==='يحتاج استكمال';
    return true;
  });
  wrap.innerHTML=table(['البند','الفترة','المسجلات','الحالة','الإنجاز','اكتمال البيانات','التقرير','الخطة التنفيذية','إجراءات'],rows.map(p=>[
    esc(p.title),dateRangeHtml(p),p.registeredCount??'—',`<span class="status-pill">${esc(p.status)}</span>`,progressMeter(p.progress),
    `<span class="completeness ${planCompleteness(p)==='مكتمل البيانات'?'complete':'incomplete'}">${planCompleteness(p)}</span><small class="last-update">آخر تحديث: ${esc(formatLastUpdated(p.updatedAt)||'—')}</small>`,
    reportButton(p),`<a class="action-btn executive-plan-link" href="executive-plan.html?plan_id=${encodeURIComponent(p.id)}">فتح الخطة</a>`,actions('plan',p.id)
  ]));
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
  dashboardStats.innerHTML=[['نسبة تنفيذ الخطة',avg+'%'],['مكتملة 90–100%',d.plan.filter(x=>x.progress>=90).length],['تحتاج استكمال',d.plan.filter(x=>planCompleteness(x)==='يحتاج استكمال').length],['إجمالي المسجلات',d.plan.reduce((s,x)=>s+(Number(x.registeredCount)||0),0)]].map((x,i)=>`<div class="stat"><span class="stat-index">${String(i+1).padStart(2,'0')}</span><div class="stat-copy"><b>${esc(x[1])}</b><span>${esc(x[0])}</span></div></div>`).join('');
  overallProgress.textContent=avg+'%';progressBar.style.width=avg+'%';
  planMiniList.innerHTML=d.plan.map(p=>{const alert=attentionState(p);return `<div class="list-item"><div><strong>${esc(p.title)}</strong><div class="hint">${esc(p.dateFrom||p.date||'')} ${p.dateTo?`— ${esc(p.dateTo)}`:''}</div>${alert?`<span class="attention-badge">${esc(alert)}</span>`:''}</div><div class="mini-progress">${progressMeter(p.progress,false)}<strong>${p.progress}%</strong></div></div>`}).join('')||'<div class="list-item">لم تتم إضافة بنود للخطة بعد.</div>';
  followupList.innerHTML=d.plan.map(p=>`<div class="list-item"><div><strong>${esc(p.title)}</strong><div style="color:#64748b;margin-top:5px">${esc(p.status)} • ${esc(p.dateFrom||p.date||'')} ${p.dateTo?`إلى ${esc(p.dateTo)}`:''}</div>${p.notes?`<div class="hint">${esc(p.notes)}</div>`:''}<div class="followup-report">${reportButton(p)}</div></div><div class="followup-progress">${progressMeter(p.progress)}</div></div>`).join('');
  renderPlanTable();
  if(document.getElementById('programArchiveFilter'))programArchiveFilter.value=currentProgramFilter;
  const shownPrograms=d.programs.filter(p=>currentProgramFilter==='all'||(currentProgramFilter==='archived'?p.archived:!p.archived));programTableWrap.innerHTML=table(['البرنامج / الإعلان','التاريخ','الحالة','الأرشيف','الخلفية','إجراءات'],shownPrograms.map(p=>[esc(p.title),esc(p.date),esc(p.status),p.archived?'<span class="tag status-ended">مؤرشف</span>':'<span class="tag status-open">نشط</span>',p.coverImage?'مضافة':'افتراضية',actions('programs',p.id)]));
  opportunitiesTableWrap.innerHTML=table(['الفرصة / المسابقة','نهاية التسجيل','الحالة','الرابط','إجراءات'],d.opportunities.map(o=>[esc(o.title),esc(o.registrationEnd||o.date),isExpiredDate(o.registrationEnd||o.date)?'<span class="tag status-ended">انتهى التسجيل</span>':'<span class="tag status-open">متاح</span>',o.url?`<a class="inline-link" target="_blank" href="${esc(o.url)}">فتح</a>`:'—',actions('opportunities',o.id)]));
  achievementTableWrap.innerHTML=table(['الإنجاز','ملاحظة','إجراءات'],d.achievements.map(a=>[esc(a.title),esc(a.note),actions('achievements',a.id)]));
  linksTableWrap.innerHTML=table(['العنوان','الرابط','إجراءات'],d.links.map(l=>[esc(l.title),`<a class="inline-link" target="_blank" href="${esc(l.url)}">فتح الرابط</a>`,actions('links',l.id)]));
  fHeroTitle.value=d.heroTitle;fHeroText.value=d.heroText;fVision.value=d.vision;if(document.getElementById('fMessage'))document.getElementById('fMessage').value=d.message||'';if(document.getElementById('fValues'))document.getElementById('fValues').value=d.values||'';fHeroImageUrl.value=d.heroImage||'';setPreview(heroPreview,publicMediaUrl(d.heroImage));
  fSchool.value=d.basic.school;fCoordinator.value=d.basic.coordinator;fPrincipal.value=d.basic.principal;fSemester.value=d.basic.semester;fAssignment.value=d.basic.assignment;
  sPrograms.value=d.stats.programs;sRegistered.value=d.stats.registered;sParticipants.value=d.stats.participants;sGifted.value=d.stats.gifted;if(document.getElementById('sProgramsAuto')){sProgramsAuto.checked=d.stats.programsAuto!==false;sPrograms.disabled=sProgramsAuto.checked}if(document.getElementById('sRegisteredAuto')){sRegisteredAuto.checked=d.stats.registeredAuto!==false;sRegistered.disabled=sRegisteredAuto.checked}
  renderBasicSummary();
  renderAssignmentUploadPreview();
  statsViewer.innerHTML=`<h3 class="viewer-card-title">الإحصائيات الحالية</h3><div class="stats-viewer-grid"><div class="info-tile"><small>البرامج المنفذة</small><strong>${d.stats.programs}</strong></div><div class="info-tile"><small>المسجلات</small><strong>${d.stats.registered}</strong></div><div class="info-tile"><small>المشاركات</small><strong>${d.stats.participants}</strong></div><div class="info-tile"><small>الموهوبات</small><strong>${d.stats.gifted}</strong></div></div>`;
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
  if(type==='plan')return `<div class="dialog-fields-grid"><label class="full">اسم البند<input name="title" value="${esc(item.title||'')}"></label><label>التاريخ من<input name="dateFrom" value="${esc(item.dateFrom||item.date||'')}" placeholder="مثال: 5 أكتوبر 2026"></label><label>التاريخ إلى<input name="dateTo" value="${esc(item.dateTo||'')}" placeholder="مثال: 20 أكتوبر 2026"></label><label>الحالة<input name="status" value="${esc(item.status||'')}"></label><label>عدد المسجلات<input name="registeredCount" type="number" min="0" value="${item.registeredCount??''}" placeholder="اتركيه فارغًا حتى يتوفر العدد"></label><label>نسبة الإنجاز المحسوبة<input name="progressDisplay" value="${esc(item.progress??0)}%" readonly></label><label class="full">ملاحظات<textarea name="notes" rows="3">${esc(item.notes||'')}</textarea></label><label class="full">تقرير البند PDF<span class="file-pick">اختيار ملف PDF<input name="reportFile" type="file" accept="application/pdf"></span><div class="hint">الحد الأقصى 50MB. ${item.reportPath?`يوجد تقرير حالي: ${esc(item.reportName||'تقرير.pdf')}`:'لا يوجد تقرير مرفوع حاليًا.'}</div></label>${item.reportPath?`<label class="checkbox-row"><input name="removeReport" type="checkbox" value="1"> إزالة التقرير الحالي عند الحفظ</label>`:''}</div>`;
  if(type==='programs')return `<div class="dialog-fields-grid"><label class="full">اسم البرنامج / الإعلان<input name="title" value="${esc(item.title||'')}"></label><label>التاريخ<input name="date" value="${esc(item.date||'')}"></label><label>الحالة<input name="status" value="${esc(item.status||'')}"></label><label class="full">الوصف<textarea name="desc" rows="4">${esc(item.desc||'')}</textarea></label><label class="full">الرابط<input name="url" type="url" value="${esc(item.url||'')}"></label><label class="full">رابط صورة / خلفية<input name="coverImage" value="${esc(item.coverImage||'')}"></label><label class="full">أو ارفعي صورة من الجهاز<span class="file-pick">اختيار صورة<input type="file" accept="image/*" data-upload="program"></span></label><div class="preview-box full ${item.coverImage?'has-image':''}"><img id="dialogImagePreview" ${item.coverImage?`src="${esc(publicMediaUrl(item.coverImage))}"`:''} alt="معاينة"></div></div>`;
  if(type==='opportunities'){const opts=['<option value="">بدون ربط — أدخلي نهاية التسجيل يدويًا</option>',...cloudData.plan.map(p=>`<option value="${p.id}" ${String(item.planItemId||'')===String(p.id)?'selected':''}>${esc(p.title)} — ${esc(p.dateTo||p.dateFrom||p.date||'')}</option>`)].join('');return `<div class="dialog-fields-grid"><label class="full">اسم الفرصة / المسابقة<input name="title" value="${esc(item.title||'')}"></label><label class="full">ربط ببند من الخطة الفصلية<select name="planItemId">${opts}</select><small class="hint">عند الربط تُستخدم نهاية فترة البند كنهاية للتسجيل، وتتحدث تلقائيًا إذا تغيرت الخطة.</small></label><label>نهاية التسجيل<input name="registrationEnd" value="${esc(item.registrationEnd||item.date||'')}" placeholder="مثال: 5 أكتوبر 2026"></label><label>الرابط<input name="url" type="url" value="${esc(item.url||'')}"></label></div>`;}
  if(type==='achievements')return `<div class="dialog-fields-grid"><label class="full">عنوان الإنجاز<input name="title" value="${esc(item.title||'')}"></label><label class="full">ملاحظة / وصف<textarea name="note" rows="4">${esc(item.note||'')}</textarea></label><label class="full">رابط الشاهد<input name="evidence" type="url" value="${esc(item.evidence||'')}"></label><label class="full">صورة الإنجاز<input name="achievementImage" value="${esc(item.image||'')}" placeholder="رابط صورة أو ارفعي صورة من الجهاز"></label><label class="full"><span class="file-pick">اختيار صورة<input type="file" accept="image/*" data-upload="achievement" data-target="achievementImage"></span></label><div class="preview-box full ${item.image?'has-image':''}"><img id="dialogAchievementPreview" ${item.image?`src="${esc(publicMediaUrl(item.image))}"`:''} alt="معاينة الإنجاز"></div></div>`;
  return `<div class="dialog-fields-grid"><label class="full">اسم الرابط<input name="title" value="${esc(item.title||'')}"></label><label class="full">الرابط<input name="url" type="url" value="${esc(item.url||'')}"></label></div>`;
}
function openDialog(type,item=null){if(currentRole!=='admin')return;editContext={type,id:item?.id||null,oldReportPath:item?.reportPath||''};dialogTitle.textContent=item?'تعديل':'إضافة';dialogFields.innerHTML=dialogContent(type,item||{});document.body.classList.add('modal-open');editorDialog.showModal();requestAnimationFrame(()=>editorDialog.querySelector('input,textarea,select')?.focus({preventScroll:true}))}
window.openEdit=(type,id)=>{const item=cloudData[type].find(x=>String(x.id)===String(id));openDialog(type,item)};
async function removeItem(type,id){
  if(currentRole!=='admin')return;
  const map={plan:'plan_items',programs:'programs',opportunities:'opportunities',achievements:'achievements',links:'important_links'};
  const item=cloudData[type].find(x=>String(x.id)===String(id));
  if(type==='programs'){
    if(!confirm('أرشفة هذا البرنامج؟ سيختفي من واجهة الزوار ويمكن استعادته لاحقًا.'))return;
    const {error}=await sb.from('programs').update({archived:true}).eq('id',id);if(error)return alert(error.message);
    await touchSiteUpdatedAt();await refreshAdmin('تمت أرشفة البرنامج');return;
  }
  if(!confirm('هل تريدين حذف هذا العنصر؟'))return;
  const {error}=await sb.from(map[type]).delete().eq('id',id);if(error)return alert(error.message);
  if(type==='plan'&&item?.reportPath) await deletePrivateFile(item.reportPath);
  await touchSiteUpdatedAt();await refreshAdmin('تم الحذف');
}
window.removeItem=removeItem;
window.restoreProgram=async id=>{if(currentRole!=='admin')return;const {error}=await sb.from('programs').update({archived:false}).eq('id',id);if(error)return alert(error.message);await touchSiteUpdatedAt();await refreshAdmin('تمت استعادة البرنامج')};
async function refreshAdmin(msg=''){await loadPublicData(true);renderAdmin();if(msg)showCloudStatus(msg)}

async function saveSimple(type){
  if(currentRole!=='admin')return;
  try{
    if(type==='intro'){
      let image=fHeroImageUrl.value.trim();
      if(fHeroImageFile?.files?.[0]){showCloudStatus('جارِ رفع الصورة...');image=await uploadPublicImage(fHeroImageFile.files[0],'hero')}
      const payload={hero_title:fHeroTitle.value.trim(),hero_text:fHeroText.value.trim(),vision:fVision.value.trim(),message:document.getElementById('fMessage')?.value?.trim()||'',values_text:document.getElementById('fValues')?.value?.trim()||'',hero_image_url:image,updated_at:new Date().toISOString()};
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
      const programsAuto=document.getElementById('sProgramsAuto')?.checked!==false,registeredAuto=document.getElementById('sRegisteredAuto')?.checked!==false;const autoPrograms=cloudData.plan.filter(x=>Number(x.progress)>=90).length,autoRegistered=cloudData.plan.reduce((sum,x)=>sum+(Number(x.registeredCount)||0),0);const payload={programs_count:programsAuto?autoPrograms:(+sPrograms.value||0),registered_count:registeredAuto?autoRegistered:(+sRegistered.value||0),participants_count:+sParticipants.value||0,gifted_count:+sGifted.value||0,programs_auto:programsAuto,registered_auto:registeredAuto,updated_at:new Date().toISOString()};
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
  document.getElementById('programArchiveFilter')?.addEventListener('change',e=>{currentProgramFilter=e.target.value;renderAdmin()});
  document.getElementById('sProgramsAuto')?.addEventListener('change',e=>{sPrograms.disabled=e.target.checked;if(e.target.checked)sPrograms.value=cloudData.plan.filter(x=>Number(x.progress)>=90).length});
  document.getElementById('sRegisteredAuto')?.addEventListener('change',e=>{sRegistered.disabled=e.target.checked;if(e.target.checked)sRegistered.value=cloudData.plan.reduce((sum,x)=>sum+(Number(x.registeredCount)||0),0)});
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
        cfg={table:'plan_items',payload:{title:o.title,plan_date:o.dateFrom||'',date_from:o.dateFrom||'',date_to:o.dateTo||'',status:o.status||'',registered_count:o.registeredCount===''?null:Math.max(0,+o.registeredCount||0),notes:o.notes||'',report_pdf_path:reportPath||null,report_file_name:reportName||null,updated_at:new Date().toISOString()}};
      }else if(editContext.type==='programs') cfg={table:'programs',payload:{title:o.title,description:o.desc||'',program_date:o.date||'',status:o.status||'',external_url:o.url||null,cover_image_url:o.coverImage||null,is_published:true}};
      else if(editContext.type==='opportunities'){const linked=cloudData.plan.find(p=>String(p.id)===String(o.planItemId));const end=o.planItemId?(linked?.dateTo||linked?.dateFrom||linked?.date||''):(o.registrationEnd||'');cfg={table:'opportunities',payload:{title:o.title,plan_item_id:o.planItemId||null,opportunity_date:end,registration_end_date:end,external_url:o.url||null,is_published:true}};}
      else if(editContext.type==='achievements') cfg={table:'achievements',payload:{title:o.title,description:o.note||'',image_url:o.achievementImage||null,evidence_url:o.evidence||null,is_published:true}};
      else cfg={table:'important_links',payload:{title:o.title,url:o.url,is_published:true}};
      const q=editContext.id?sb.from(cfg.table).update(cfg.payload).eq('id',editContext.id):sb.from(cfg.table).insert(cfg.payload);const {error}=await q;if(error)throw error;
      await touchSiteUpdatedAt();
      editorDialog.close();await refreshAdmin('تم حفظ التعديل');
    }catch(err){alert('تعذر الحفظ: '+err.message)}
  });
  changePasswordForm?.addEventListener('submit',async e=>{e.preventDefault();accountPasswordMessage.textContent='';if(accountNewPassword.value!==accountNewPasswordConfirm.value){accountPasswordMessage.textContent='كلمتا المرور غير متطابقتين.';return}const {error}=await sb.auth.updateUser({password:accountNewPassword.value});if(error){accountPasswordMessage.textContent='تعذر تغيير كلمة المرور: '+error.message;return}accountPasswordMessage.classList.add('success');accountPasswordMessage.textContent='تم تغيير كلمة المرور بنجاح.';changePasswordForm.reset()});
  directorResetForm?.addEventListener('submit',async e=>{e.preventDefault();if(currentRole!=='admin')return;directorResetMessage.textContent='جارِ إرسال الرابط...';const redirectTo=siteBaseUrl()+'reset-password.html';const {error}=await sb.auth.resetPasswordForEmail(directorResetEmail.value.trim(),{redirectTo});if(error){directorResetMessage.textContent='تعذر الإرسال: '+error.message;return}directorResetMessage.classList.add('success');directorResetMessage.textContent='تم إرسال رابط استعادة آمن إلى بريد المديرة.'});
  try{await loadPublicData(true);renderAdmin();if(location.hash==='#plan'){const btn=document.querySelector('.side-link[data-section="plan"]');btn?.click();setTimeout(()=>document.getElementById('planTableWrap')?.scrollIntoView({behavior:'smooth',block:'start'}),80)}}catch(e){alert('تعذر تحميل البيانات: '+e.message)}finally{clearBusy()}
}

async function initPublic(){
  if(!document.getElementById('programGrid'))return;
  setBusy();
  try{await loadPublicData(false);renderPublic()}catch(e){console.error(e);cloudData=structuredClone(FALLBACK);renderPublic();alert('تعذر الاتصال بقاعدة البيانات مؤقتًا.')}finally{clearBusy()}
}

function setPublicNav(open){
  const nav=document.getElementById('navLinks'),btn=document.getElementById('navToggle');
  if(!nav||!btn)return;
  nav.classList.toggle('open',!!open);
  btn.setAttribute('aria-expanded',String(!!open));
  btn.classList.toggle('is-open',!!open);
  btn.setAttribute('aria-label',open?'إغلاق القائمة':'فتح القائمة');
}
const publicNavToggle=document.getElementById('navToggle');
publicNavToggle?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setPublicNav(!document.getElementById('navLinks')?.classList.contains('open'))});
document.querySelectorAll('#navLinks a').forEach(a=>a.addEventListener('click',()=>setPublicNav(false)));
document.addEventListener('click',e=>{if(!matchMedia('(max-width:760px)').matches)return;if(!document.getElementById('navLinks')?.classList.contains('open'))return;if(e.target.closest('.public-nav'))return;setPublicNav(false)});
window.addEventListener('resize',()=>{if(!matchMedia('(max-width:760px)').matches)setPublicNav(false)});

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
  const EVIDENCE=['إعلان','منشورات','رسائل توعوية','إحصائية التسجيل','حصر المسجلات','نماذج أنشطة','تقرير','صور','شعارات','أخرى'];
  let execDirty=false;
  const pendingDeletes=new Set();
  let currentPlan=null;
  const planId=new URLSearchParams(location.search).get('plan_id');
  const draftKey=`namaa-exec-draft:${planId||''}`;
  const markDirty=()=>{execDirty=true;document.getElementById('execDraftStatus')?.classList.add('dirty')};
  const beforeUnload=e=>{if(execDirty){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);

  function evidenceDropdown(selected=[]){
    const safe=Array.isArray(selected)?selected:[];
    const chips=safe.length?safe.map(x=>`<span>${esc(x)}</span>`).join(''):'<em>اختاري الشواهد</em>';
    const opts=EVIDENCE.map(x=>`<button type="button" class="evidence-option ${safe.includes(x)?'selected':''}" data-value="${esc(x)}" aria-pressed="${safe.includes(x)}">${esc(x)}</button>`).join('');
    return `<div class="multi-select" data-values="${esc(JSON.stringify(safe))}"><button type="button" class="multi-select-toggle">${chips}</button><div class="multi-select-menu" hidden>${opts}</div></div>`;
  }
  function readEvidence(tr){
    try{return JSON.parse(tr.querySelector('.multi-select')?.dataset.values||'[]')}catch(_){return []}
  }
  function reasonBlock(r={}){
    const no=r.executed===false;
    return `<div class="exec-bool"><label><input class="exec-choice" type="checkbox" data-choice="yes" ${r.executed===true?'checked':''}> نعم</label><label><input class="exec-choice" type="checkbox" data-choice="no" ${no?'checked':''}> لا</label></div><textarea class="exec-reason ${no?'':'hidden-reason'}" rows="2" placeholder="سبب عدم التنفيذ">${esc(r.reason||'')}</textarea>`;
  }
  function editableRow(r={},i=0,isNew=false){
    const id=isNew?'new-'+crypto.randomUUID():r.id;
    return `<tr data-id="${id}" ${isNew?'data-new="1"':''}>
      <td class="exec-num" data-label="رقم">${i+1}</td>
      <td data-label="المرحلة والتوقيت"><input class="exec-phase" list="phaseSuggestions" value="${esc(r.phase_timing||r.phase||'')}" placeholder="مثال: الإعلان"><input class="exec-phase-date" value="${esc(r.phase_date||r.phaseDate||'')}" placeholder="مثال: 5 أكتوبر 2026"><button type="button" class="copy-prev-btn screen-only" title="نسخ بيانات المرحلة السابقة">نسخ السابق</button></td>
      <td data-label="إجراءات التنفيذ"><div class="exec-row-tools"><textarea class="exec-procedure" rows="3" placeholder="اكتبي إجراءات التنفيذ">${esc(r.procedure_text||r.procedure||'')}</textarea><button type="button" class="exec-delete-mini exec-delete screen-only" title="حذف المرحلة">×</button></div></td>
      <td data-label="المسؤول"><input class="exec-responsible" value="${esc(r.responsible||currentProfile?.full_name||'منسقة الموهوبات')}" placeholder="المسؤول عن التنفيذ"></td>
      <td data-label="الشواهد">${evidenceDropdown(r.evidence_options||r.evidence||[])}</td>
      <td data-label="نسبة الإنجاز"><div class="exec-percent-wrap"><input class="exec-percent" type="number" min="0" max="100" value="${r.completion_percent??r.completion??''}" placeholder="0"><span>%</span></div></td>
      <td data-label="التنفيذ">${reasonBlock(r)}</td>
    </tr>`;
  }
  function viewRow(r,i){
    const ev=Array.isArray(r.evidence_options)?r.evidence_options:[];
    return `<tr><td class="exec-num" data-label="رقم">${i+1}</td><td data-label="المرحلة والتوقيت"><strong>${esc(r.phase_timing||'—')}</strong>${r.phase_date?`<small class="phase-date-view">${esc(r.phase_date)}</small>`:''}</td><td data-label="إجراءات التنفيذ">${esc(r.procedure_text||'—')}</td><td data-label="المسؤول">${esc(r.responsible||'—')}</td><td data-label="الشواهد">${ev.length?ev.map(x=>`<span class="evidence-chip">${esc(x)}</span>`).join(' '):'—'}</td><td data-label="نسبة الإنجاز">${progressMeter(r.completion_percent??0)}</td><td data-label="التنفيذ">${r.executed===true?'نعم':r.executed===false?`لا${r.reason?` — ${esc(r.reason)}`:''}`:'—'}</td></tr>`;
  }
  const rowsWrap=document.getElementById('execRows');
  const rowsNow=()=>[...rowsWrap.querySelectorAll('tr[data-id]')];
  const renumber=()=>rowsNow().forEach((tr,i)=>{const n=tr.querySelector('.exec-num');if(n)n.textContent=i+1});
  const updateOverall=()=>{
    const vals=rowsNow().map(tr=>Number(tr.querySelector('.exec-percent')?.value||0));
    const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
    const label=document.getElementById('execOverallProgress'),bar=document.getElementById('execOverallBar');
    if(label)label.textContent=avg+'%';if(bar){bar.style.width=avg+'%';bar.className=progressTone(avg)}
    return avg;
  }
  function snapshotDraft(){
    if(currentRole!=='admin')return;
    const rows=rowsNow().map((tr,i)=>({
      id:tr.dataset.id,new:tr.dataset.new==='1',phase:tr.querySelector('.exec-phase')?.value||'',phaseDate:tr.querySelector('.exec-phase-date')?.value||'',procedure:tr.querySelector('.exec-procedure')?.value||'',
      responsible:tr.querySelector('.exec-responsible')?.value||'',evidence:readEvidence(tr),completion:tr.querySelector('.exec-percent')?.value||'',
      executed:tr.querySelector('[data-choice="yes"]')?.checked?true:tr.querySelector('[data-choice="no"]')?.checked?false:null,reason:tr.querySelector('.exec-reason')?.value||'',sort:i
    }));
    localStorage.setItem(draftKey,JSON.stringify({at:Date.now(),rows,deletes:[...pendingDeletes]}));
    const s=document.getElementById('execDraftStatus');if(s){s.textContent='تم حفظ المسودة تلقائيًا على هذا الجهاز';s.classList.remove('dirty')}
  }
  let draftTimer;
  const scheduleDraft=()=>{markDirty();clearTimeout(draftTimer);draftTimer=setTimeout(snapshotDraft,450)};

  async function fetchRows(){
    const {data,error}=await sb.from('executive_plan_steps').select('*').eq('plan_item_id',planId).order('sort_order').order('created_at');
    if(error)throw error;return data||[];
  }
  async function renderRows(useDraft=true){
    const rows=await fetchRows();pendingDeletes.clear();execDirty=false;
    if(currentRole==='admin'){
      let source=rows.map(r=>({...r}));
      const saved=useDraft?localStorage.getItem(draftKey):null;
      if(saved){
        try{
          const d=JSON.parse(saved);
          if(d?.rows?.length && confirm('وجدت مسودة غير محفوظة لهذه الخطة. هل تريدين استعادتها؟')){
            source=d.rows.map(x=>({id:x.id,phase_timing:x.phase,phase_date:x.phaseDate||'',procedure_text:x.procedure,responsible:x.responsible,evidence_options:x.evidence,completion_percent:x.completion===''?null:+x.completion,executed:x.executed,reason:x.reason,__new:x.new}));
            (d.deletes||[]).forEach(x=>pendingDeletes.add(x));execDirty=true;
          }else localStorage.removeItem(draftKey);
        }catch(_){localStorage.removeItem(draftKey)}
      }
      rowsWrap.innerHTML=source.map((r,i)=>editableRow(r,i,!!r.__new)).join('')||'<tr class="exec-empty-row"><td colspan="7" class="empty-state">لم تتم إضافة مراحل بعد. استخدمي زر «إضافة مرحلة».</td></tr>';
    }else rowsWrap.innerHTML=rows.map(viewRow).join('')||'<tr><td colspan="7" class="empty-state">لم تتم إضافة مراحل للخطة التنفيذية بعد.</td></tr>';
    updateOverall();
  }

  try{
    const {data:{session}}=await sb.auth.getSession();
    if(!session){location.replace('login.html');return}
    const {data:profile,error:profileError}=await sb.from('profiles').select('full_name,role').eq('id',session.user.id).single();
    if(profileError||!profile){await sb.auth.signOut();location.replace('login.html');return}
    currentProfile=profile;currentRole=profile.role;document.body.classList.toggle('viewer',currentRole!=='admin');
    document.querySelectorAll('.exec-admin-only').forEach(el=>{el.hidden=currentRole!=='admin'});
    if(!planId)throw new Error('لم يتم تحديد بند الخطة.');
    const {data:plan,error:planError}=await sb.from('plan_items').select('id,title,date_from,date_to,status,progress').eq('id',planId).single();if(planError)throw planError;currentPlan=plan;
    const {data:settings}=await sb.from('site_settings').select('coordinator_name,principal_name').order('id').limit(1).maybeSingle();
    document.getElementById('printCoordinator').textContent=settings?.coordinator_name||'أبرار الهنيدي';document.getElementById('printPrincipal').textContent=settings?.principal_name||'هدى البهيجي';
    document.getElementById('execPlanTitle').textContent=`الخطة التنفيذية لبرنامج: ${plan.title}`;
    document.getElementById('execPlanMeta').innerHTML=`<span>${esc(plan.date_from||'')}</span>${plan.date_to?`<span>إلى ${esc(plan.date_to)}</span>`:''}<span class="status-pill">${esc(plan.status||'')}</span>`;
    await renderRows(true);
    const initial=Number(plan.progress||0);document.getElementById('execOverallProgress').textContent=initial+'%';

    const summaryBtn=document.getElementById('execSummaryBtn');if(summaryBtn)summaryBtn.href=`print-program.html?plan_id=${encodeURIComponent(planId)}`;
    document.getElementById('execAddRow')?.addEventListener('click',()=>{
      if(currentRole!=='admin')return;rowsWrap.querySelector('.exec-empty-row')?.remove();
      const i=rowsNow().length;rowsWrap.insertAdjacentHTML('beforeend',editableRow({responsible:currentProfile?.full_name||'منسقة الموهوبات'},i,true));scheduleDraft();rowsWrap.querySelector('tr:last-child .exec-phase')?.focus();
    });

    rowsWrap.addEventListener('click',e=>{
      const toggle=e.target.closest('.multi-select-toggle');
      if(toggle){const menu=toggle.parentElement.querySelector('.multi-select-menu');document.querySelectorAll('.multi-select-menu').forEach(x=>{if(x!==menu)x.hidden=true});menu.hidden=!menu.hidden;return}
      const opt=e.target.closest('.evidence-option');
      if(opt){const ms=opt.closest('.multi-select');let vals=[];try{vals=JSON.parse(ms.dataset.values||'[]')}catch(_){}
        const v=opt.dataset.value;vals=vals.includes(v)?vals.filter(x=>x!==v):[...vals,v];ms.dataset.values=JSON.stringify(vals);opt.classList.toggle('selected',vals.includes(v));opt.setAttribute('aria-pressed',String(vals.includes(v)));
        ms.querySelector('.multi-select-toggle').innerHTML=vals.length?vals.map(x=>`<span>${esc(x)}</span>`).join(''):'<em>اختاري الشواهد</em>';scheduleDraft();return}
      const cp=e.target.closest('.copy-prev-btn');
      if(cp){const tr=cp.closest('tr'),all=rowsNow(),i=all.indexOf(tr);if(i<=0)return alert('لا توجد مرحلة سابقة لنسخها.');const prev=all[i-1];
        tr.querySelector('.exec-phase').value=prev.querySelector('.exec-phase').value;tr.querySelector('.exec-phase-date').value=prev.querySelector('.exec-phase-date').value;tr.querySelector('.exec-procedure').value=prev.querySelector('.exec-procedure').value;tr.querySelector('.exec-responsible').value=prev.querySelector('.exec-responsible').value;
        const vals=readEvidence(prev),ms=tr.querySelector('.multi-select');ms.dataset.values=JSON.stringify(vals);ms.querySelector('.multi-select-toggle').innerHTML=vals.length?vals.map(x=>`<span>${esc(x)}</span>`).join(''):'<em>اختاري الشواهد</em>';ms.querySelectorAll('.evidence-option').forEach(o=>o.classList.toggle('selected',vals.includes(o.dataset.value)));scheduleDraft();return}
      const del=e.target.closest('.exec-delete');
      if(del&&currentRole==='admin'){const tr=del.closest('tr[data-id]');if(!tr||!confirm('حذف هذه المرحلة؟ سيتم اعتماد الحذف عند الحفظ.'))return;if(tr.dataset.new!=='1')pendingDeletes.add(tr.dataset.id);tr.remove();renumber();scheduleDraft();if(!rowsNow().length)rowsWrap.innerHTML='<tr class="exec-empty-row"><td colspan="7" class="empty-state">لم تتم إضافة مراحل بعد.</td></tr>';return}
    });
    document.addEventListener('click',e=>{if(!e.target.closest('.multi-select'))document.querySelectorAll('.multi-select-menu').forEach(x=>x.hidden=true)});
    rowsWrap.addEventListener('input',e=>{if(e.target.matches('.exec-phase,.exec-phase-date,.exec-procedure,.exec-responsible,.exec-percent,.exec-reason')){if(e.target.matches('.exec-percent'))updateOverall();scheduleDraft()}});
    rowsWrap.addEventListener('change',e=>{const c=e.target.closest('.exec-choice');if(!c)return;const tr=c.closest('tr');if(c.checked)tr.querySelectorAll('.exec-choice').forEach(x=>{if(x!==c)x.checked=false});const no=tr.querySelector('[data-choice="no"]')?.checked,reason=tr.querySelector('.exec-reason');reason.classList.toggle('hidden-reason',!no);scheduleDraft()});

    document.getElementById('execSave')?.addEventListener('click',async()=>{
      if(currentRole!=='admin')return;const rows=rowsNow(),saveBtn=document.getElementById('execSave');
      try{
        saveBtn.disabled=true;showCloudStatus('جارِ حفظ الخطة التنفيذية...');
        for(let i=0;i<rows.length;i++){
          const tr=rows[i],id=tr.dataset.id,yes=tr.querySelector('[data-choice="yes"]')?.checked,no=tr.querySelector('[data-choice="no"]')?.checked;
          const payload={plan_item_id:planId,phase_timing:tr.querySelector('.exec-phase').value.trim(),phase_date:tr.querySelector('.exec-phase-date').value.trim(),procedure_text:tr.querySelector('.exec-procedure').value.trim(),responsible:tr.querySelector('.exec-responsible').value.trim(),evidence_options:readEvidence(tr),completion_percent:tr.querySelector('.exec-percent').value===''?null:Math.max(0,Math.min(100,+tr.querySelector('.exec-percent').value||0)),executed:yes?true:no?false:null,reason:no?tr.querySelector('.exec-reason').value.trim():'',sort_order:i,updated_at:new Date().toISOString()};
          if(tr.dataset.new==='1'){const {error}=await sb.from('executive_plan_steps').insert(payload);if(error)throw error}else{const {error}=await sb.from('executive_plan_steps').update(payload).eq('id',id).eq('plan_item_id',planId);if(error)throw error}
        }
        if(pendingDeletes.size){const {error}=await sb.from('executive_plan_steps').delete().in('id',[...pendingDeletes]).eq('plan_item_id',planId);if(error)throw error}
        localStorage.removeItem(draftKey);pendingDeletes.clear();execDirty=false;try{await touchSiteUpdatedAt()}catch(_){}
        await renderRows(false);showCloudStatus('تم حفظ الخطة التنفيذية وتحديث نسبة الإنجاز');
      }catch(err){alert('تعذر الحفظ: '+err.message+'\nالمسودة محفوظة على هذا الجهاز ولن تضيع كتابتك.');snapshotDraft()}
      finally{saveBtn.disabled=false}
    });
  }catch(err){document.getElementById('execPlanError').textContent='تعذر تحميل الخطة التنفيذية: '+err.message;document.getElementById('execPlanError').hidden=false}
  finally{clearBusy()}
}
async function setupPrintProgram(){
  const root=document.getElementById('printProgramPage');if(!root)return;
  setBusy('جارِ تجهيز الملخص...');
  try{
    const {data:{session}}=await sb.auth.getSession();if(!session){location.replace('login.html');return}
    const planId=new URLSearchParams(location.search).get('plan_id');if(!planId)throw new Error('لم يتم تحديد البرنامج.');
    const [{data:plan,error:pErr},{data:steps,error:sErr},{data:settings}] = await Promise.all([
      sb.from('plan_items').select('*').eq('id',planId).single(),
      sb.from('executive_plan_steps').select('*').eq('plan_item_id',planId).order('sort_order'),
      sb.from('site_settings').select('coordinator_name,principal_name').order('id').limit(1).maybeSingle()
    ]);
    if(pErr)throw pErr;if(sErr)throw sErr;
    document.getElementById('printProgramTitle').textContent=`الخطة التنفيذية لبرنامج: ${plan.title}`;
    document.getElementById('printProgramMeta').innerHTML=`<span>الفترة: ${esc(plan.date_from||'—')} ${plan.date_to?`إلى ${esc(plan.date_to)}`:''}</span><span>المسجلات: ${plan.registered_count??'—'}</span><span>الإنجاز: ${plan.progress||0}%</span>`;
    document.getElementById('printProgramProgress').innerHTML=progressMeter(plan.progress||0);
    document.getElementById('printProgramSteps').innerHTML=(steps||[]).map((s,i)=>`<tr><td>${i+1}</td><td><strong>${esc(s.phase_timing||'—')}</strong>${s.phase_date?`<br><small>${esc(s.phase_date)}</small>`:''}</td><td>${esc(s.procedure_text||'—')}</td><td>${esc(s.responsible||'—')}</td><td>${(s.evidence_options||[]).map(x=>esc(x)).join('، ')||'—'}</td><td>${s.completion_percent??0}%</td><td>${s.executed===true?'نعم':s.executed===false?`لا${s.reason?` — ${esc(s.reason)}`:''}`:'—'}</td></tr>`).join('')||'<tr><td colspan="7">لا توجد مراحل مضافة.</td></tr>';document.getElementById('printBackToExec').href=`executive-plan.html?plan_id=${encodeURIComponent(planId)}`;
    document.getElementById('printProgramCoordinator').textContent=settings?.coordinator_name||'أبرار الهنيدي';document.getElementById('printProgramPrincipal').textContent=settings?.principal_name||'هدى البهيجي';
  }catch(e){root.innerHTML=`<div class="exec-error">تعذر تجهيز الملخص: ${esc(e.message)}</div>`}finally{clearBusy()}
}

setupExecutivePlan();setupPrintProgram();
