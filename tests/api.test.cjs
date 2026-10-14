const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MODELS, MediaClient, imageSources } = require('../plugin/api');

test('keeps offline fallback presets independently of the synced catalog', () => {
  assert.equal(MODELS.length,17);assert.ok(MODELS.some(m=>m.id==='qwen-image'));assert.ok(MODELS.some(m=>m.id==='vidu-image-2'));assert.equal(MODELS.some(m=>m.id==='qwen-image-max'),false);
});

test('submits selected third-party image model ids unchanged', async () => {
  const calls = [];
  const api = new MediaClient('test-key', async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ task_id: 'task-1' }) }; });
  for (const model of ['doubao-seedream-5-0-pro-260628','gk-image-2.0','qwen-image-max']) await api.submit(model, '编辑图片', ['data:image/png;base64,YQ==']);
  assert.deepEqual(calls.map(call => call.model), ['doubao-seedream-5-0-pro-260628','gk-image-2.0','qwen-image-max']);
});

test('image editing submits the source and references through LK888 media protocol', async () => {
  const calls = [];
  const api = new MediaClient('test-key', async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ data: { task_id: 'task-1' } }) }; });
  assert.equal(await api.submit('banana-2', '修改衣服', ['data:image/jpeg;base64,YQ==', 'data:image/png;base64,Yg==']), 'task-1');
  assert.equal(calls[0].url, 'https://api.lk888.ai/v1/media/generate');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'banana-2', prompt: '修改衣服', params: { images: ['data:image/jpeg;base64,YQ==', 'data:image/png;base64,Yg=='] } });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
});

test('an ambiguous submission failure is not retried', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; throw new Error('network lost'); });
  await assert.rejects(api.submit('tt-image-2', 'edit', ['source']), /提交生图任务.*勿重复生成/);
  assert.equal(count, 1);
});

test('explains LK888 gateway 502 without resubmitting the image task', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; return { ok: false, status: 502, json: async () => ({}) }; });
  await assert.rejects(api.submit('gk-image-2.0', '编辑图片', ['source']), /上游模型返回 502/);
  assert.equal(count, 1);
});

test('status resumes the same task using GET and URL encoding', async () => {
  let call;
  const api = new MediaClient('test-key', async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ is_final: true, state: 'success' }) }; });
  await api.status('id a/b');
  assert.equal(call.url, 'https://api.lk888.ai/v1/media/status?task_id=id%20a%2Fb');
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.body, undefined);
});

test('recognizes nested URL, serialized result arrays, base64 and Gemini inline images', () => {
  assert.deepEqual(imageSources({ data: { result_url: '["https://img.example/a.png"]', images: [{ url: 'https://img.example/b.png' }], b64_json: 'YWJj', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'eHl6' } }] } }), ['https://img.example/a.png', 'https://img.example/b.png', 'data:image/png;base64,YWJj', 'data:image/jpeg;base64,eHl6']);
  assert.deepEqual(imageSources({ output_url: 'http://unsafe.example/a.png' }), []);
});

