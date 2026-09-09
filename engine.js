export const VERSION = 'web-hierarchical-support-v1';
const intersect = (a,b) => new Set([...a].filter(x=>b.has(x)));
const union = (a,b) => new Set([...a,...b]);
const cov = (a,b) => a.size ? intersect(a,b).size / a.size : 0;
const round = (n,p=4) => Number(n.toFixed(p));
const beforeFor = s => s.split(/(?<![а-яёa-z])для(?![а-яёa-z])/iu)[0];
export const normalize = s => s.normalize('NFKC').toLowerCase().replaceAll('ё','е').match(/[\p{L}\p{N}_]+/gu)?.join(' ') || '';
export const validOn = (r,day) => (!r.start || r.start<=day) && (!r.end || r.end>=day);

export function makeTokenizer(config) {
  const stop=new Set(config.stop);
  return value=>{
    const result=new Set();
    for(const word of value.toLowerCase().replaceAll('ё','е').match(/[a-zа-я0-9]+/g)||[]) {
      if(stop.has(word)||word.length<2)continue;
      let stem=word;
      if(/^[а-я]+$/.test(word))for(const suffix of config.suffixes){
        if(word.endsWith(suffix)&&word.length-suffix.length>=3){stem=word.slice(0,-suffix.length);break;}
      }
      result.add(config.synonyms[stem]||stem);
    }
    return new Set([...result].sort());
  };
}

export function hierarchyShares(scores) {
  const shares={},groups={},positions={};
  function split(codes,width,mass){
    const branches=new Map();
    for(const c of codes){const p=c.slice(0,width);if(!branches.has(p))branches.set(p,[]);branches.get(p).push(c);}
    const weights=[...branches].map(([p,m])=>[p,m,Math.max(...m.map(c=>scores[c]))**2]);
    const total=weights.reduce((a,x)=>a+x[2],0);
    for(const [p,m,w] of weights){const s=mass*w/total;if(width===2)groups[p]=s;if(width===4)positions[p]=s;
      if(width===10)shares[p]=s;else split(m,width+2,s);}
  }
  if(Object.keys(scores).length)split(Object.keys(scores).sort(),2,100);
  return {shares,groups,positions};
}

