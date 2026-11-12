/* LK888 media protocol, independently implemented from public client evidence.
 * Protocol reference: Corkery520/ComfyUI-MengBaoAI/api/image_client.py.
 * No API keys, prompts or image payloads are logged.
 */
const MODELS = [
  { id: 'banana-2', label: 'Nano Banana 2' },
  { id: 'gemini-nano-banana-2.1', label: 'Banana 2.1' },
  { id: 'banana-pro', label: 'Nano Banana Pro' },
  { id: 'tt-image-2', label: 'GPT Image 2' },
  { id: 'tt-image-2.5', label: 'GPT Image 2.5' },
  { id: 'doubao-seedream-5-0-pro-260628', label: '即梦 5.0 Pro' },
  { id: 'gk-image-2.0', label: 'GK Image 2.0' },
  { id: 'qwen-image-max', label: '千问 Image Max' },
  { id: 'custom', label: '其他模型（自定义 ID）' }
];
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
class MediaClient {
  constructor(key, fetchImpl = fetch) {
    this.key = key; this.fetch = fetchImpl; this.base = 'https://api.lk888.ai'; this.useLocalRelay=fetchImpl===fetch;
  }
  async request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), path.startsWith('/v1/media/generate') ? 300000 : 60000);
    try {
      const response = await this.fetch(this.base + path, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      let payload;
      try { payload = await response.json(); } catch (_) { throw new Error('平台返回了无法识别的响应。'); }
      if (!response.ok || payload?.error || unwrap(payload)?.error || payload?.success === false || unwrap(payload)?.success === false) {
        payload = unwrap(payload)?.error ? unwrap(payload) : payload;
        const error = payload.error;
        const failure=new Error(providerError(payload,response.status));
        if(payload?.success===false || unwrap(payload)?.success===false) failure.terminal=true;
        if (response.status === 502) throw new Error('LK888 上游模型返回 502，模型暂不可用或平台请求超时。请稍后重试，并先在 LK888 确认任务状态，避免重复提交。'+(error?.message?' 原因：'+error.message:''));
        if (/PROHIBITED_CONTENT|content_policy|safety.*block|内容.*(?:拦截|阻止|策略)/i.test(JSON.stringify(payload))){failure.terminal=true;failure.code='PROHIBITED_CONTENT';failure.message='生成失败：上游内容审核拦截（PROHIBITED_CONTENT），未返回图片。'+(/退款|refund/i.test(JSON.stringify(payload))?' 平台提示已退款。':'')+' 请检查输入图片与提示词，按平台规则调整后再生成。';}
        else if ([400,401,403,404,422,503].includes(Number(response.status))) failure.terminal=true;
        throw failure;
      }
      return payload;
    } catch (error) {
      const phase = path.startsWith('/v1/media/generate') ? '提交生图任务' : path.startsWith('/v1/media/status') ? '查询原任务' : '检查连接';
      if (/network|fetch|abort|timeout/i.test(error.message || '') || error.name === 'AbortError') {
        const failure=new Error(phase + '时网络连接失败或超时。' + (body ? '提交结果不确定，请到平台确认任务，勿重复生成。' : '可再次查询，不会重复提交生图任务。'));
        failure.terminal=false;failure.uncertain=!!body;
        throw failure;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async submit(model, prompt, images, params = {}, submissionId) {
    if(model==='gemini-nano-banana-2.1'){
      const available=await this.models();
      const exact=available.find(item=>item.id===model);
      const alternatives=available.filter(item=>/banana[\s._-]*2[._-]1(?:$|[\s._/-])/i.test(item.id));
      if(exact)model=exact.id;
      else if(alternatives.length===1)model=alternatives[0].id;
      else {const error=new Error('当前平台未返回可唯一确认的 Banana 2.1 模型 ID；尚未提交生图任务。请在设置中刷新平台模型。');error.terminal=true;throw error;}
    }
    if(this.useLocalRelay)return this.relaySubmission({model,prompt,params:{...params,images}},submissionId);
    const payload = await this.request('/v1/media/generate', { model, prompt, params: { ...params, images } });
    const taskId = taskIdentifier(payload);
    if (taskId) return taskId;
    const completedImages=imageSources(payload);
    if(completedImages.length)return {images:completedImages};
    const failure=new Error('平台未返回任务编号或生成图片，提交结果待确认。请先到平台确认任务，勿重复生成。');
    failure.uncertain=true;
    failure.responseShape=payload&&typeof payload==='object'?Object.keys(payload).slice(0,20).join(','):'non-object';
    throw failure;
  }
  async relaySubmission(payload,submissionId){
    const base='http://127.0.0.1:17402/api/bridge';
    const requestId=submissionId||('ps-'+Date.now()+'-'+Math.random().toString(36).slice(2));
    const call=async(path,body)=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
      try{
        const response=await this.fetch(base+path,{method:body?'POST':'GET',signal:controller.signal,credentials:'omit',headers:{'X-Cine-Bridge':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'本机后台请求失败。'),{status:response.status});return data;
      }finally{clearTimeout(timer);}
    };
    try{const health=await call('/health');if(!health.ok)throw new Error('服务未就绪');}catch{throw Object.assign(new Error('影词本机后台尚未连接，未提交生图。请打开影词后重试。'),{terminal:true});}
    let record;
    try{record=await call('/media/submit',{key:this.key,payload,requestId});}
    catch(error){if(error.status)throw Object.assign(error,{terminal:true});try{record=await call('/media/submit',{key:this.key,payload,requestId});}catch{throw Object.assign(new Error('本机提交连接中断，后台可能已接单。请勿重复生成；原提交编号已保存。'),{uncertain:true,submissionRequestId:requestId});}}
    const deadline=Date.now()+6*60*1000;let failures=0;
    while(Date.now()<deadline){
      if(record.state==='accepted'&&record.taskId)return record.taskId;
      if(record.state==='complete'&&record.images?.length)return {images:record.images};
      if(['failed','uncertain'].includes(record.state)){
        const diag=record.diagnostic;const detail=diag?'（HTTP '+diag.httpStatus+(diag.code?'，平台代码 '+diag.code:'')+(diag.message?'，'+diag.message:'')+'）':'';
        throw Object.assign(new Error((record.error||'平台提交结果未确认')+detail+' 诊断编号：'+record.id.slice(0,8)),{terminal:record.state==='failed',uncertain:record.state==='uncertain',submissionId:record.id,diagnostic:diag});
      }
      await new Promise(resolve=>setTimeout(resolve,750));
      try{record=await call('/media/submission?id='+encodeURIComponent(record.id));failures=0;}catch(error){if(++failures>=8)throw Object.assign(new Error('后台提交仍可能进行中，查询连接中断。请勿重复生成。'),{uncertain:true,submissionId:record.id});}
    }
    throw Object.assign(new Error('等待平台接单超时，后台原提交已保留。请勿重复生成。'),{uncertain:true,submissionId:record.id});
  }
  async resumeSubmission(id,requestId){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await this.fetch('http://127.0.0.1:17402/api/bridge/media/'+(requestId?'lookup':'submission?id='+encodeURIComponent(id)),{method:requestId?'POST':'GET',headers:{'X-Cine-Bridge':'1',...(requestId?{'Content-Type':'application/json'}:{})},...(requestId?{body:JSON.stringify({key:this.key,requestId})}:{}),signal:controller.signal,credentials:'omit'});
      const record=await response.json();if(!response.ok)throw Object.assign(new Error(record.error||'查询原提交失败'),{status:response.status});
      return record;
    }finally{clearTimeout(timer);}
  }
  async releaseSubmission(id){
    const response=await this.fetch('http://127.0.0.1:17402/api/bridge/media/release',{method:'POST',headers:{'X-Cine-Bridge':'1','Content-Type':'application/json'},body:JSON.stringify({id,confirmedNotSubmitted:true})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'未能解除保护');return data;
  }
  async status(taskId) { return this.request('/v1/media/status?task_id=' + encodeURIComponent(taskId)); }
  async balance() { return this.request('/api/v1/skills/balance'); }
  async models() {
    const payload = await this.request('/v1/models');
    const items = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : null;
    if (!items) throw new Error('平台未返回标准模型列表，可在设置中手动维护模型。');
    return items.map(item => typeof item === 'string' ? {id:item,label:item} : {id:item.id || item.name,label:item.name || item.id}).filter(item => typeof item.id === 'string' && item.id.trim());
  }
}
module.exports = { MODELS, MediaClient, imageSources, unwrap, providerError, taskIdentifier };
