function unwrap(value) { return value && value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value; }
function providerError(payload, status) {
  const error=payload?.error;
  const detail=typeof error==='string'?error:[error?.message,error?.msg,error?.detail,error?.type,error?.code,payload?.message,payload?.msg,payload?.detail,payload?.code].find(value=>typeof value==='string'&&value.trim());
  const safe=typeof detail==='string'?detail.replace(/(Bearer\s+|sk[-_])[A-Za-z0-9._-]+/gi,'$1[隐藏]').slice(0,300):'';
  return safe||'接口请求失败（HTTP '+status+'，平台返回业务错误但未给出原因）。';
}
function imageSources(payload) {
  const output=[];
  const resultKeys=new Set(['image','images','image_url','image_urls','output','outputs','output_url','output_urls','image_output_url','result','results','result_url','result_urls','fileuri','file_uri','url','urls','uri','src','download_url','download_urls','generated_images','artifacts']);
  const base64Keys=new Set(['b64_json','base64','image_base64']);
  function visit(value,key='',inResult=false,depth=0){
    if(depth>30)return;
    const context=inResult||resultKeys.has(key);
    if(typeof value==='string'){
      const text=value.trim();
      if(/^[\[{]/.test(text)){try{visit(JSON.parse(text),key,context,depth+1);}catch(_){}return;}
      if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text))output.push(text);
      else if(base64Keys.has(key)&&/^[A-Za-z0-9+/=]+$/.test(text))output.push('data:image/png;base64,'+text);
      else if(context&&/^https?:\/\/[^\s]+$/i.test(text)){try{const url=new URL(text);if(!url.username&&!url.password)output.push(text);}catch(_){}}
    }else if(Array.isArray(value))value.forEach(item=>visit(item,key,context,depth+1));
    else if(value&&typeof value==='object'){
      const inline=value.inlineData||value.inline_data;
      if(inline&&typeof inline.data==='string'&&/^[A-Za-z0-9+/=]+$/.test(inline.data)&&/^image\/(png|jpeg|webp)$/i.test(inline.mimeType||inline.mime_type||'image/png'))output.push('data:'+(inline.mimeType||inline.mime_type||'image/png')+';base64,'+inline.data);
      Object.keys(value).forEach(name=>{if(!['inlineData','inline_data','error','message','prompt','input','metadata','input_images','reference_images','params','request','request_body'].includes(name))visit(value[name],name.toLowerCase(),context&&!['error','message','prompt','input','metadata'].includes(name.toLowerCase()),depth+1);});
    }
  }
  visit(payload);return [...new Set(output)];
}
function taskIdentifier(payload) {
  const seen=new Set();
  function read(value,depth=0,taskContext=false){
    if(depth>6||!value||typeof value!=='object'||seen.has(value))return '';
    seen.add(value);
    if(Array.isArray(value))return value.length===1?read(value[0],depth+1,taskContext):'';
    for(const key of ['task_id','taskId','taskID','job_id','jobId',...(taskContext?['id']:[])]){
      const id=value[key];if((typeof id==='string'&&id.trim())||(typeof id==='number'&&Number.isFinite(id)))return String(id).trim();
    }
    for(const key of ['data','result','task','job']){let child=value[key];if(typeof child==='string'){try{child=JSON.parse(child);}catch{continue;}}const id=read(child,depth+1,taskContext||key==='task'||key==='job');if(id)return id;}
    return '';
  }
  return read(payload);
}

module.exports={unwrap,providerError,imageSources,taskIdentifier};
