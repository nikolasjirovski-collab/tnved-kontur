export const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const pct=v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:2});
export const num=v=>Number(v).toLocaleString('ru-RU');
export const dateText=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('.'):esc(v);
export const codeText=c=>esc(String(c));
export const fieldLabels={description:'Описание',material:'Материал',purpose:'Назначение',construction:'Конструкция',specifications:'Параметры'};
export const equipmentText=v=>({electric:'Электроинструмент',petrol:'Бензоинструмент',all:'Электро- и бензоинструмент'}[v]||'Электро- и бензоинструмент');
const warnings=['Проценты показывают соответствие среди найденных вариантов, а не вероятность правильного кода.','Окончательный код и его действительность на дату операции требуют проверки.'];
// An explicit allowlist keeps file names, provenance and diagnostic fields out of every user report, including older saved results.
export function publicReport(r){
  return {created_at:r.created_at,profile:Object.fromEntries(['description','material','purpose','construction','specifications','as_of','equipment'].map(k=>[k,r.profile?.[k]||(k==='equipment'?'all':'')])),
    confirmed_code:null,mode:r.mode,total:r.total,other_share:r.other_share,
    groups:(r.groups||[]).map(g=>({code:String(g.code),name:g.name,share:g.share})),
    candidates:(r.candidates||[]).map(c=>({code:String(c.code),name:c.name,share:c.share,group_share:c.group_share,
      fields:{},
      contradictions:c.contradictions||[],domain_reasons:c.domain_reasons||[],path:(c.path||[]).map(n=>({code:String(n.code),description:n.description}))})),
    exact_codes:(r.exact_codes||[]).map(String),questions:r.questions||[],warnings:[...warnings],
    unavailable:(r.unavailable||[]).map(c=>({code:String(c.code),name:c.name,reason:'Для выбранной даты код требует дополнительной проверки; оценка не рассчитана.'}))};
}
export function resultHTML(raw){
  const r=publicReport(raw);let html='';
  if(r.groups.length)html+='<div class="group-list" aria-label="Доли товарных групп">'+r.groups.slice(0,8).map(g=>`<span class="group-chip" title="${esc(g.name)}">Группа ${esc(g.code)}<b>${pct(g.share)}%</b></span>`).join('')+'</div>';
  if(r.groups.length>8)html+=`<p class="result-note">Остальные группы: ${pct(r.groups.slice(8).reduce((s,g)=>s+g.share,0))}%.</p>`;
  if(r.exact_codes.length>1)html+='<div class="alert-box">Для этого названия возможны разные коды. Уточните тип инструмента и характеристики детали.</div>';
  if(r.candidates.length){
    html+='<div class="candidate-list">'+r.candidates.map((c,i)=>`<button class="candidate" data-candidate="${i}" aria-label="Код ${esc(c.code)}, открыть подробности"><span class="candidate-top"><span class="code">${codeText(c.code)}</span>${c.share===null?'<span>↗</span>':`<span class="percent">${pct(c.share)}<small>%</small></span>`}</span><span class="candidate-name">${esc(c.name)}</span><span class="candidate-meta"><span class="tag">${c.contradictions.length?'Требует уточнения':'Вариант для проверки'}</span><span>Подробнее ↗</span></span>${c.share===null?'':`<span class="candidate-bar" style="width:${Math.min(100,Math.max(0,Number(c.share)||0))}%"></span>`}</button>`).join('')+'</div>';
    if(r.mode!=='code')html+=`<p class="result-note">Доли среди найденных вариантов, не вероятность правильной классификации.${r.other_share?` За пределами списка: ${pct(r.other_share)}%.`:''}</p>`;
  }else html+='<div class="empty-state"><h3>Нужно чуть больше информации</h3><p>Укажите название детали, материал и тип инструмента.<br>Можно также ввести полный код ТН ВЭД.</p></div>';
  if(r.unavailable.length)html+=`<details class="alert-box"><summary>Другие коды, требующие проверки: ${num(r.unavailable.length)}</summary>${r.unavailable.slice(0,50).map(c=>`<p><b>${codeText(c.code)}</b> — ${esc(c.name)}<br>${esc(c.reason)}</p>`).join('')}</details>`;
  if(r.questions.length)html+=`<details class="result-note"><summary>Что уточнить для выбора кода</summary><ul>${[...new Set(r.questions)].map(q=>`<li>${esc(q)}</li>`).join('')}</ul></details>`;
  return html+'<div class="result-actions"><button class="secondary-button" id="save-report">Сохранить проверку</button><button class="secondary-button" id="export-report">Экспорт JSON ↓</button><button class="secondary-button" id="export-text">Экспорт TXT ↓</button></div>';
}
export function detailHTML(raw){
  const c=publicReport({candidates:[raw]}).candidates[0];
  return `<h2 class="detail-code" id="detail-title">${codeText(c.code)}</h2><p class="detail-subtitle">${esc(c.name)}</p><div class="result-actions"><button id="copy-code" class="secondary-button">Копировать код</button>${c.share!==null?`<span class="group-chip">Доля соответствия <b>${pct(c.share)}%</b></span>`:''}</div>
    ${c.contradictions.length?`<div class="alert-box">${c.contradictions.map(esc).join('<br>')}</div>`:''}
    ${c.domain_reasons.length?`<section class="detail-section"><h3>Совместимость с инструментом</h3><ul>${c.domain_reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`:''}
    <section class="detail-section"><h3>Категория товара</h3>${c.path.map(n=>`<div class="tree-row"><code>${codeText(n.code)}</code><p>${esc(n.description)}</p></div>`).join('')||'<p class="reference">Категорию необходимо уточнить.</p>'}</section>
    <div class="alert-box">Код предварительный. Перед использованием проверьте характеристики товара и актуальность классификации.</div>`;
}
export function reportText(raw){const r=publicReport(raw);return ['КОНТУР · ТН ВЭД',equipmentText(r.profile.equipment),'Подтверждённый код: не установлен',...Object.entries(fieldLabels).filter(([k])=>r.profile[k]).map(([k,label])=>label+': '+r.profile[k]),'Дата операции: '+dateText(r.profile.as_of),'',...r.warnings,'','ГРУППЫ',...r.groups.map(g=>`${g.code}: ${pct(g.share)}% — ${g.name}`),'',...r.candidates.flatMap(c=>[`${c.code} — ${c.name}`,c.share===null?'Поиск по коду':`Доля соответствия: ${pct(c.share)}%`,...c.domain_reasons,...c.path.map(n=>`${n.code}: ${n.description}`),...c.contradictions,'']),'Доля скрытых кодов: '+(r.other_share??'не применяется'),'УТОЧНЕНИЯ',...r.questions,'ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА',...r.unavailable.map(c=>`${c.code} — ${c.name}. ${c.reason}`)].join('\n');}
