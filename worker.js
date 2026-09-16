import {Engine} from './engine.js?v=4.2.0';
import {searchProduct} from './search.js?v=4.2.0';
let engine,semanticPromise,latestSearch=0,encoding=Promise.resolve();
function getSemantic(progress){
  if(!semanticPromise)semanticPromise=(async()=>{
    const {loadSemantic}=await import('./semantic-runtime.js?v=4.1.0');
    const runtime=await loadSemantic(engine.meta.index_sha256,engine.meta.semantic_sha256,progress);
    const encode=runtime.encode;
    runtime.encode=profile=>{const task=encoding.then(()=>encode(profile));encoding=task.catch(()=>{});return task;};
    return runtime;
  })().catch(error=>{semanticPromise=null;throw error;});
  return semanticPromise;
}
async function handle(message){
  try{
    if(message.type==='init'){
      const [mr,dr,er]=await Promise.all([fetch('./public/manifest.json',{cache:'no-cache'}),fetch('./public/catalog.json.gz',{cache:'no-cache'}),fetch('./public/elitech.json',{cache:'no-cache'})]);
      if(!mr.ok||!dr.ok||!er.ok)throw Error('Не удалось загрузить справочник. Проверьте соединение и повторите попытку.');
      const manifest=await mr.json(),buffer=await dr.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==manifest.index_sha256)throw Error('Контрольная сумма справочника не совпала. Обновите страницу: результаты не рассчитаны.');
      if(typeof DecompressionStream==='undefined')throw Error('Для этого справочника нужен современный браузер с поддержкой распаковки gzip.');
      const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      const data=JSON.parse(await new Response(stream).text());data.elitech=await er.json();data.meta.index_sha256=hash;data.meta.semantic_sha256=manifest.semantic_sha256;engine=new Engine(data);
      self.postMessage({id:message.id,result:engine.meta});
    }else if(message.type==='classify'){
      latestSearch=message.id;
      if(!engine)throw Error('Дождитесь загрузки справочника.');
      const profile=engine.validate(message.profile);
      self.postMessage({id:message.id,progress:'Ищем по названию и синонимам…'});
      const progress=text=>self.postMessage({id:message.id,progress:text});
      // Keep UI responsive while a first-time model download is in flight.
      const heartbeat=setInterval(()=>progress('Готовим смысловой поиск. Первая загрузка может занять несколько минут…'),15000);
      let result;
      try{result=await searchProduct(engine,profile,getSemantic,progress,
        partial=>self.postMessage({id:message.id,partial}),()=>latestSearch===message.id);}
      finally{clearInterval(heartbeat);}
      self.postMessage({id:message.id,result});
    }else throw Error('Неизвестный запрос.');
  }catch(error){self.postMessage({id:message.id,error:error.message||'Не удалось выполнить подбор.'});}
}
// Catalogue queries remain available during model loading; only inference is serialized.
self.onmessage=({data})=>{handle(data);};