test('reports authentication errors without returning secret values', async () => {
  const api = new MediaClient('test-key', async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid key' } }) }));
  await assert.rejects(api.balance(), /Invalid key/);
});

test('reads actual API model ids from the authenticated models endpoint', async () => {
  let call;
  const api = new MediaClient('test-key', async (url, options) => {call={url,options};return {ok:true,json:async()=>({data:[{id:'seedream-edit'}, {id:'banana-2'}]})};});
  assert.deepEqual((await api.models()).map(m=>m.id), ['seedream-edit','banana-2']);
  assert.equal(call.url,'https://api.lk888.ai/v1/skills/models');
  assert.equal(call.options.method,'GET');
});

test('models endpoint preserves capability and parameter metadata, including nested lists',async()=>{
 const item={id:'new-edit',display_name:'New Edit',capabilities:{image_editing:true},parameters:{resolution:{enum:['2K']}}};
 const api=new MediaClient('test-key',async()=>({ok:true,json:async()=>({data:{models:[null,item]}})}));
 const [model]=await api.models();assert.equal(model.label,'New Edit');assert.deepEqual(model.capabilities,item.capabilities);assert.deepEqual(model.parameters,item.parameters);
});


test('official skills catalog loads image details with at most three concurrent reads',async()=>{
 let active=0,maximum=0;const calls=[];
 const api=new MediaClient('test-key',async(url,options)=>{
  calls.push(url);assert.equal(options.headers['Accept-Language'],'zh-CN');
  if(url.endsWith('/v1/skills/models'))return {ok:true,json:async()=>({models:[...Array.from({length:8},(_,i)=>({name:'editor-'+i,type:'image'})),{name:'disabled',type:'image',available_for_this_key:false},{name:'chat',type:'chat'}],total:10})};
  active++;maximum=Math.max(maximum,active);await new Promise(r=>setImmediate(r));active--;
  return {ok:true,json:async()=>({name:new URL(url).searchParams.get('model'),type:'image',params:[{name:'resolution',type:'select',options:[{value:'2K',label:'2K'}]}]})};
 });
 const models=await api.models();assert.equal(models.length,10);assert.equal(calls.length,9);assert.ok(maximum<=3);assert.equal(models[0].params[0].options[0].value,'2K');assert.equal(models[8].available_for_this_key,false);assert.equal(calls.some(url=>url.includes('/generate')),false);
});
test('detail lookup uses the documented query route for slash-containing model names',async()=>{
 let path;const api=new MediaClient('test-key',async url=>{path=url;return {ok:true,json:async()=>({name:'vendor/editor',params:[]})};});await api.modelDetail('vendor/editor');assert.equal(path,'https://api.lk888.ai/v1/skills/models/-?model=vendor%2Feditor');
});
test('skills catalog only falls back to the legacy list when the route is absent',async()=>{
 const calls=[];const api=new MediaClient('test-key',async url=>{calls.push(url);return url.endsWith('/v1/skills/models')?{ok:false,status:404,json:async()=>({error:{type:'not_found'}})}:{ok:true,json:async()=>({data:[{id:'legacy'}]})};});assert.equal((await api.models())[0].id,'legacy');assert.equal(calls.length,2);
 let failures=0;const denied=new MediaClient('test-key',async()=>{failures++;return {ok:false,status:401,json:async()=>({error:{message:'Invalid key'}})};});await assert.rejects(denied.models(),/Invalid key/);assert.equal(failures,1);
});
test('HTTP 200 with a failing business code cannot mark a check or submission successful',async()=>{
 let calls=0;const api=new MediaClient('test-key',async()=>{calls++;return {ok:true,status:200,json:async()=>({code:500,msg:'任务创建失败',data:{失败原因:'平台 API Key 额度不足'}})};});await assert.rejects(api.balance(),/额度不足/);await assert.rejects(api.submit('banana-2','edit',['source']),/额度不足/);assert.equal(calls,2);
});

test('combined inline image limits are checked before any paid request is sent',async()=>{
 let calls=0;const api=new MediaClient('test-key',async()=>{calls++;throw new Error('must not send');});
 const image='data:image/png;base64,'+'A'.repeat(10400000);await assert.rejects(api.submit('banana-2','edit',[image,image,image,image]),/合计超过平台 30 MB/);assert.equal(calls,0);
 const tooLarge='data:image/png;base64,'+'A'.repeat(14000000);await assert.rejects(api.submit('banana-2','edit',[tooLarge]),/单张内联图片超过/);assert.equal(calls,0);
});

test('Token variants are removed before detail reads and manual submission cannot bypass the filter',async()=>{
 const calls=[];const client=new MediaClient('dummy',async url=>{calls.push(url);return {ok:true,json:async()=>({models:[{name:'banana-2-token',type:'image'},{name:'allowed',type:'image',billing_mode:'by_token'},{name:'banana-2',type:'image'}]})};});
 assert.deepEqual((await client.models()).map(m=>m.id),['banana-2']);assert.equal(calls.some(url=>/token/.test(url)),false);
 const before=calls.length;await assert.rejects(client.submit('banana-2-token','edit',['source']),/Token 版/);assert.equal(calls.length,before);
});
test('explicit rejection is failed while network, malformed response and missing task ID remain uncertain without retries',async()=>{
 for(const [name,response,uncertain] of [
  ['rejected',async()=>({ok:false,status:400,json:async()=>({code:400,msg:'参数错误'})}),false],
  ['network',async()=>{throw new Error('network lost');},true],
  ['malformed',async()=>({ok:true,status:200,json:async()=>{throw new Error('invalid JSON');}}),true],
  ['missing task',async()=>({ok:true,status:200,json:async()=>({code:200,data:{}})}),true]
 ]){let requests=0;const client=new MediaClient('dummy',async()=>{requests++;return response();});await assert.rejects(client.submit('banana-2','edit',['source']),error=>{assert.equal(error.uncertain,uncertain,name);return true;});assert.equal(requests,1,name);}
});
test('result extraction omits echoed input images and accepts direct output arrays',()=>{
 assert.deepEqual(imageSources({data:{request:{images:['https://example.com/input.png']},params:{images:['https://example.com/reference.png']},result:['https://example.com/output.png']}}),['https://example.com/output.png']);
});
