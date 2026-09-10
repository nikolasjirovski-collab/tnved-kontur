import {esc,pct,num,dateText,resultHTML,detailHTML,publicReport,reportText} from './render.js?v=3.0.0';
const $=id=>document.getElementById(id);
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const emptyHTML=$('results-content').innerHTML;
let report=null,meta=null,revision=0,requestId=0,latestSearch=0,savedId=null,toastTimer;
const pending=new Map();const worker=new Worker(new URL('./worker.js?v=3.0.0',import.meta.url),{type:'module'});
worker.onmessage=({data})=>{const h=pending.get(data.id);if(!h)return;if(data.progress){h.progress?.(data.progress);return;}pending.delete(data.id);data.error?h.reject(Error(data.error)):h.resolve(data.result);};
worker.onerror=()=>{for(const p of pending.values())p.reject(Error('Не удалось запустить обработку. Обновите страницу или попробуйте другой браузер.'));pending.clear();};
function request(type,payload={},progress){return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject,progress});worker.postMessage({id,type,...payload});});}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function setView(name){for(const v of ['search','history'])$(v+'-view').hidden=v!==name;document.querySelectorAll('.rail-button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));if(name==='history')renderHistory();}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('as_of').value=today();
function invalidate(){revision++;report=null;savedId=null;$('candidate-dialog').close();$('results-content').innerHTML=emptyHTML;$('results-subtitle').textContent='Карточка изменена — выполните новый подбор';}
$('product-form').addEventListener('input',invalidate);$('product-form').addEventListener('change',invalidate);
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('product-form').reset();$('description').value=button.dataset.example;$('as_of').value=today();invalidate();if(meta)runSearch().catch(()=>{});else $('description').focus();}));
const getProfile=()=>Object.fromEntries(new FormData($('product-form')));
async function runSearch(profile=getProfile()){
  if(!meta){toast('Справочник ещё загружается.');throw Error('Справочник ещё загружается.');}
  const current=++revision,searchToken=++latestSearch;report=null;savedId=null;$('search-button').disabled=true;
  $('results-content').innerHTML='<div class="loading-state"><span class="spinner"></span>Сравниваем смысл описаний…</div>';$('results-subtitle').textContent='Первый подбор может занять больше времени: загружаются данные поиска';
  try{const result=await request('classify',{profile,limit:5},text=>{if(current===revision)$('results-subtitle').textContent=text;});if(current!==revision)throw Error('Карточка изменилась во время подбора.');report=publicReport(result);renderResults();return report;}
  catch(error){if(current===revision){$('results-content').innerHTML=`<div class="error-state">${esc(error.message)}</div>`;$('results-subtitle').textContent='Подбор не выполнен';}throw error;}
  finally{if(meta&&searchToken===latestSearch)$('search-button').disabled=false;}
}
$('product-form').addEventListener('submit',e=>{e.preventDefault();runSearch().catch(()=>{});});
function renderResults(){if(!report)return;$('results-subtitle').textContent=report.total?`${num(report.total)} вариантов · показано ${report.candidates.length}`:'Недостаточно совпадений для подбора';$('results-content').innerHTML=resultHTML(report);
  document.querySelectorAll('[data-candidate]').forEach(b=>b.addEventListener('click',()=>openDetail(Number(b.dataset.candidate))));$('save-report').addEventListener('click',saveReport);$('export-report').addEventListener('click',()=>downloadReport('json'));$('export-text').addEventListener('click',()=>downloadReport('txt'));
}
function openDetail(index){const c=report?.candidates[index];if(!c)return;$('candidate-detail').innerHTML=detailHTML(c);$('copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(c.code);toast('Код скопирован');}catch{toast('Выделите код и скопируйте вручную.');}});$('candidate-dialog').showModal();}
$('close-dialog').addEventListener('click',()=>$('candidate-dialog').close());
$('candidate-dialog').addEventListener('click',e=>{if(e.target===$('candidate-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
const HISTORY_KEY='tnved-kontur-history-v2';
function readHistory(){try{const rows=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&r.profile&&typeof r.profile.description==='string'&&Array.isArray(r.candidates)&&Array.isArray(r.warnings)).map(r=>({...publicReport(r),id:r.id})):[];}catch{return [];}}
function saveReport(){if(!report)return;if(savedId){toast('Эта проверка уже сохранена');return;}try{const records=readHistory();savedId=crypto.randomUUID();localStorage.setItem(HISTORY_KEY,JSON.stringify([{...publicReport(report),id:savedId},...records].slice(0,30)));toast('Проверка сохранена в этом браузере');}catch{savedId=null;toast('Не удалось сохранить. Экспортируйте отчёт в файл.');}}
function renderHistory(){const rows=readHistory();$('history-content').innerHTML=rows.length?rows.map((r,i)=>`<article class="history-row"><div><h3>${esc(r.profile.description)}</h3><p>${esc(new Date(r.created_at).toLocaleString('ru-RU'))} · ${r.candidates.length} вариантов</p></div><button class="secondary-button" data-history="${i}">Открыть отчёт ↗</button></article>`).join(''):'<div class="empty-state"><h3>Здесь будут ваши проверки</h3><p>После подбора нажмите «Сохранить проверку».<br>История хранится на этом устройстве, без синхронизации.</p></div>';
  document.querySelectorAll('[data-history]').forEach(b=>b.addEventListener('click',()=>{const r=rows[Number(b.dataset.history)];revision++;report=r;savedId=r.id;for(const [k,v] of Object.entries(r.profile)){if($(k))$(k).value=v;}setView('search');renderResults();$('results-subtitle').textContent='Сохранённый отчёт · '+new Date(r.created_at).toLocaleDateString('ru-RU')+' · не пересчитан';}));
}
function downloadReport(kind){if(!report)return;const blob=new Blob([kind==='json'?JSON.stringify(publicReport(report),null,2):reportText(report)],{type:kind==='json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ТН ВЭД — '+report.profile.description.slice(0,70).replace(/[<>:"/\\|?*]/g,'')+'.'+kind;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function initialize(){
  $('load-status').textContent='Загрузка справочника';
  try{meta=await request('init');$('load-status').textContent='Справочник загружен';$('as_of').min=meta.minimum_date;$('search-button').disabled=false;
  }catch(error){$('load-status').textContent='Ошибка загрузки';$('results-content').innerHTML=`<div class="error-state">${esc(error.message)}<br><button class="secondary-button" id="retry-load">Повторить загрузку</button></div>`;$('retry-load').addEventListener('click',initialize);}
}
initialize();
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  try{Promise.resolve(document.modelContext.registerTool({name:'classify_product',title:'Подобрать ТН ВЭД',description:'Заполнить карточку и показать предварительные коды с долями соответствия. Не подтверждает юридическую классификацию.',inputSchema:{type:'object',properties:Object.fromEntries(['description','material','purpose','construction','specifications','as_of','equipment'].map(k=>[k,{type:'string',maxLength:10000}])),required:['description'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){
    const allowed=['description','material','purpose','construction','specifications','as_of','equipment'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||Object.values(input).some(v=>typeof v!=='string'||v.length>10000)||!input.description?.trim())throw Error('Нужно название товара и допустимые строковые поля.');
    if(input.equipment&&!['all','electric','petrol'].includes(input.equipment))throw Error('Выберите тип инструмента.');
    const p={...Object.fromEntries(allowed.map(k=>[k,''])),...input,as_of:input.as_of||today(),equipment:input.equipment||'all'};
    if(!meta)throw Error('Дождитесь загрузки справочника.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.as_of)||!Number.isFinite(Date.parse(p.as_of))||new Date(p.as_of).toISOString().slice(0,10)!==p.as_of||p.as_of<meta.minimum_date)throw Error('Укажите корректную дату начиная с '+meta.minimum_date+'.');
    for(const [k,v] of Object.entries(p))$(k).value=v;invalidate();setView('search');const r=await runSearch(p);return {confirmed_code:null,candidates:r.candidates.map(c=>({code:c.code,name:c.name,share:c.share})),warnings:publicReport(r).warnings};
  }},{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional API must not block the app. */}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
