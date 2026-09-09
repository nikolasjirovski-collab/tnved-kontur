import {Engine} from './engine.js';
let engine;
self.onmessage=async ({data:message})=>{
  try{
    if(message.type==='init'){
      const [mr,dr]=await Promise.all([fetch('./public/manifest.json',{cache:'no-cache'}),fetch('./public/catalog.json.gz')]);
      if(!mr.ok||!dr.ok)throw Error('Не удалось загрузить справочник. Проверьте соединение и повторите попытку.');
      const manifest=await mr.json(),buffer=await dr.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==manifest.index_sha256)throw Error('Контрольная сумма справочника не совпала. Обновите страницу: результаты не рассчитаны.');
      if(typeof DecompressionStream==='undefined')throw Error('Для этого справочника нужен современный браузер с поддержкой распаковки gzip.');
      const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      const data=JSON.parse(await new Response(stream).text());data.meta.index_sha256=hash;engine=new Engine(data);
      self.postMessage({id:message.id,result:engine.meta});
    }else if(message.type==='classify'){
      if(!engine)throw Error('Дождитесь загрузки справочника.');
      self.postMessage({id:message.id,result:engine.classify(message.profile,message.limit)});
    }else throw Error('Неизвестный запрос.');
  }catch(error){self.postMessage({id:message.id,error:error.message||'Не удалось выполнить подбор.'});}
};
