import {Engine} from './engine.js?v=4.0.0';
let engine,queue=Promise.resolve();
async function handle(message){
  try{
    if(message.type==='init'){
      const [mr,dr,er]=await Promise.all([fetch('./public/manifest.json',{cache:'no-cache'}),fetch('./public/catalog.json.gz'),fetch('./public/elitech.json')]);
      if(!mr.ok||!dr.ok||!er.ok)throw Error('Не удалось загрузить справочник. Проверьте соединение и повторите попытку.');
      const manifest=await mr.json(),buffer=await dr.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==manifest.index_sha256)throw Error('Контрольная сумма справочника не совпала. Обновите страницу: результаты не рассчитаны.');
      if(typeof DecompressionStream==='undefined')throw Error('Для этого справочника нужен современный браузер с поддержкой распаковки gzip.');
      const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      const data=JSON.parse(await new Response(stream).text());data.elitech=await er.json();data.meta.index_sha256=hash;data.meta.semantic_sha256=manifest.semantic_sha256;engine=new Engine(data);
      self.postMessage({id:message.id,result:engine.meta});
    }else if(message.type==='classify'){
      if(!engine)throw Error('Дождитесь загрузки справочника.');
      const profile=engine.validate(message.profile);
      self.postMessage({id:message.id,progress:'Ищем по названию и синонимам…'});
      const result=engine.classify(profile,5);
      self.postMessage({id:message.id,result});
    }else throw Error('Неизвестный запрос.');
  }catch(error){self.postMessage({id:message.id,error:error.message||'Не удалось выполнить подбор.'});}
}
// Keep one encoder/session active; concurrent searches cannot mix input or progress.
self.onmessage=({data})=>{queue=queue.then(()=>handle(data));};
