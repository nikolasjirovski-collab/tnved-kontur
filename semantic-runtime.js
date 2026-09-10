import {pipeline,env} from './vendor/transformers.min.js';
import {queryText} from './semantic.js';
const sha=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function checkedFetch(url,expected){
  const response=await fetch(url);if(!response.ok)throw Error('Не удалось загрузить данные поиска. Проверьте соединение и повторите попытку.');
  const buffer=await response.arrayBuffer();if(expected&&await sha(buffer)!==expected)throw Error('Данные поиска повреждены. Обновите страницу.');return buffer;
}
export async function unzip(buffer){return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
export async function loadSemantic(catalogHash,semanticHash,progress=()=>{}){
  progress('Подготовка смыслового поиска…');
  const index=JSON.parse(new TextDecoder().decode(await unzip(await checkedFetch(new URL('./public/semantic.json.gz',import.meta.url),semanticHash))));
  if(index.catalog_sha256!==catalogHash)throw Error('Обновите страницу, чтобы загрузить согласованные данные поиска.');
  const vectors=await unzip(await checkedFetch(new URL('./public/vectors.f32.gz',import.meta.url),index.vectors_sha256));
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;env.useBrowserCache=false;env.useCustomCache=true;
  env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  const base=new URL('./public/model/',import.meta.url);
  let weightsPromise;
  async function weights(){
    if(!weightsPromise)weightsPromise=(async()=>{
      let cached;try{cached=await caches.open('tnved-semantic-'+index.model.revision);}catch{/* Storage can be restricted. */}
      const key=new URL('assembled.onnx',base).href;const found=await cached?.match(key);
      if(found){const buffer=await found.arrayBuffer();if(await sha(buffer)===index.model.files['onnx/model_quantized.onnx'])return buffer;}
      const parts=[];let done=0;
      for(const part of index.model.parts){progress('Загрузка смыслового поиска: '+Math.round(100*done/index.model.parts.length)+'%');parts.push(await checkedFetch(new URL(part.file,base),part.sha256));done++;}
      const blob=new Blob(parts),buffer=await blob.arrayBuffer();
      if(await sha(buffer)!==index.model.files['onnx/model_quantized.onnx'])throw Error('Данные поиска повреждены.');
      try{await cached?.put(key,new Response(buffer));}catch{/* Inference still works without a persistent cache. */}
      return buffer;
    })().catch(error=>{weightsPromise=null;throw error;});
    return weightsPromise;
  }
  const jsonCache=new Map();
  env.customCache={async match(key){
    if(String(key).endsWith('/onnx/model_quantized.onnx'))return new Response(await weights());
    const file=String(key).split('/').at(-1);
    if(!Object.hasOwn(index.model.files,file))return undefined;
    if(!jsonCache.has(file))jsonCache.set(file,await checkedFetch(new URL(file,base),index.model.files[file]));
    return new Response(jsonCache.get(file));
  },async put(){}};
  progress('Запускаем смысловой поиск…');
  const encoder=await pipeline('feature-extraction',new URL('./public/model/',import.meta.url).href,{dtype:'q8',device:'wasm',local_files_only:true});
  progress('Смысловой поиск готов');
  return {index,matrix:new Float32Array(vectors),async encode(profile){
    const text=queryText(profile),tokens=await encoder.tokenizer(text,{truncation:false});
    if(tokens.input_ids.dims.at(-1)>128){const error=Error('Сократите описание: оставьте название детали, назначение, материал и ключевые характеристики.');error.code='INPUT_TOO_LONG';throw error;}
    const result=await encoder(text,{pooling:'mean',normalize:true,truncation:true,max_length:128});return result.data;
  }};
}
