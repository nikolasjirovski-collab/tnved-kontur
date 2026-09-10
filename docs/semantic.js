import {toolContext,validOn} from './engine.js';
export const SEMANTIC_VERSION='semantic-minilm-tools-v1';
const round=(x,n=4)=>Number(x.toFixed(n));
// Disambiguate a named part from a neighbouring part (carburetor versus its gasket).
// This vocabulary never assigns a code; semantic retrieval still compares every branch.
const partPatterns={carburetor:/карбюратор/iu,gear:/шестерн|зубчат.{0,8}колес/iu,guard:/кожух|щиток|огражден/iu,
  washer:/шайб/iu,bearing:/подшипник/iu,gasket:/прокладк/iu,seal:/сальник|уплотнени/iu,brush:/щ[её]тк/iu,
  rotor:/якорь|якоря|ротор/iu,stator:/статор/iu,motor:/двигател/iu,belt:/ремень|ремня|ремни/iu,pulley:/шкив/iu,
  starter:/стартер/iu,sprocket:/зв[её]здочк/iu,chain:/цепь|цепи/iu,nut:/гайк/iu,bolt:/болт/iu,screw:/винт|саморез/iu,
  shaft:/(?:^|\s)вал(?:а|ы|ов)?(?:\s|,|$)|коленвал/iu,cylinder:/цилиндр/iu,piston:/поршен/iu,spring:/пружин/iu,filter:/фильтр/iu,
  handle:/рукоятк|ручк/iu,cover:/крышк|колпачок|колпачк/iu,housing:/корпус/iu,retainer:/сухарь|фиксатор/iu,
  cable:/трос|кабел|шнур/iu,wheel:/колес/iu,plate:/пластин|накладк/iu,spacer:/проставк|втулк/iu,
  bracket:/кронштейн|опора|держател/iu,kit:/ремкомплект|ремонтный комплект|комплект ремонта/iu,flywheel:/маховик/iu};
