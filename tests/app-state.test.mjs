// Application state contract, independent of browser rendering/visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as render from '../render.js';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
function setup(){
  const nodes=new Map(),workers=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'initial empty',textContent:'',disabled:false,hidden:false,events:{},classList:{toggle(){}},addEventListener(type,fn){this.events[type]=fn;},append(){},close(){},showModal(){},click(){},getBoundingClientRect(){return {};}});return nodes.get(id);};
  class Worker{constructor(){workers.push(this);}postMessage(message){this.last=message;}}
  const storage=new Map();
  const context=vm.createContext({...render,console,URL,Worker,Date,JSON,Promise,setTimeout,clearTimeout,crypto:globalThis.crypto,Blob,
    document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>node('created')},
    window:{addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},FormData:class{*[Symbol.iterator](){}}
  });vm.runInContext(source,context);return {context,node,worker:workers[0],storage};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('changing inputs while worker runs discards the stale result and prevents save',async()=>{
  const s=setup();s.worker.onmessage({data:{id:1,result:{code_count:1,pair_count:1,minimum_date:'2026-04-27',snapshot_date:'2026-04-27',sources:[],method:'test',built_at:'2026-09-09'}}});await tick();
  const promise=vm.runInContext("runSearch({description:'Карбюратор',as_of:'2026-09-09'})",s.context);
  const id=s.worker.last.id;s.node('product-form').events.input();
  s.worker.onmessage({data:{id,result:{candidates:[{code:'8409910008'}]}}});await assert.rejects(promise,/изменилась/);
  assert.equal(vm.runInContext('report',s.context),null);vm.runInContext('saveReport()',s.context);assert.equal(s.storage.size,0);
  assert(!s.node('results-content').innerHTML.includes('8409910008'));assert.equal(s.node('search-button').disabled,false);
});
test('worker failure is visible and does not leave a stale report',async()=>{
  const s=setup();s.worker.onmessage({data:{id:1,result:{code_count:1,pair_count:1,minimum_date:'2026-04-27',snapshot_date:'2026-04-27',sources:[],method:'test',built_at:'2026-09-09'}}});await tick();
  const promise=vm.runInContext("runSearch({description:'Карбюратор',as_of:'2026-09-09'})",s.context);
  s.worker.onmessage({data:{id:s.worker.last.id,error:'Контрольная ошибка'}});await assert.rejects(promise,/Контрольная ошибка/);
  assert(s.node('results-content').innerHTML.includes('Контрольная ошибка'));assert.equal(vm.runInContext('report',s.context),null);assert.equal(s.node('search-button').disabled,false);
});
