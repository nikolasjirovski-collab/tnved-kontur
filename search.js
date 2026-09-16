// One route shared by the live worker and integration tests.
export async function searchProduct(engine, input, getSemantic, progress=()=>{}, partial=()=>{}, isCurrent=()=>true, timeoutMs=45000) {
  const profile=engine.validate(input);
  const lexical=engine.classify(profile,5);
  if(lexical.mode==='code')return {...lexical,search_method:'code'};
  // Exact catalogue conflicts must remain visible. Similarity cannot resolve them.
  if(lexical.exact_codes.length)return {...lexical,search_method:'exact'};
  partial({...lexical,search_method:'lexical-pending',groups:[],other_share:null,
    candidates:lexical.candidates.map(c=>({...c,share:null,group_share:null}))});
  let timer,active=true;
  try {
    const inference=(async()=>{
      const {semanticReport}=await import('./semantic.js?v=4.1.0');
      const runtime=await getSemantic(progress);
      if(!active||!isCurrent())return {...lexical,search_method:'lexical-pending'};
      progress('Сравниваем смысл названия с товарами…');
      const vector=await runtime.encode(profile);
      const semantic=semanticReport(engine,profile,vector,runtime.index,runtime.matrix,5);
      return {...semantic,search_method:semantic.candidates.length?'semantic':'semantic-no-match'};
    })();
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model response timed out')),timeoutMs);});
    return await Promise.race([inference,timeout]);
  } catch(error) {
    return {...lexical,search_method:'lexical-model-unavailable'};
  } finally {active=false;clearTimeout(timer);}
}
