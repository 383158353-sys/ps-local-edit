const test=require('node:test'),assert=require('node:assert/strict');const {LocalHelper}=require('../plugin/voice');
test('helper client connects in UXP without AbortSignal.timeout',async()=>{
 let requests=[];const helper=new LocalHelper({fetchImpl:async url=>{requests.push(url);return {ok:true,json:async()=>({state:'ready'})};}});const timeout=AbortSignal.timeout;AbortSignal.timeout=undefined;
 try{const result=await helper.request('/drop/arm','POST');assert.equal(result.state,'ready');assert.equal(requests.length,2);}finally{AbortSignal.timeout=timeout;}
});
