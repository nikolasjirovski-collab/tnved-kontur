import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Engine,toolContext} from '../engine.js';
import {nearestCodes,normalizeVector,semanticReport,queryText,partKind} from '../semantic.js';
const data=JSON.parse(gunzipSync(readFileSync(new URL('../public/catalog.json.gz',import.meta.url))));
const engine=new Engine(data);
const index={dimension:2,model:{revision:'test'},identity:'test',documents:[
 {code:'8409910008',kind:'example',text:'Карбюратор для мотокосы'},
 {code:'8409990009',kind:'example',text:'Карбюратор'},
 {code:'8467990001',kind:'example',text:'Корпус перфоратора'}]};
const matrix=Float32Array.from([.8,.6,.8,.6,0,1]);
const p={description:'Устройство смешивания воздуха с топливом',as_of:'2026-09-10'};

test('semantic candidates need no lexical overlap or exact object word',()=>{const r=semanticReport(engine,p,[1,0],index,matrix);assert(r.candidates.some(c=>c.code==='8409910008'));assert.equal(r.mode,'semantic');assert.equal(r.confirmed_code,null);});
test('duplicate descriptions cannot vote for a code',()=>{const a=nearestCodes([1,0],index,matrix),b=nearestCodes([1,0],{...index,documents:[...index.documents,index.documents[0]]},Float32Array.from([...matrix,.8,.6]));assert.deepEqual(a,b);});
test('vector dimensions and non-finite inputs fail closed',()=>{assert.throws(()=>normalizeVector([NaN,0]));assert.throws(()=>normalizeVector([0,0]));assert.throws(()=>nearestCodes([1],index,matrix));});
test('weak semantic similarities abstain without inventing a code',()=>{const r=semanticReport(engine,p,[-1,0],index,matrix);assert.equal(r.candidates.length,0);assert.equal(r.groups.length,0);assert.equal(r.confirmed_code,null);});
test('full-code lookup does not need an encoder and keeps leading zeros',()=>{const r=semanticReport(engine,{...p,description:'0101210000'},null,null,null);assert.equal(r.candidates[0].code,'0101210000');assert.equal(r.candidates[0].share,null);});
test('display limit does not change percentages; hidden share and groups balance',()=>{const full=semanticReport(engine,p,[1,0],index,matrix),one=semanticReport(engine,p,[1,0],index,matrix,1);assert.equal(full.candidates[0].share,one.candidates[0].share);assert(Math.abs(one.candidates[0].share+one.other_share-100)<.001);assert(Math.abs(full.groups.reduce((s,g)=>s+g.share,0)-100)<.001);});
test('expired codes receive no share',()=>{const old={...index,documents:[{code:'1234567890',text:'Карбюратор',kind:'example'}]};const r=semanticReport(engine,p,[1,0],old,Float32Array.from([1,0]));assert.equal(r.total,0);assert.equal(r.unavailable[0].code,'1234567890');});
test('drive type penalizes incompatible tool context without changing code format',()=>{assert(toolContext({equipment:'petrol'},'Части инструментов со встроенным электрическим двигателем').incompatible);assert(toolContext({equipment:'electric'},'Карбюратор бензопилы').incompatible);assert(!toolContext({equipment:'all'},'Ремень привода').incompatible);assert(toolContext({equipment:'all'},'Карбюратор автомобиля').unrelated);});
test('query includes supplied characteristics; unspecified drive does not dilute the meaning',()=>{assert.equal(queryText({description:'Карбюратор',equipment:'all'}),'Карбюратор');assert(queryText({description:'Корпус',material:'сталь',equipment:'electric'}).includes('сталь. Для электроинструмента'));});

test('a component is not confused with the assembly it belongs to',()=>{
  assert.equal(partKind('Прокладка карбюратора'),'gasket');assert.equal(partKind('Вал шестерни'),'shaft');
  assert.equal(partKind('Изолятор карбюратора'),null);assert.equal(partKind('Крышка кожуха защитного'),'cover');
  assert.equal(partKind('Устройство смешивания бензина с воздухом для двигателя мотокосы'),null);
});

test('shipped dense index matches catalog and contains only finite unit vectors',()=>{
  const bytes=readFileSync(new URL('../public/semantic.json.gz',import.meta.url)),s=JSON.parse(gunzipSync(bytes));
  const compressed=readFileSync(new URL('../public/vectors.f32.gz',import.meta.url));
  assert.equal(createHash('sha256').update(compressed).digest('hex'),s.vectors_sha256);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../public/catalog.json.gz',import.meta.url))).digest('hex'),s.catalog_sha256);
  const raw=gunzipSync(compressed),v=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
  assert.equal(v.length,s.documents.length*384);assert(s.documents.length>15000);assert(s.documents.every(d=>/^\d{10}$/.test(d.code)));
  for(let i=0;i<v.length;i+=384){let norm=0;for(let j=0;j<384;j++)norm+=v[i+j]*v[i+j];assert(Number.isFinite(norm)&&Math.abs(norm-1)<.001);}
});

test('real embedding regressions: named parts, paraphrases and unreadable input',()=>{
  const s=JSON.parse(gunzipSync(readFileSync(new URL('../public/semantic.json.gz',import.meta.url))));
  const raw=gunzipSync(readFileSync(new URL('../public/vectors.f32.gz',import.meta.url))),v=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
  const fixtures=JSON.parse(readFileSync(new URL('./fixtures/semantic-queries.json',import.meta.url)));
  const run=q=>{const f=fixtures.find(x=>x.query===q);return semanticReport(engine,{description:q,as_of:'2026-09-10'},f.vector,s,v);};
  const carb=run('Карбюратор для триммера (бензокосы)');assert.equal(carb.candidates[0].code,'8409910008');assert(carb.candidates.every(c=>c.code.startsWith('8409')));
  const gear=run('Шестерня ведомая натяжителя цепи');assert(gear.candidates.length);assert(gear.candidates.every(c=>c.code.startsWith('848390')));
  const functional=run('Устройство смешивания бензина с воздухом для двигателя мотокосы');assert(functional.candidates.some(c=>c.code==='8409910008'));assert(functional.candidates.every(c=>c.code.startsWith('8409')));
  const guard=run('Защитный щиток режущей головки бензокосы');assert(guard.candidates.length);assert(!guard.candidates.some(c=>c.code.startsWith('65')||c.code==='8467990001'));
  assert(!guard.candidates.some(c=>/глушител|ремней/iu.test(c.name)));
  const belt=run('Ремень приводной резиновый');assert(belt.candidates.length);assert(!belt.candidates.some(c=>c.code.startsWith('39')));
  for(const q of ['asdfghjkl','абракадабракса'])assert.equal(run(q).total,0);
});
