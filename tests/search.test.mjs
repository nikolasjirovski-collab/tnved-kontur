import test from 'node:test';
import assert from 'node:assert/strict';
import {searchProduct} from '../search.js';
import {facets,Engine} from '../engine.js';
import {publicReport,resultHTML} from '../render.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const data=JSON.parse(gunzipSync(readFileSync(new URL('../public/catalog.json.gz',import.meta.url))));
const engine=new Engine(data);
const profile=description=>({description,as_of:'2026-09-15'});

test('Russian part and equipment extraction has Unicode boundaries',()=>{
  assert.deepEqual([...facets('Карбюратор для триммера').part],['carburetor']);
  assert.deepEqual([...facets('Карбюратор для триммера').equipment],['trimmer']);
  assert.deepEqual([...facets('Цепь для бензопилы').part],['chain']);
  assert.deepEqual([...facets('Аккумулятор для шуруповёрта').equipment],['drill']);
  assert.equal(facets('abcdef').part.size,0);
});
test('exact conflicts and code lookup never depend on model availability',async()=>{
  const fail=()=>{throw Error('Must not load model');};
  const exact=await searchProduct(engine,profile('Карбюратор'),fail);
  assert.equal(exact.search_method,'exact');assert(exact.exact_codes.length>1);
  const code=await searchProduct(engine,profile('0101210000'),fail);
  assert.equal(code.candidates[0].code,'0101210000');assert.equal(code.search_method,'code');
});
test('non-exact query invokes encoder and semantic ranking',async()=>{
  let encodes=0;
  const r=await searchProduct(engine,profile('Устройство смешивания воздуха с топливом'),async()=>({
    encode:async()=>{encodes++;return [1,0];},
    index:{dimension:2,identity:'test',model:{revision:'test'},documents:[{code:'8409910008',kind:'example',text:'Карбюратор для мотокосы'}]},
    matrix:Float32Array.from([1,0])
  }));
  assert.equal(encodes,1);assert.equal(r.search_method,'semantic');assert.equal(r.candidates[0].code,'8409910008');
  assert.equal(publicReport(r).search_method,'semantic');
});
test('model failure is visible and fallback keeps code lookup usable',async()=>{
  const r=await searchProduct(engine,profile('Защитный щиток режущей головки бензокосы'),async()=>{throw Error('network');});
  assert.equal(r.search_method,'lexical-model-unavailable');
  assert.match(resultHTML(r),/Смысловой поиск недоступен/);
});

test('slow model shows partial results immediately then times out with a usable fallback',async()=>{
  let partial,encodes=0,release;
  const runtime=new Promise(resolve=>{release=resolve;});
  const r=await searchProduct(engine,profile('Защитный щиток режущей головки бензокосы'),()=>runtime,()=>{},r=>{partial=r;},()=>true,25);
  assert.equal(partial.search_method,'lexical-pending');assert(partial.candidates.length>0);
  assert(partial.candidates.every(c=>c.share===null));assert.equal(r.search_method,'lexical-model-unavailable');
  release({encode:()=>{encodes++;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(encodes,0);
});

test('a superseded query skips inference when shared model loading finishes',async()=>{
  let encodes=0;
  await searchProduct(engine,profile('Защитный щиток режущей головки бензокосы'),async()=>({encode:()=>{encodes++;}}),()=>{},()=>{},()=>false);
  assert.equal(encodes,0);
});
