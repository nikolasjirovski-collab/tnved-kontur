// Execute the shipped browser/WASM encoder as a module in Node, without UI/browser automation.
// This checks model/tokenizer/runtime compatibility and parity, not rendering or browser policy.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {Engine} from '../engine.js';
import {semanticReport} from '../semantic.js';
const savedProcess=globalThis.process;
globalThis.self=globalThis;
globalThis.process=undefined;
const runtime=await import('../semantic-runtime.js');
globalThis.process=savedProcess;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
  if(String(url).startsWith('file:')){
    try{return new Response(await readFile(new URL(url)),{headers:{'Content-Type':String(url).endsWith('.wasm')?'application/wasm':'application/octet-stream'}});}
    catch(error){if(error.code==='ENOENT')return new Response('',{status:404});throw error;}
  }
  throw Error('Runtime must not request external assets: '+url);
};
try{
  const manifest=JSON.parse(await readFile(new URL('../public/manifest.json',import.meta.url)));
  const data=JSON.parse(gunzipSync(await readFile(new URL('../public/catalog.json.gz',import.meta.url))));
  const semantic=await runtime.loadSemantic(manifest.index_sha256,manifest.semantic_sha256,console.log);
  const engine=new Engine(data);
  const fixtures=JSON.parse(await readFile(new URL('../../work/semantic_cache/evaluation.json',import.meta.url)));
  for(const fixture of fixtures){
    const profile={description:fixture.query,as_of:'2026-09-10'};
    const v=await semantic.encode(profile);
    let cosine=0,norm=0;for(let i=0;i<v.length;i++){cosine+=v[i]*fixture.vector[i];norm+=v[i]*v[i];}
    assert.equal(v.length,384);assert(Math.abs(norm-1)<.001);assert(cosine>.999,'Python/JS embeddings diverged: '+cosine);
    const report=semanticReport(engine,profile,v,semantic.index,semantic.matrix);
    console.log(JSON.stringify({query:fixture.query,parity:cosine,candidates:report.candidates.map(c=>({code:c.code,share:c.share,name:c.name})),total:report.total}));
  }
  const queries=['Кожух защитный (комплект) для триммера (бензокосы)','Карбюратор для триммера (бензокосы)','Шестерня ведомая натяжителя цепи','Ремень приводной резиновый','апельсин','asdfghjkl','абракадабракса'];
  const extra=[];
  for(const description of queries){const profile={description,as_of:'2026-09-10'},v=await semantic.encode(profile),r=semanticReport(engine,profile,v,semantic.index,semantic.matrix);extra.push({query:description,vector:Array.from(v),candidates:r.candidates});console.log(JSON.stringify({query:description,candidates:r.candidates.map(c=>({code:c.code,share:c.share,name:c.name}))}));}
  await writeFile(new URL('../../work/semantic_cache/browser-evaluation.json',import.meta.url),JSON.stringify(extra));
  await assert.rejects(semantic.encode({description:'Карбюратор '.repeat(200)}),error=>error.code==='INPUT_TOO_LONG');
  console.log('Shipped WASM inference and Python vector parity verified.');
}finally{globalThis.fetch=nativeFetch;globalThis.process=savedProcess;}
