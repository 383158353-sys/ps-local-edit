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
