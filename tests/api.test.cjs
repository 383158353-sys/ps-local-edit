const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MODELS, MediaClient, imageSources } = require('../plugin/api');
const { TaskQueue } = require('../plugin/task-queue');

test('completed status with image becomes a candidate without placing a layer', async () => {
  for (const state of ['SUCCESS','completed','succeeded']) {
    const task={id:'existing',state:'running',results:[]};
    const job={id:'job',state:'running',tasks:[task]};
    const queue=new TaskQueue({jobs:[job],persist:()=>{},onChange:()=>{},client:async()=>({status:async()=>({data:{state,output:{images:[{url:'https://img.example/result.png'}]}}})})});
    await queue.tick();
    assert.equal(task.state,'ready');
    assert.deepEqual(task.results,[{source:'https://img.example/result.png',imported:false}]);
  }
});

test('keeps exactly the original choices plus custom', () => {
  assert.deepEqual(MODELS.map(model => model.id), ['banana-2','gemini-nano-banana-2.1','banana-pro','tt-image-2','tt-image-2.5','doubao-seedream-5-0-pro-260628','gk-image-2.0','qwen-image-max','custom']);
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
  await assert.rejects(api.submit('tt-image-2', 'edit', ['source']), /提交生图任务时网络连接失败或超时/);
  assert.equal(count, 1);
});
test('generation always goes directly to the platform API', async () => {
  const urls = [];
  const api = new MediaClient('test-key', async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return { ok: true, status: 200, json: async () => ({ task_id: 'task-direct' }) };
  });
  assert.equal(await api.submit('banana-2', '把字写清楚', ['data:image/png;base64,YQ==']), 'task-direct');
  assert.deepEqual(urls, ['https://api.lk888.ai/v1/media/generate']);
});
test('model rejection stays a terminal failure with the provider reason', async () => {
  const api = new MediaClient('test-key', async () => ({ ok: false, status: 400, json: async () => ({ error: { message: '模型不存在或当前密钥无权限' } }) }));
  await assert.rejects(api.submit('banana-2.1', 'edit', ['source']), error => error.terminal === true && /模型不存在或当前密钥无权限/.test(error.message) && !/语音会话|提交状态不确定/.test(error.message));
});

test('explains LK888 gateway 502 without resubmitting the image task', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; return { ok: false, status: 502, json: async () => ({}) }; });
  await assert.rejects(api.submit('gk-image-2.0', '编辑图片', ['source']), /上游模型返回 502/);
  assert.equal(count, 1);
});
test('HTTP 200 business errors show the provider reason instead of a misleading status', async () => {
  const api = new MediaClient('test-key', async () => ({ok:true,status:200,json:async()=>({error:{msg:'模型不支持上传图片'}})}));
  await assert.rejects(api.submit('banana-2','测试',['data:image/png;base64,YQ==']),/模型不支持上传图片/);
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
  assert.deepEqual(imageSources({ output_url: 'http://img.example/a.png' }), ['http://img.example/a.png']);
});

test('reports authentication errors without returning secret values', async () => {
  const api = new MediaClient('test-key', async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid key' } }) }));
  await assert.rejects(api.balance(), /Invalid key/);
});

test('reads actual API model ids from the authenticated models endpoint', async () => {
  let call;
  const api = new MediaClient('test-key', async (url, options) => {call={url,options};return {ok:true,json:async()=>({data:[{id:'seedream-edit'}, {id:'banana-2'}]})};});
  assert.deepEqual((await api.models()).map(m=>m.id), ['seedream-edit','banana-2']);
  assert.equal(call.url,'https://api.lk888.ai/v1/models');
  assert.equal(call.options.method,'GET');
});

test('recognizes serialized result containers and alternate image fields without leaking unrelated URLs',()=>{
 assert.deepEqual(imageSources({data:{result:JSON.stringify({outputs:[{uri:'http://cdn.example/a.png'},{download_url:'https://cdn.example/b.png'}]})},images:['https://cdn.example/b.png'],metadata:{url:'https://cdn.example/meta'},message:'https://cdn.example/help'}),['http://cdn.example/a.png','https://cdn.example/b.png']);
 assert.deepEqual(imageSources({data:{output:JSON.stringify(['https://cdn.example/one.png']),result_urls:['https://cdn.example/two.png'],generated_images:[{src:'https://cdn.example/three.png'}]}}),['https://cdn.example/one.png','https://cdn.example/two.png','https://cdn.example/three.png']);
 assert.deepEqual(imageSources({result:'not json',url:'javascript:alert(1)',image_url:'https://user:password@cdn.example/private',base64:'bad value',error:{message:'https://cdn.example/error'}}),[]);
});
