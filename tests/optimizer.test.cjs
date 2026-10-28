const assert=require('node:assert/strict');
const {test}=require('node:test');
const {OptimizerClient}=require('../plugin/optimizer');

const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});

test('health and optimize use the local bridge header and preserve image order',async()=>{
 const calls=[];const client=new OptimizerClient({fetchImpl:async(url,options)=>{calls.push({url,options});return response(url.endsWith('/health')?{ok:true}:{prompt:'已优化'});}});
 assert.equal((await client.health()).ok,true);
 const images=[{name:'选区.png',data:'data:image/png;base64,YQ=='},{name:'参考.png',data:'data:image/png;base64,Yg=='}];
 assert.equal((await client.optimize({text:'改红色',images,target:'banana2'})).prompt,'已优化');
 assert.equal(calls[1].options.headers['X-Cine-Bridge'],'1');assert.equal(calls[1].options.credentials,'omit');
 const body=JSON.parse(calls[1].options.body);assert.deepEqual(body.images,images);assert.equal(body.purpose,'ps_local_edit');assert.equal(body.language,'zh');assert.equal(body.target,'banana2');
});

test('connection errors have a clear launch instruction',async()=>{
 const client=new OptimizerClient({fetchImpl:async()=>{throw new TypeError('Failed to fetch');}});
 await assert.rejects(client.health(),/影词魔方没有运行.*打开/);
});

test('timeout and explicit cancellation are distinguished',async()=>{
 const hanging=(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));
 const timed=new OptimizerClient({fetchImpl:hanging,timeoutMs:10});await assert.rejects(timed.optimize({text:'x'}),/超时/);
 const cancelled=new OptimizerClient({fetchImpl:hanging});const pending=cancelled.optimize({text:'x'});cancelled.cancel();await assert.rejects(pending,/已取消优化/);
});

test('server errors are shown without hiding their Chinese reason',async()=>{
 const client=new OptimizerClient({fetchImpl:async()=>response({error:'未配置 API Key，请在影词魔方里填写'},400)});
 await assert.rejects(client.optimize({text:'x'}),/未配置 API Key/);
});

test('an optimize transport failure while cine is running is an upload error',async()=>{
 const client=new OptimizerClient({fetchImpl:async url=>{
  if(String(url).endsWith('/health'))return response({ok:true});
  throw new TypeError('Failed to fetch');
 }});
 await assert.rejects(client.optimize({text:'改',images:[{name:'选区.png',data:'data:image/png;base64,YQ=='}]}),error=>{
  assert.match(error.message,/图片太大/);
  assert.doesNotMatch(error.message,/没有运行/);
  return true;
 });
});

test('an optimize transport failure while cine is down stays offline',async()=>{
 const client=new OptimizerClient({fetchImpl:async()=>{throw new TypeError('Failed to fetch');}});
 await assert.rejects(client.optimize({text:'改',images:[{name:'选区.png',data:'data:image/png;base64,YQ=='}]}),/影词魔方没有运行.*打开/);
});

test('bridge 413 and oversized HTTP errors stay size errors',async()=>{
 const tooBig=new OptimizerClient({fetchImpl:async()=>response({error:'应用入口请求超过 26MB（含上传封装）'},413)});
 await assert.rejects(tooBig.optimize({text:'x',images:[{name:'选区.png',data:'data:image/png;base64,YQ=='}]}),error=>{
  assert.match(error.message,/图片太大/);
  assert.doesNotMatch(error.message,/没有运行/);
  return true;
 });
 const english=new OptimizerClient({fetchImpl:async()=>response({error:'Request failed'},500)});
 await assert.rejects(english.optimize({text:'x'}),error=>{
  assert.match(error.message,/Request failed/);
  assert.doesNotMatch(error.message,/没有运行/);
  return true;
 });
 const html=new OptimizerClient({fetchImpl:async()=>({ok:false,status:413,json:async()=>{throw new Error('not json');}})});
 await assert.rejects(html.optimize({text:'x',images:[{name:'选区.png',data:'data:image/png;base64,YQ=='}]}),/图片太大/);
});

test('a text-only transport failure does not claim cine is offline when health works',async()=>{
 const client=new OptimizerClient({fetchImpl:async url=>{
  if(String(url).endsWith('/health'))return response({ok:true});
  throw new TypeError('socket hang up');
 }});
 await assert.rejects(client.optimize({text:'只写字'}),error=>{
  assert.match(error.message,/没能传到影词魔方/);
  assert.doesNotMatch(error.message,/没有运行/);
  return true;
 });
});

test('an optimize body over the local limit is rejected before fetch',async()=>{
 let calls=0;
 const client=new OptimizerClient({maxBodyBytes:80,fetchImpl:async()=>{calls++;return response({prompt:'x'});}});
 await assert.rejects(client.optimize({text:'hi',images:[{name:'a.png',data:'data:image/png;base64,'+'A'.repeat(200)}]}),/图片太大/);
 assert.equal(calls,0);
});
