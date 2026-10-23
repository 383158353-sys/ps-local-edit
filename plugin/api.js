/* LK888 media protocol, independently implemented from public client evidence.
 * Protocol reference: Corkery520/ComfyUI-MengBaoAI/api/image_client.py.
 * No API keys, prompts or image payloads are logged.
 */
const MODELS = [
  { id: 'tt-image-2.5', label: 'GPT 图 2.5' },
  { id: 'tt-image-2', label: 'GPT 图 2' },
  { id: 'banana-2.1', label: 'Banana 2.1' },
  { id: 'banana-2', label: 'Banana 2' },
  { id: 'banana-pro', label: 'Banana Pro' },
  { id: 'doubao-seedream-5-0-pro-260628', label: '即梦 5.0 Pro' },
  { id: 'gk-image-2.0', label: 'Grok 图' },
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
const GENERATE_HEADER_BASE_MS = 8 * 60 * 1000;
const GENERATE_HEADER_MAX_MS = 15 * 60 * 1000;
const GENERATE_BODY_MS = 90 * 1000;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_SUBMIT_RETRIES = 2;
const PRE_DELIVERY_CODES = new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EADDRNOTAVAIL','UND_ERR_CONNECT_TIMEOUT']);
const PRE_DELIVERY_MESSAGE = /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|\bECONNREFUSED\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bENETUNREACH\b|getaddrinfo|name not resolved|internet disconnected|network is unreachable/i;
function payloadBytes(body) {
  if (!body || typeof body !== 'object') return 0;
  let bytes = 64;
  if (typeof body.model === 'string') bytes += body.model.length;
  if (typeof body.prompt === 'string') bytes += body.prompt.length;
  const images = body.params && Array.isArray(body.params.images) ? body.params.images : [];
  for (const image of images) bytes += typeof image === 'string' ? image.length + 4 : 256;
  return bytes;
}
function generateTimeouts(path, body) {
  if (!String(path || '').startsWith('/v1/media/generate')) return { headersMs: DEFAULT_TIMEOUT_MS, bodyMs: DEFAULT_TIMEOUT_MS };
  const extra = Math.ceil(payloadBytes(body) / (64 * 1024)) * 1000;
  return { headersMs: Math.min(GENERATE_HEADER_MAX_MS, GENERATE_HEADER_BASE_MS + extra), bodyMs: GENERATE_BODY_MS };
}
function causeCodes(error) {
  const codes = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && codes.length < 6) {
    seen.add(current);
    if (current.code) codes.push(String(current.code));
    current = current.cause;
  }
  return codes;
}
function classifySubmitFailure(error, { receivedResponse = false, abortedByTimer = false } = {}) {
  if (receivedResponse || abortedByTimer || error?.name === 'AbortError' || error?.timedOut) return 'uncertain';
  const text = [error?.message, error?.cause?.message].filter(Boolean).join(' ');
  if (causeCodes(error).some(code => PRE_DELIVERY_CODES.has(code)) || PRE_DELIVERY_MESSAGE.test(text)) return 'notSubmitted';
  return 'uncertain';
}
const BANANA21_VARIANT = /(?:^|[-_/])(?:token|flare|sunburst)(?:$|[-_/])/i;
function isPerCallBanana21(id) {
  return typeof id === 'string' && /banana[\s._-]*2[._-]1(?:$|[\s._/-])/i.test(id) && !BANANA21_VARIANT.test(id);
}
function resolvePerCallBanana(model, items) {
  const list = Array.isArray(items) ? items : [];
  const exact = list.find(item => item && item.id === 'banana-2.1');
  if (exact) return exact.id;
  if (model === 'banana-2.1') return '';
  const aliases = list.filter(item => item && isPerCallBanana21(item.id));
  return aliases.length === 1 ? aliases[0].id : '';
}
function readTaskId(payload) {
  const data = unwrap(payload);
  const id = data?.task_id || data?.taskId || payload?.task_id || payload?.taskId;
  return id == null || id === '' ? '' : String(id);
}
function phaseName(path) {
  return path.startsWith('/v1/media/generate') ? '提交生图任务' : path.startsWith('/v1/media/status') ? '查询原任务' : '检查连接';
}
class MediaClient {
  constructor(key, fetchImpl = fetch, options = {}) {
    this.key = key;
    this.fetch = fetchImpl;
    this.base = 'https://api.lk888.ai';
    this.timeouts = options.timeouts || null;
    this.retryDelays = options.retryDelays || null;
  }
  async request(path, body) {
    const isGenerate = path.startsWith('/v1/media/generate');
    const budget = generateTimeouts(path, body);
    const headersMs = this.timeouts?.headersMs ?? budget.headersMs;
    const bodyMs = this.timeouts?.bodyMs ?? budget.bodyMs;
    const controller = new AbortController();
    // Headers include the upload: a reference PNG's base64 does not finish inside the old flat 5 min abort.
    // After the status line arrives, only the JSON body is still outstanding.
    let timer = setTimeout(() => controller.abort(), headersMs);
    let response;
    const phase = phaseName(path);
    try {
      // The voice helper on 127.0.0.1:17402 has no /media/generate route. Posting the
      // selection there never reaches LK888, then the reset was reported as an uncertain task.
      response = await this.fetch(this.base + path, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), bodyMs);
      let payload;
      try { payload = await response.json(); }
      catch (_) {
        if (!isGenerate) throw new Error('平台返回了无法识别的响应。');
        const error = new Error(phase + '时平台已返回响应，但没有可保存的任务编号。提交结果不确定，请到平台确认任务，勿重复生成。');
        error.uncertain = true;
        throw error;
      }
      const taskId = isGenerate ? readTaskId(payload) : '';
      if (!response.ok || payload?.error || unwrap(payload)?.error) {
        const raw = payload;
        payload = unwrap(payload)?.error ? unwrap(payload) : payload;
        const error = payload.error;
        if (response.status === 502) {
          const failure = new Error('LK888 上游模型返回 502，模型暂不可用或平台请求超时。请稍后重试，并先在 LK888 确认任务状态，避免重复提交。'+(error?.message?' 原因：'+error.message:''));
          if (taskId) failure.taskId = taskId;
          else failure.uncertain = true;
          throw failure;
        }
        const failure=new Error(providerError(payload,response.status));
        if (taskId) failure.taskId = taskId;
        if(/PROHIBITED_CONTENT|content_policy|safety.*block|内容.*(?:拦截|阻止|策略)/i.test(JSON.stringify(raw))){failure.terminal=true;failure.code='PROHIBITED_CONTENT';failure.message='生成失败：上游内容审核拦截（PROHIBITED_CONTENT），未返回图片。'+(/退款|refund/i.test(JSON.stringify(raw))?' 平台提示已退款。':'')+' 请检查输入图片与提示词，按平台规则调整后再生成。';}
        throw failure;
      }
      return payload;
    } catch (error) {
      if (error.terminal || error.uncertain || error.notSubmitted) throw error;
      if (response && !controller.signal.aborted && error.name !== 'AbortError') throw error;
      const kind = classifySubmitFailure(error, { receivedResponse: !!response, abortedByTimer: controller.signal.aborted });
      if (!isGenerate) throw new Error(phase + '时网络连接失败或超时。可再次查询，不会重复提交生图任务。');
      if (kind === 'notSubmitted') {
        const failure = new Error(phase + '没有发出（网络连接失败）。平台上不会有这次任务，可以重新生成。');
        failure.notSubmitted = true;
        throw failure;
      }
      const failure = new Error(phase + '时网络连接失败或超时。提交结果不确定，请到平台确认任务，勿重复生成。');
      failure.uncertain = true;
      throw failure;
    } finally { clearTimeout(timer); }
  }
  async submit(model, prompt, images, params = {}) {
    if(model==='gemini-nano-banana-2.1'){
      const available=await this.models();
      const resolved=resolvePerCallBanana(model, available);
      if(resolved) model=resolved;
      else {const error=new Error('当前平台未返回可唯一确认的 Banana 2.1 模型 ID；尚未提交生图任务。请在设置中刷新平台模型。');error.terminal=true;throw error;}
    }
    const delays = this.retryDelays || [400, 1200];
    const attempts = 1 + Math.min(MAX_SUBMIT_RETRIES, delays.length);
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const payload = await this.request('/v1/media/generate', { model, prompt, params: { ...params, images } });
        const taskId = readTaskId(payload);
        if (!taskId) {
          const error = new Error('未收到任务编号。请先到平台确认任务，避免重复计费。');
          error.uncertain = true;
          throw error;
        }
        return taskId;
      } catch (error) {
        last = error;
        if (error.taskId) throw error;
        if (!error.notSubmitted || attempt >= attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delays[attempt] ?? 0));
      }
    }
    throw last;
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
module.exports = { MODELS, MediaClient, imageSources, unwrap, providerError, generateTimeouts, classifySubmitFailure, isPerCallBanana21, resolvePerCallBanana, readTaskId };
