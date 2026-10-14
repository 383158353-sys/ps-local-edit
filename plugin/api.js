/* LK888 media protocol, independently implemented from public client evidence.
 * Protocol reference: Corkery520/ComfyUI-MengBaoAI/api/image_client.py.
 * No API keys, prompts or image payloads are logged.
 */
const {isTokenModel,requireAllowedModel}=require('./model-policy');
const MODELS = [...require('./platform-models').filter(m=>!isTokenModel(m.name)).map(m=>({id:m.name,label:m.display_name})),{id:'custom',label:'其他模型（自定义 ID）'}];
function unwrap(value) { return value && value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value; }
function imageSources(payload) {
  const output = [];
  function visit(value, key) {
    if (typeof value === 'string') {
      if (value.startsWith('data:image/')) output.push(value);
      else if (['b64_json', 'base64', 'image_base64'].includes(key)) output.push('data:image/png;base64,' + value);
      else if (['image_url', 'output_url', 'image_output_url', 'result_url', 'fileuri', 'file_uri', 'url','images','image','output','outputs','result','results'].includes(key)) {
        if (/^https:\/\//.test(value)) output.push(value);
        else if (/^[\[{]/.test(value)) { try { visit(JSON.parse(value), key); } catch (_) {} }
      }
    } else if (Array.isArray(value)) value.forEach(item => visit(item, key));
    else if (value && typeof value === 'object') {
      const inline = value.inlineData || value.inline_data;
      if (inline && inline.data) output.push('data:' + (inline.mimeType || inline.mime_type || 'image/png') + ';base64,' + inline.data);
      Object.keys(value).forEach(name => { if (!['inlineData','inline_data','request','request_info','params','input','inputs','prompt','instruction','source_images','reference_images','attachments'].includes(name)) visit(value[name], name.toLowerCase()); });
    }
  }
  visit(payload, '');
  return [...new Set(output)];
}
function validateImages(images){
    let total=0;for(const image of images){if(typeof image!=='string'||!image.startsWith('data:')||!image.includes(';base64,'))continue;const base64=image.slice(image.indexOf(',')+1),bytes=Math.floor(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);if(bytes>10000000)throw new Error('单张内联图片超过平台 10 MB 限制，请压缩后上传。');total+=bytes;}
    if(total>30000000)throw new Error('内联图片合计超过平台 30 MB 限制，请减少参考图或缩小图片。');
}
class MediaClient {
  constructor(key, fetchImpl = fetch) { this.key = key; this.fetch = fetchImpl; this.base = 'https://api.lk888.ai'; }
  async request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), path.startsWith('/v1/media/generate')?300000:20000);
    try {
      const response = await this.fetch(this.base + path, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', 'Accept-Language':'zh-CN' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      let payload;
      try { payload = await response.json(); } catch (_) { const failure=new Error('平台返回了无法识别的响应。');failure.uncertain=!!body;throw failure; }
      if(!payload||typeof payload!=='object'){const failure=new Error('平台返回了无法识别的响应。');failure.uncertain=!!body;throw failure;}
      if (!response.ok || payload.error || (payload.code!==undefined&&Number(payload.code)!==200)) {
        const error = payload.error;
        if (response.status === 502){const failure=new Error('LK888 上游模型返回 502，模型暂不可用或平台请求超时。请稍后重试，并先在 LK888 确认任务状态，避免重复提交。'+(error?.message?' 原因：'+error.message:''));failure.uncertain=!!body;throw failure;}
        const failure=new Error((error&&(error.message||error.type))||payload.data?.失败原因||payload.msg||payload.message||('接口请求失败：'+response.status));failure.status=response.status;failure.uncertain=!!body&&((payload.data?.task_id||payload.task_id)||response.status>=500&&(payload.code===undefined||Number(payload.code)===200))?true:false;throw failure;
      }
      return payload;
    } catch (error) {
      const phase = path.startsWith('/v1/media/generate') ? '提交生图任务' : path.startsWith('/v1/media/status') ? '查询原任务' : '检查连接';
      if(error.status===undefined&&(/network|fetch|abort|timeout/i.test(error.message||'')||error.name==='AbortError')) {
        const failure=new Error(phase+'时网络连接失败或超时。'+(body?'提交结果不确定，请到平台确认任务，勿重复生成。':'可再次查询，不会重复提交生图任务。'));failure.uncertain=!!body;throw failure;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async submit(model, prompt, images, params = {}) {
    requireAllowedModel(model);validateImages(images);
    const payload = await this.request('/v1/media/generate', { model, prompt, params: { ...params, images } });
    const taskId = unwrap(payload).task_id || payload.task_id;
    if(!taskId){const failure=new Error('未收到任务编号。请先到平台确认任务，避免重复计费。');failure.uncertain=true;throw failure;}
    return String(taskId);
  }
  async status(taskId) { return this.request('/v1/media/status?task_id=' + encodeURIComponent(taskId)); }
  async balance() { return this.request('/v1/skills/balance'); }
  async modelDetail(id){
    return unwrap(await this.request('/v1/skills/models/-?model='+encodeURIComponent(id)));
  }
  async models({onProgress=()=>{}}={}) {
    let payload;
    try{payload=await this.request('/v1/skills/models');}catch(error){if(error.status!==404)throw error;payload=await this.request('/v1/models');}
    const items=Array.isArray(payload)?payload:Array.isArray(payload.models)?payload.models:Array.isArray(payload.data)?payload.data:Array.isArray(payload.data?.models)?payload.data.models:null;
    if(!items)throw new Error('平台未返回标准模型列表，已保留缓存。');
    const models=items.filter(item=>typeof item==='string'||item&&typeof item==='object').map(item=>typeof item==='string'?{id:item,label:item}:{...item,id:item.name||item.id,label:item.display_name||item.label||item.name||item.id}).filter(item=>typeof item.id==='string'&&item.id.trim()&&!isTokenModel(item));
    const candidates=models.filter(m=>m.type==='image'&&(!Array.isArray(m.params)||!m.params.length)&&m.available_for_this_key!==false);
    let index=0,done=0;
    const worker=async()=>{while(index<candidates.length){const model=candidates[index++];try{const detail=await this.modelDetail(model.id);if(detail.name&&detail.name!==model.id)throw new Error('模型详情与请求的 ID 不一致');if(!Array.isArray(detail.params))throw new Error('缺少参数定义');Object.assign(model,detail,{id:model.id,label:detail.display_name||model.label,_detailLoaded:true});}catch(_){model._detailFailed=true;}onProgress(++done,candidates.length);}};
    await Promise.all(Array.from({length:Math.min(3,candidates.length)},worker));
    return models;
  }
}
module.exports = { MODELS, MediaClient, imageSources, unwrap, validateImages };
