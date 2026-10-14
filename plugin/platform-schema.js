const NAME=/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const scalar=value=>['string','number','boolean'].includes(typeof value)&&String(value).length<=160;
function normalizeFields(value){
 if(!Array.isArray(value))return [];
 const seen=new Set();return value.slice(0,40).flatMap(field=>{
  if(!field||!NAME.test(field.name)||seen.has(field.name))return [];seen.add(field.name);
  const options=Array.isArray(field.options)?field.options.slice(0,150).filter(o=>o&&scalar(o.value)).map(o=>({value:o.value,label:String(o.label??o.value).slice(0,160),unavailable:o.currently_unavailable===true||o.unavailable===true,requires:Object.fromEntries(Object.entries(o.requires||{}).filter(([k,v])=>NAME.test(k)&&Array.isArray(v)).map(([k,v])=>[k,v.filter(scalar)]))})):[];
  return [{name:field.name,label:String(field.label||field.name).slice(0,100),type:String(field.type||'string'),required:field.required===true,options,maxCount:Number.isInteger(Number(field.max_count??field.max_images??field.upload_limits?.max_count??field.upload_limits?.最大数量))&&Number(field.max_count??field.max_images??field.upload_limits?.max_count??field.upload_limits?.最大数量)>0?Math.min(20,Number(field.max_count??field.max_images??field.upload_limits?.max_count??field.upload_limits?.最大数量)):null}];
 });
}
function restoreFields(fields){return normalizeFields((fields||[]).map(f=>({...f,max_count:f.maxCount,options:f.options?.map(o=>({...o,currently_unavailable:o.unavailable}))})));}
module.exports={normalizeFields,restoreFields};
