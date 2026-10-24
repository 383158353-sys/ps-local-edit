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
test('a submit failure keeps the real reason and does not become an uncertain status',async()=>{
 const queue=new TaskQueue({persist(){},onChange(){},client:async()=>({submit:async()=>{throw new Error('提交生图任务时网络连接失败或超时。请到平台确认是否已接单，勿重复生成。');}})});
 const job={id:'one',count:1,model:'banana-2.1',tasks:[]};
 await queue.submit(job,[],{});
 assert.equal(job.state,'failed');
 assert.match(job.error,/网络连接失败或超时/);
 assert.doesNotMatch(job.error,/提交状态不确定|语音会话/);
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


test('nested submission rejection preserves the provider reason',async()=>{
 const api=new MediaClient('test-key',async()=>({ok:true,status:200,json:async()=>({data:{error:{code:'PROHIBITED_CONTENT',message:'blocked'}}})}));
 await assert.rejects(api.submit('banana-2','edit',[]),error=>error.terminal===true&&/PROHIBITED_CONTENT/.test(error.message));
});

test('string false final flag keeps polling the existing task',async()=>{
 for(const flag of ['false','0',false,0]){
  let calls=0;const task={id:'existing',state:'running',results:[]},job={state:'running',tasks:[task]};
  const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>({status:async()=>{calls++;return {data:{state:'processing',is_final:flag}};}})});
  await queue.tick();await queue.tick();assert.equal(calls,2);assert.equal(task.state,'running');assert.equal(job.state,'running');
 }
});