export function partKind(text){const subject=text.split(/\s+(?:для|от|на)\s+/iu)[0];let best=null,position=Infinity;for(const [kind,pattern] of Object.entries(partPatterns)){const found=pattern.exec(subject);if(!found||found.index>=position)continue;const prefix=subject.slice(0,found.index).match(/[а-яё]+/giu)||[];if(prefix.some(w=>!/(?:ый|ий|ая|яя|ое|ее|ые|ие|ой)$/iu.test(w)))continue;best=kind;position=found.index;}return best;}
export function inferPart(vector,index,matrix){
  const q=normalizeVector(vector),best=new Map();
  for(let i=0;i<index.documents.length;i++){const d=index.documents[i];if(d.kind!=='glossary')continue;const kind=partKind(d.text);if(!kind)continue;let score=0;for(let j=0;j<q.length;j++)score+=q[j]*matrix[i*index.dimension+j];if(score>(best.get(kind)||0))best.set(kind,score);}
  const sorted=[...best].sort((a,b)=>b[1]-a[1]);
  return sorted[0]?.[1]>=.75&&sorted[0][1]-(sorted[1]?.[1]||0)>=.06?sorted[0][0]:null;
}
export function normalizeVector(vector){let length=0;for(const x of vector){if(!Number.isFinite(x))throw Error('Некорректный результат обработки.');length+=x*x;}length=Math.sqrt(length);if(length<1e-8)throw Error('Недостаточно данных для сравнения.');return Float32Array.from(vector,x=>x/length);}
export function nearestCodes(vector,index,matrix,accept=()=>true){
  if(vector.length!==index.dimension||matrix.length!==index.documents.length*index.dimension)throw Error('Не удалось прочитать данные поиска.');
  const q=normalizeVector(vector),best=new Map();
  for(let i=0;i<index.documents.length;i++){
    const d=index.documents[i];if(!accept(d))continue;let similarity=0;const start=i*index.dimension;
    for(let j=0;j<q.length;j++)similarity+=q[j]*matrix[start+j];
    if(!best.has(d.code)||best.get(d.code).similarity<similarity)best.set(d.code,{...d,similarity});
  }
  return [...best.values()].sort((a,b)=>b.similarity-a.similarity||a.code.localeCompare(b.code));
}
export function semanticReport(engine,input,vector,index,matrix,limit=5){
  const p=engine.validate(input);limit=Math.max(1,Math.min(5,Number(limit)||5));
  if(/^\d[\d\s]*$/.test(p.description))return engine.classify(p,limit);
  const namedPart=partKind(p.description),requestedPart=namedPart||inferPart(vector,index,matrix);
  const unreadable=/[bcdfghjklmnpqrstvwxz]{6,}/i.test(p.description)&&!/[а-яё]/i.test(p.description);
  const matches=unreadable?[]:nearestCodes(vector,index,matrix,d=>!requestedPart||partKind(d.text)===requestedPart);
  const active=new Map(engine.records.filter(r=>validOn(r,p.as_of)).map(r=>[r.code,r]));
  const supplied=engine.customerSearch(p),exact=new Set(supplied.exact_codes);
  const query=Object.fromEntries(Object.keys(engine.data.weights).map(f=>[f,engine.terms(p[f])]));
  let requestedMaterial=new Set([...query.material].filter(t=>engine.materials.has(t)));
  if(!requestedMaterial.size)requestedMaterial=new Set([...query.description].filter(t=>engine.materials.has(t)));
  const scored=[],unavailable=[];
  // A cosine gate is a retrieval abstention heuristic, never a calibrated accuracy claim.
  for(const m of matches){
    if(m.similarity<.70)continue;
    const r=active.get(m.code);if(!r){if(m.similarity>=.55)unavailable.push({code:m.code,name:m.text,reason:'Для выбранной даты требуется дополнительная проверка.'});continue;}
    if(p.source&&!supplied.hits.some(h=>h.code===m.code))continue;
    const text=[r.description,engine.data.nodes[m.code]?.description||'',m.text].join(' ');
    const context=toolContext(p,text),contradictions=[];
    let score=m.similarity;
    if(exact.has(m.code))score+=.035;
    // Context adjusts true semantic candidates; it never generates a candidate itself.
    score*=context.factor;
    const materialText=text+' '+(engine.data.nodes[m.code.slice(0,2)]?.description||'');
    const candidateMaterial=new Set([...engine.terms(materialText)].filter(t=>engine.materials.has(t)));
    if(/бумаг|картон/iu.test(materialText))candidateMaterial.add('бумага');
    if(/асбест/iu.test(materialText))candidateMaterial.add('асбест');
    if(/текстил|ткан/iu.test(materialText))candidateMaterial.add('текстиль');
    if(/черных металлов/iu.test(materialText)){candidateMaterial.add('сталь');candidateMaterial.add('чугун');}
    if(requestedMaterial.size&&candidateMaterial.size>0&&![...requestedMaterial].some(t=>candidateMaterial.has(t))){score*=.2;contradictions.push('Материал варианта отличается от указанного.');}
    else if(requestedMaterial.size&&[...requestedMaterial].some(t=>candidateMaterial.has(t)))score+=.04;
    if(requestedPart){
      const candidatePart=partKind(m.text);
      if(candidatePart&&candidatePart!==requestedPart){score*=.35;contradictions.push('Похожее описание относится к другой детали.');}
      else if(!candidatePart&&m.kind==='example')score*=.6;
      const specific=[10,9,8,6].map(n=>engine.data.nodes[m.code.slice(0,n)]?.description||'').find(name=>partKind(name));
      if(specific&&partKind(specific)!==requestedPart){score*=.35;contradictions.push('Наименование категории описывает другой тип детали.');}
      if(m.code.startsWith('8467')&&!/^84679[129]/.test(m.code)&&requestedPart!=='motor'){
        score*=.35;contradictions.push('Категория описывает инструмент в сборе; назначение детали требует проверки.');
      }
    }
    if(context.incompatible)contradictions.push('Тип привода не соответствует выбранному инструменту.');
    if(context.unrelated)contradictions.push('Описание связано с другим оборудованием.');
    const target=engine.terms(text),fields={};
    for(const [f,terms] of Object.entries(query))if(terms.size){const common=[...terms].filter(t=>target.has(t));fields[f]={coverage:common.length/terms.size,missing:[...terms].filter(t=>!target.has(t))};}
    scored.push({m,r,score,context,contradictions,fields});
  }
  scored.sort((a,b)=>b.score-a.score||a.m.code.localeCompare(b.m.code));
  const peak=scored[0]?.score||0;
  const plausible=scored.filter(e=>e.score>=Math.max(.70,peak-.16)).slice(0,30);
  const weights=plausible.map(e=>Math.exp((e.score-peak)/.07));const totalWeight=weights.reduce((a,b)=>a+b,0);
  const groups=new Map();plausible.forEach((e,i)=>{e.share=100*weights[i]/totalWeight;const prefix=e.m.code.slice(0,2);groups.set(prefix,(groups.get(prefix)||0)+e.share);});
  const candidates=plausible.slice(0,limit).map(e=>({code:e.m.code,name:e.m.kind!=='nomenclature'?e.m.text:engine.data.nodes[e.m.code]?.description||e.r.description,
    description:e.r.description,share:round(e.share),group_share:round(groups.get(e.m.code.slice(0,2))),
    semantic_similarity:round(e.m.similarity),fields:e.fields,contradictions:e.contradictions,domain_reasons:e.context.reasons,
    path:engine.path(e.m.code),hits:[],notes:{},requirements:{matches:[],note:'Применимость обязательных требований проверяется отдельно.'}}));
  const questions=Object.entries({material:'Уточните материал детали.',purpose:'Укажите инструмент, модель и назначение детали.',construction:'Опишите конструкцию и комплектность.',specifications:'Укажите размеры и технические характеристики.'}).filter(([f])=>!p[f]).map(([,q])=>q);
  if(!namedPart&&requestedPart)questions.unshift('Тип детали предположен по её функции. Подтвердите точное название узла по документации.');
  if(!candidates.length)questions.unshift('Смысл описания определён недостаточно уверенно. Укажите конкретный товар и его функцию.');
  return {version:SEMANTIC_VERSION,created_at:new Date().toISOString(),profile:p,mode:'semantic',confirmed_code:null,
    candidates,total:plausible.length,groups:[...groups].sort((a,b)=>b[1]-a[1]).map(([code,share])=>({code,share:round(share),name:engine.data.nodes[code]?.description||''})),
    other_share:round(plausible.slice(limit).reduce((s,e)=>s+e.share,0)),unavailable,exact_codes:supplied.exact_codes,issues:supplied.issues,
    questions,warnings:['Проценты — относительное соответствие среди найденных вариантов, не вероятность верного кода.','Перед использованием проверьте характеристики товара и актуальность классификации.'],
    model_revision:index.model.revision,semantic_index:index.identity};
}

export function queryText(p){return [p.description,p.material&&'Материал: '+p.material,p.purpose&&'Назначение: '+p.purpose,p.construction,p.specifications,
  p.equipment==='electric'?'Для электроинструмента':p.equipment==='petrol'?'Для бензоинструмента':''].filter(Boolean).join('. ');}
