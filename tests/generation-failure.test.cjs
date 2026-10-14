const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MediaClient}=require('../plugin/api');
const {TaskQueue}=require('../plugin/task-queue');
test('provider content rejection terminates polling without pretending an image exists',async()=>{
 let requests=0;
 const client=new MediaClient('test-key',async()=>{requests++;return {ok:true,status:200,json:async()=>({error:{code:'PROHIBITED_CONTENT',message:'上游内容策略阻止（已退款）'}})};});
 const job={id:'one',state:'running',tasks:[{id:'task-one',state:'running',results:[]}]};
 const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>client});
 await queue.tick();await queue.tick();
 assert.equal(requests,1);assert.equal(job.state,'failed');assert.equal(job.tasks[0].state,'failed');assert.deepEqual(job.tasks[0].results,[]);assert.match(job.tasks[0].error,/未返回图片/);assert.match(job.tasks[0].error,/已退款/);
});
test('submission content rejection is failed while network ambiguity remains uncertain',async()=>{
 const queue=new TaskQueue({persist(){},onChange(){},client:async()=>({submit:async()=>{const error=new Error('内容审核拦截');error.terminal=true;throw error;}})});
 const job={id:'one',count:1,tasks:[]};await queue.submit(job,[],{});assert.equal(job.state,'failed');
});

test('success with alternate result fields becomes ready without placing layers',async()=>{
 const job={state:'running',tasks:[{id:'task',state:'running',results:[]}]};
 const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>({status:async()=>({data:{state:'success',is_final:true,result:JSON.stringify({outputs:[{uri:'http://cdn.example/result.png'}]})}})})});
 await queue.tick();assert.equal(job.state,'ready');assert.deepEqual(job.tasks[0].results,[{source:'http://cdn.example/result.png',imported:false}]);
});
test('final failure remains failure even if it contains a result URL',async()=>{
 const job={state:'running',tasks:[{id:'task',state:'running',results:[]}]};
 const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>({status:async()=>({data:{state:'failed',is_final:true,error:{message:'PROHIBITED_CONTENT'},result_url:'https://cdn.example/input.png'}})})});
 await queue.tick();assert.equal(job.state,'failed');assert.match(job.tasks[0].error,/PROHIBITED_CONTENT/);assert.deepEqual(job.tasks[0].results,[]);
});
