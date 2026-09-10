import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Engine} from '../engine.js';
import {queryText,semanticReport} from '../semantic.js';
import {publicReport} from '../render.js';
try{
  const input=JSON.parse(readFileSync(0,'utf8'));
  const packed=readFileSync(new URL('../public/catalog.json.gz',import.meta.url));
  const engine=new Engine(JSON.parse(gunzipSync(packed))),profile=engine.validate(input.profile);
  const codeQuery=/^\d[\d\s]*$/.test(profile.description);
  if(input.action==='prepare')console.log(JSON.stringify({code_query:codeQuery,text:queryText(profile)}));
  else if(codeQuery)console.log(JSON.stringify(publicReport(engine.classify(profile,5))));
  else{
    const index=JSON.parse(gunzipSync(readFileSync(new URL('../public/semantic.json.gz',import.meta.url))));
    const compressed=readFileSync(new URL('../public/vectors.f32.gz',import.meta.url));
    const hash=b=>createHash('sha256').update(b).digest('hex');
    if(hash(packed)!==index.catalog_sha256||hash(compressed)!==index.vectors_sha256)throw Error('Данные поиска повреждены.');
    const raw=gunzipSync(compressed),matrix=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
    console.log(JSON.stringify(publicReport(semanticReport(engine,profile,input.vector,index,matrix))));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
