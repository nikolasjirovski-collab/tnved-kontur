import {Engine} from './engine.js?v=3.0.0';
import {semanticReport} from './semantic.js?v=3.0.0';
let engine,semanticPromise,queue=Promise.resolve();
async function handle(message){
  try{
    if(message.type==='init'){
      const [mr,dr]=await Promise.all([fetch('./public/manifest.json',{cache:'no-cache'}),fetch('./public/catalog.json.gz')]);
      if(!mr.ok||!dr.ok)throw Error('Не удалось загрузить справочник. Проверьте соединение и повторите попытку.');
      const manifest=await mr.json(),buffer=await dr.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==manifest.index_sha256)throw Error('Контрольная сумма справочника не совпала. Обновите страницу: результаты не рассчитаны.');
      if(typeof DecompressionStream==='undefined')throw Error('Для этого справочника нужен современный браузер с поддержкой распаковки gzip.');
      const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      const data=JSON.parse(await new Response(stream).text());data.meta.index_sha256=hash;data.meta.semantic_sha256=manifest.semantic_sha256;engine=new Engine(data);
      self.postMessage({id:message.id,result:engine.meta});
    }else if(message.type==='classify'){
      if(!engine)throw Error('Дождитесь загрузки справочника.');
      const profile=engine.validate(message.profile);
      let result;
      if(/^\d[\d\s]*$/.test(profile.description))result=engine.classify(profile,5);
      else{
        const progress=text=>self.postMessage({id:message.id,progress:text});
        if(!semanticPromise)semanticPromise=import('./semantic-runtime.js?v=3.0.0').then(m=>m.loadSemantic(engine.meta.index_sha256,engine.meta.semantic_sha256,progress)).catch(error=>{semanticPromise=null;throw error;});
        try{
          const semantic=await semanticPromise;progress('Сравниваем описание с категориями товаров…');
          const vector=await semantic.encode(profile);
          result=semanticReport(engine,profile,vector,semantic.index,semantic.matrix,5);
        }catch(error){if(error.code==='INPUT_TOO_LONG')throw Error('Сократите описание: оставьте название детали, назначение, материал и ключевые характеристики.');throw Error('Не удалось выполнить смысловой подбор. Проверьте соединение и повторите попытку. Для первого запуска необходимо около 200 МБ свободного трафика и современный браузер.');}
      }
      self.postMessage({id:message.id,result});
    }else throw Error('Неизвестный запрос.');
  }catch(error){self.postMessage({id:message.id,error:error.message||'Не удалось выполнить подбор.'});}
}
// Keep one encoder/session active; concurrent searches cannot mix input or progress.
self.onmessage=({data})=>{queue=queue.then(()=>handle(data));};
