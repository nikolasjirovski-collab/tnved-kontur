// One route shared by the live worker and integration tests.
export async function searchProduct(engine, input, getSemantic, progress=()=>{}) {
  const profile=engine.validate(input);
  const lexical=engine.classify(profile,5);
  if(lexical.mode==='code')return {...lexical,search_method:'code'};
  // Exact catalogue conflicts must remain visible. Similarity cannot resolve them.
  if(lexical.exact_codes.length)return {...lexical,search_method:'exact'};
  try {
    const {semanticReport}=await import('./semantic.js?v=4.1.0');
    const runtime=await getSemantic(progress);
    progress('Сравниваем смысл названия с товарами…');
    const vector=await runtime.encode(profile);
    const semantic=semanticReport(engine,profile,vector,runtime.index,runtime.matrix,5);
    if(semantic.candidates.length)return {...semantic,search_method:'semantic'};
    return {...semantic,search_method:'semantic-no-match'};
  } catch(error) {
    return {...lexical,search_method:'lexical-model-unavailable'};
  }
}
