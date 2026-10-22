/* LK888 media protocol, independently implemented from public client evidence.
 * Protocol reference: Corkery520/ComfyUI-MengBaoAI/api/image_client.py.
 * No API keys, prompts or image payloads are logged.
 */
const MODELS = [
  { id: 'banana-2', label: 'Nano Banana 2' },
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
      Object.keys(value).forEach(name=>{if(!['inlineData','inline_data','error','message','prompt','input','metadata','input_images','reference_images'].includes(name))visit(value[name],name.toLowerCase(),context&&!['error','message','prompt','input','metadata'].includes(name.toLowerCase()),depth+1);});
    }
  }
  visit(payload);return [...new Set(output)];
}
class MediaClient {
  constructor(key, fetchImpl = fetch) { this.key = key; this.fetch = fetchImpl; this.base = 'https://api.lk888.ai'; }
  async request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await this.fetch(this.base + path, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      let payload;
      try { payload = await response.json(); } catch (_) { throw new Error('平台返回了无法识别的响应。'); }
      if (!response.ok || payload?.error || unwrap(payload)?.error) {
        payload = unwrap(payload)?.error ? unwrap(payload) : payload;
        const error = payload.error;
        if (response.status === 502) throw new Error('LK888 上游模型返回 502，模型暂不可用或平台请求超时。请稍后重试，并先在 LK888 确认任务状态，避免重复提交。'+(error?.message?' 原因：'+error.message:''));
        const failure=new Error(providerError(payload,response.status));
        if(/PROHIBITED_CONTENT|content_policy|safety.*block|内容.*(?:拦截|阻止|策略)/i.test(JSON.stringify(payload))){failure.terminal=true;failure.code='PROHIBITED_CONTENT';failure.message='生成失败：上游内容审核拦截（PROHIBITED_CONTENT），未返回图片。'+(/退款|refund/i.test(JSON.stringify(payload))?' 平台提示已退款。':'')+' 请检查输入图片与提示词，按平台规则调整后再生成。';}
        throw failure;
      }
      return payload;
    } catch (error) {
      const phase = path.startsWith('/v1/media/generate') ? '提交生图任务' : path.startsWith('/v1/media/status') ? '查询原任务' : '检查连接';
      if (/network|fetch|abort|timeout/i.test(error.message || '') || error.name === 'AbortError') {
        throw new Error(phase + '时网络连接失败或超时。' + (body ? '提交结果不确定，请到平台确认任务，勿重复生成。' : '可再次查询，不会重复提交生图任务。'));
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async submit(model, prompt, images, params = {}) {
    const payload = await this.request('/v1/media/generate', { model, prompt, params: { ...params, images } });
    const taskId = unwrap(payload).task_id || payload.task_id;
    if (!taskId) throw new Error('未收到任务编号。请先到平台确认任务，避免重复计费。');
    return String(taskId);
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
module.exports = { MODELS, MediaClient, imageSources, unwrap, providerError };
