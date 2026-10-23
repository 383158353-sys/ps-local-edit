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
 const refused=new TaskQueue({persist(){},onChange(){},client:async()=>({submit:async()=>{const error=new Error('提交生图任务没有发出（网络连接失败）。平台上不会有这次任务，可以重新生成。');error.notSubmitted=true;throw error;}})});
 const open={id:'two',count:1,tasks:[]};await refused.submit(open,[],{});assert.equal(open.state,'failed');assert.match(open.error,/可以重新生成/);
 const hung=new TaskQueue({persist(){},onChange(){},client:async()=>({submit:async()=>{const error=new Error('提交生图任务时网络连接失败或超时。提交结果不确定，请到平台确认任务，勿重复生成。');error.uncertain=true;throw error;}})});
 const lost={id:'three',count:1,tasks:[]};await hung.submit(lost,[],{});assert.equal(lost.state,'uncertain');assert.equal(lost.tasks.length,0);
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


test('a refused connection fails the job without forbidding another generate',async()=>{
 let count=0;
 const api=new MediaClient('test-key',async()=>{count++;const error=new TypeError('connect');error.code='ECONNREFUSED';throw error;},{retryDelays:[0,0]});
 const job={id:'one',count:1,model:'banana-2',instruction:'edit',tasks:[]};
 const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>api});
 await queue.submit(job,['data:image/png;base64,YQ=='],{});
 assert.equal(count,3);assert.equal(job.state,'failed');assert.equal(job.tasks.length,0);assert.match(job.error,/可以重新生成/);assert.doesNotMatch(job.error,/勿重复生成/);
});
test('an in-flight generate failure stays uncertain and does not invent a task',async()=>{
 let count=0;
 const api=new MediaClient('test-key',()=>new Promise((_,reject)=>{count++;reject(new Error('network lost'));}));
 const job={id:'one',count:1,model:'banana-2',instruction:'edit',tasks:[]};
 const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>api});
 await queue.submit(job,[],{});
 assert.equal(count,1);assert.equal(job.state,'uncertain');assert.equal(job.tasks.length,0);assert.match(job.error,/勿重复生成/);
});
test('a task id returned with an error is polled instead of discarded',async()=>{
 const api=new MediaClient('test-key',async url=>{
  if(url.includes('/generate'))return {ok:false,status:500,json:async()=>({task_id:'kept-1',error:{message:'busy'}})};
  return {ok:true,status:200,json:async()=>({data:{state:'success',is_final:true,result_url:'https://img.example/a.png'}})};
 });
 const job={id:'one',count:1,model:'banana-2.1',instruction:'edit',tasks:[]};
 const queue=new TaskQueue({jobs:[job],persist(){},onChange(){},client:async()=>api});
 await queue.submit(job,[],{});
 assert.equal(job.tasks[0].id,'kept-1');assert.equal(job.tasks[0].state,'running');assert.equal(job.state,'running');
 await queue.tick();
 assert.equal(job.state,'ready');assert.equal(job.tasks[0].results[0].source,'https://img.example/a.png');
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