export class Engine {
  constructor(data){
    this.data=data;this.meta=data.meta;this.tokenize=makeTokenizer(data.tokenizer);this.materials=new Set(data.materials);
    this.records=data.records.map(r=>({...r,terms:new Set(r.terms),objects:new Set(r.objects),heading:data.strings[r.heading],chapter:data.strings[r.chapter]}));
    this.entries=data.entries.map(e=>({...e,terms:new Set(e.terms),expanded:this.terms(e.name),objects:this.objects(e.name)}));
    this.exact=new Map();this.inverted=new Map();
    this.entries.forEach((e,i)=>{
      if(e.kind==='xlsx'){if(!this.exact.has(e.normalized))this.exact.set(e.normalized,[]);this.exact.get(e.normalized).push(i);}
      for(const t of e.terms){if(!this.inverted.has(t))this.inverted.set(t,[]);this.inverted.get(t).push(i);}
    });
  }
  terms(value){const t=this.tokenize(value);if(t.has('шестерн'))for(const x of this.tokenize('колеса зубчатые'))t.add(x);return t;}
  objects(value){
    const result=new Set();
    for(const p of value.split(/[;,(]/)){
      const words=(beforeFor(p).toLowerCase().match(/[а-яёa-z]+/g)||[]).filter(w=>this.tokenize(w).size);
      if(!words.length)continue;
      for(const t of this.terms(words[0]))result.add(t);
      if(words.length>1&&/(ые|ая|ое|ий|ый|ие)$/.test(words[0]))for(const t of this.terms(words[1]))result.add(t);
    }return result;
  }
  path(code){return [2,4,6,8,9,10].map(n=>this.data.nodes[code.slice(0,n)]).filter(Boolean);}
  validate(input){
    const allowed=['description','material','purpose','construction','specifications','as_of','source'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Неизвестные поля карточки товара.');
    if(Object.values(input).some(v=>typeof v!=='string'||v.length>10000))throw Error('Некорректный формат описания.');
    const p=Object.fromEntries(allowed.map(k=>[k,(input[k]||'').trim()]));
    if(!p.description)throw Error('Введите название товара или код.');
    if(p.source&&!this.meta.sources.includes(p.source))throw Error('Неизвестный каталог.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.as_of)||!Number.isFinite(Date.parse(p.as_of))||new Date(p.as_of).toISOString().slice(0,10)!==p.as_of)throw Error('Укажите корректную дату операции.');
    if(p.as_of<this.meta.minimum_date)throw Error('Веб-версия содержит срезы с '+this.meta.minimum_date+'. Для более ранней даты используйте настольную историю номенклатуры.');
    return p;
  }
  customerSearch(p){
    const norm=normalize(p.description),qt=this.tokenize(p.description);
    const scope=e=>!p.source||Object.hasOwn(e.counts,p.source);
    const issues=this.data.issues.filter(i=>normalize(i.name)===norm&&(!p.source||i.file===p.source));
    const exact=(this.exact.get(norm)||[]).map(i=>this.entries[i]).filter(scope);
    if(exact.length)return {hits:exact.map(e=>({...e,match:'exact'})),issues,exact_codes:[...new Set(exact.map(e=>e.code))].sort()};
    if(issues.length)return {hits:[],issues,exact_codes:[]};
    const indices=new Set();for(const t of qt)for(const i of this.inverted.get(t)||[])indices.add(i);
    const anchor=(p.description.toLowerCase().match(/[а-яёa-z0-9]+/g)||[]).map(w=>[...this.tokenize(w)][0]).find(Boolean);
    let selected=[];
    for(const i of indices){
      const e=this.entries[i];if(!scope(e)||anchor&&!e.terms.has(anchor))continue;
      const common=intersect(qt,e.terms),coverage=cov(qt,e.terms);
      if(coverage<(qt.size<=2?1:.5))continue;
      const first=(e.name.toLowerCase().match(/[а-яёa-z]+/g)||[]).map(w=>[...this.tokenize(w)][0]).find(Boolean);
      const primary=first===anchor;
      const relevance=100*coverage+30*common.size/Math.max(1,e.terms.size)+(primary?60:0)+(e.normalized.startsWith(norm)?15:0)-(e.kind==='pdf'?60:0);
      selected.push({...e,match:'similar',relevance,primary});
    }
    if(selected.some(e=>e.primary&&e.kind==='xlsx'))selected=selected.filter(e=>e.primary);
    selected.sort((a,b)=>b.relevance-a.relevance||a.code.localeCompare(b.code)||a.name.localeCompare(b.name));
    return {hits:selected,issues,exact_codes:[]};
  }
  score(p,r,hits,query,objects){
    let best=null;
    for(const h of [null,...hits]){
      if(!intersect(objects,h?h.objects:r.objects).size)continue;
      const target=h?union(r.terms,h.expanded):r.terms;
      const fields={};let score=0,weights=0;
      for(const [f,w] of Object.entries(this.data.weights)){
        if(!query[f].size)continue;
        const t=f==='material'&&(r.heading+' '+r.specific).toLowerCase().includes('черных металлов')?union(target,this.tokenize('сталь чугун')):target;
        fields[f]={coverage:round(cov(query[f],t)),matched:[...intersect(query[f],t)].sort(),missing:[...query[f]].filter(x=>!t.has(x)).sort()};
        score+=w*fields[f].coverage;weights+=w;
      }
      score/=weights;
      if(h)score=Math.min(1,score+(h.kind==='xlsx'?(h.match==='exact'?.12:.04):.01));
      let requested=intersect(query.material,this.materials);if(!requested.size)requested=intersect(query.description,this.materials);
      const text=r.specific+(h?' '+h.name:'');const candidate=intersect(this.terms(text),this.materials);const contradictions=[];
      if(requested.size&&candidate.size===1&&!intersect(requested,candidate).size){score*=.15;contradictions.push('Материал в описании варианта отличается от указанного: '+[...candidate].join(', '));}
      if(/бензокос|бензинов/i.test(Object.keys(this.data.weights).map(f=>p[f]).join(' '))&&text.toLowerCase().includes('инструментов со встроенным электрическим двигателем')){score*=.15;contradictions.push('Бензиновый привод сопоставлен с ветвью для встроенного электродвигателя.');}
      if(score>0&&(!best||score>best.score))best={score,fields,contradictions,hit:h,coverage:cov(query.description,target)};
    }return best;
  }
  publicHit(h,source){return {name:h.name,code:h.code,match:h.match,kind:h.kind,refs:h.refs.filter(r=>!source||r[0]===source),reference_count:Object.entries(h.counts).filter(([f])=>!source||source===f).reduce((n,[,v])=>n+v,0)};}
  classify(input,limit=20){
    const p=this.validate(input);limit=Math.max(1,Math.min(100,Number(limit)||20));
    const compact=p.description.replace(/\s/g,'');const codeQuery=/^\d+$/.test(compact);
    if(codeQuery&&![2,4,6,8,9,10].includes(compact.length))throw Error('Введите код из 10 цифр или префикс длиной 2, 4, 6, 8 или 9 цифр.');
    if(!codeQuery&&!this.tokenize(p.description).size)throw Error('Укажите конкретное название изделия.');
    const active=new Map(this.records.filter(r=>validOn(r,p.as_of)).map(r=>[r.code,r]));
    const supplied=codeQuery?{hits:this.entries.filter(e=>e.code.startsWith(compact)&&(!p.source||Object.hasOwn(e.counts,p.source))).map(e=>({...e,match:'code'})),issues:[],exact_codes:[]}:this.customerSearch(p);
    const hitsByCode=new Map();for(const h of supplied.hits){if(!hitsByCode.has(h.code))hitsByCode.set(h.code,[]);hitsByCode.get(h.code).push(h);}
    const query=Object.fromEntries(Object.keys(this.data.weights).map(f=>[f,this.terms(p[f])]));const objects=this.objects(beforeFor(p.description));
    let evaluations=[];
    for(const [code,r] of active){
      if(p.source&&!hitsByCode.has(code))continue;
      if(codeQuery){if(code.startsWith(compact))evaluations.push({code,r,score:1,fields:{},contradictions:[],hit:hitsByCode.get(code)?.[0]||null});continue;}
      const ev=this.score(p,r,hitsByCode.get(code)||[],query,objects);
      if(ev&&ev.coverage>=.34)evaluations.push({code,r,...ev});
    }
    const top=Math.max(0,...evaluations.map(e=>e.score));
    if(!codeQuery)evaluations=evaluations.filter(e=>e.score>=Math.max(.08,top*.25));
    const scores=Object.fromEntries(evaluations.map(e=>[e.code,e.score]));
    const distribution=codeQuery?{shares:{},groups:{},positions:{}}:hierarchyShares(scores);
    evaluations.sort((a,b)=>codeQuery?a.code.localeCompare(b.code):(distribution.shares[b.code]-distribution.shares[a.code]||b.score-a.score||a.code.localeCompare(b.code)));
    const unavailable=[];
    for(const [code,hits] of hitsByCode)if(!active.has(code))unavailable.push({code,name:hits[0].name,source:this.publicHit(hits[0],p.source),reason:'Нет записи на выбранную дату в локальном срезе ФНС. Код показан без процентов.'});
    if(!p.source){
      for(const [code,n] of Object.entries(this.data.nodes)){
        if(code.length!==10||active.has(code)||hitsByCode.has(code))continue;
        const path=this.path(code),names=path.filter(n=>n.code.length>=4).map(n=>n.description);
        const r={code,heading:this.data.nodes[code.slice(0,4)]?.description||'',specific:n.description+' '+names.join(' '),terms:this.terms(names.join(' ')),objects:this.objects(n.description)};
        const ev=codeQuery?null:this.score(p,r,[],query,objects);
        if(codeQuery?code.startsWith(compact):ev&&ev.coverage>=.5&&ev.score>=.5)unavailable.push({code,name:n.description,url:n.url,reason:'Найден в CSV, но отсутствует на выбранную дату в срезе ФНС. Без процентной оценки.'});
      }
    }
    const branchTable=(values,field)=>Object.entries(values).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([code,share])=>({code,share:round(share),name:this.data.nodes[code]?.description||evaluations.find(e=>e.code.startsWith(code))?.r[field]||''}));
    const candidates=evaluations.slice(0,limit).map(e=>({code:e.code,name:e.hit?.name||this.data.nodes[e.code]?.description||e.r.description,
      description:e.r.description,heading:e.r.heading,chapter:e.r.chapter,start:e.r.start,end:e.r.end,line:e.r.line,
      share:codeQuery?null:round(distribution.shares[e.code]),group_share:codeQuery?null:round(distribution.groups[e.code.slice(0,2)]),
      fields:e.fields,contradictions:e.contradictions,score:round(e.score*100),path:this.path(e.code),
      notes:{chapter:this.data.strings[e.r.chapter_notes],section:this.data.strings[e.r.section_notes]},
      hits:(e.hit?[e.hit,...(hitsByCode.get(e.code)||[]).filter(h=>h!==e.hit)]:(hitsByCode.get(e.code)||[])).slice(0,5).map(h=>this.publicHit(h,p.source)),
      requirements:this.requirements(e.code)}));
    const guides=this.data.guidance.families.filter(g=>g.triggers.some(t=>p.description.toLowerCase().includes(t)));
    const labels={material:'материал и состав',purpose:'назначение и модель оборудования',construction:'конструкцию и комплектность',specifications:'размеры и технические параметры'};
    const questions=[...Object.entries(labels).filter(([f])=>!p[f]).map(([,l])=>'Уточните '+l+'.'),...guides.flatMap(g=>g.questions)];
    const warnings=['Проценты — относительное соответствие среди найденных вариантов, а не вероятность правильного кода. Даже 100% не подтверждают классификацию.',
      'Срез ФНС: 27.04.2026. Актуальность кодов и нормативных требований на дату операции необходимо сверить с ЕЭК.',
      'Дерево CSV содержит ссылки classifikators.ru. Полнота и дата его редакции не подтверждены.',
      'Примеры из пользовательских каталогов не являются проверенными классификационными решениями. Числа, отрицания и исключения требуют отдельного сопоставления.'];
    if(supplied.exact_codes.length>1)warnings.push('В каталогах одному точному названию соответствуют разные коды: '+supplied.exact_codes.join(', ')+'.');
    return {version:VERSION,created_at:new Date().toISOString(),profile:p,confirmed_code:null,mode:codeQuery?'code':'automatic',
      snapshot_date:this.meta.snapshot_date,source_hashes:this.meta.source_hashes,index_sha256:this.meta.index_sha256,
      candidates,total:evaluations.length,groups:branchTable(distribution.groups,'chapter'),positions:branchTable(distribution.positions,'heading'),
      other_share:codeQuery?null:round(evaluations.slice(limit).reduce((s,e)=>s+distribution.shares[e.code],0)),
      unavailable,exact_codes:supplied.exact_codes,issues:supplied.issues,questions,warnings,guidance:guides};
  }
  requirements(code){
    const matches=[];
    for(const [source,rows,key] of [['ПП № 2425',this.data.pp,'codes_text'],['Санитарный перечень',this.data.sgr,'code_text']]){
      for(const row of rows){const expression=row[key]||'';if(screenCode(code,expression))matches.push({source,id:row.id,expression,record:row});}
    }
    return {status:'Применимость требований не установлена',matches,note:'Это кодовые совпадения с локальными перечнями. Отсутствие совпадений не означает отсутствие требований. Отказное письмо не заменяет проверку применимости.'};
  }
}

// Screening only; unsupported syntax never becomes a negative legal conclusion.
export function screenCode(code,expression){
  const text=expression.toLowerCase().replaceAll('\u00a0',' ').replace(/\d[\d \t]*\d|\d/g,s=>s.replace(/[ \t]/g,''));
  const parts=text.split('кроме');if(parts.length>2)return false;
  const ranges=[];
  for(const part of parts){
    const matches=[...part.matchAll(/(?<!\d)(\d{2,10})(?:\s*[-–—]\s*(\d{2,10}))?(?!\d)/g)];
    let rest=part;const list=[];
    for(const m of matches){const a=m[1],b=m[2]||a;if(a.length!==b.length||a>b)return false;list.push([a,b]);rest=rest.replace(m[0],'');}
    rest=rest.replace(/(?<![а-я])из(?![а-я])|\(трубы\)|\(фитинги\)|[\s,;().]/g,'');if(rest)return false;
    ranges.push(list);
  }
  const hit=list=>list?.some(([a,b])=>a<=code.slice(0,a.length)&&code.slice(0,a.length)<=b);
  return Boolean(hit(ranges[0])&&!hit(ranges[1]));
}
