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
function imageSources(payload) {
  const output = [];
  function visit(value, key) {
    if (typeof value === 'string') {
      if (value.startsWith('data:image/')) output.push(value);
      else if (['b64_json', 'base64', 'image_base64'].includes(key)) output.push('data:image/png;base64,' + value);
      else if (['image_url', 'output_url', 'image_output_url', 'result_url', 'fileuri', 'file_uri', 'url'].includes(key)) {
        if (/^https:\/\//.test(value)) output.push(value);
        else if (/^[\[{]/.test(value)) { try { visit(JSON.parse(value), key); } catch (_) {} }
      }
    } else if (Array.isArray(value)) value.forEach(item => visit(item, key));
    else if (value && typeof value === 'object') {
      const inline = value.inlineData || value.inline_data;
      if (inline && inline.data) output.push('data:' + (inline.mimeType || inline.mime_type || 'image/png') + ';base64,' + inline.data);
      Object.keys(value).forEach(name => { if (name !== 'inlineData' && name !== 'inline_data') visit(value[name], name.toLowerCase()); });
    }
  }
  visit(payload, '');
  return [...new Set(output)];
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
      if (!response.ok || payload.error) {
        const error = payload.error;
        if (response.status === 502) throw new Error('LK888 上游模型返回 502，模型暂不可用或平台请求超时。请稍后重试，并先在 LK888 确认任务状态，避免重复提交。'+(error?.message?' 原因：'+error.message:''));
        throw new Error((error && (error.message || error.type)) || ('接口请求失败：' + response.status));
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
module.exports = { MODELS, MediaClient, imageSources, unwrap };
