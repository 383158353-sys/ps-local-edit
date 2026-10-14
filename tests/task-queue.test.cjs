const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TaskQueue}=require('../plugin/task-queue');
test('polling limits concurrency, ignores overlapping ticks, and saves one batch',async()=>{
 let active=0,max=0,requests=0,saves=0;
 const jobs=Array.from({length:9},(_,i)=>({id:String(i),state:'running',tasks:[{id:String(i),state:'running',results:[]}]}));
 const queue=new TaskQueue({jobs,persist:()=>saves++,onChange:()=>{},client:async()=>({status:async()=>{
  active++;requests++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return {state:'success',is_final:true,result_url:'https://example.com/result.png'};
 }})});
 await Promise.all([queue.tick(),queue.tick(),queue.tick()]);
 assert.equal(requests,9);assert.equal(max,3);assert.equal(saves,1);assert.ok(jobs.every(j=>j.state==='ready'));
 await queue.tick();assert.equal(saves,1);
});
test('polling does not complete a job whose remaining candidates are still being submitted',async()=>{
 const job={state:'submitting',tasks:[{id:'first',state:'running',results:[]}]};
 const queue=new TaskQueue({jobs:[job],persist:()=>{},onChange:()=>{},client:async()=>({status:async()=>({state:'success',is_final:true,result_url:'https://example.com/image.png'})})});
 await queue.tick();assert.equal(job.state,'submitting');assert.equal(job.tasks[0].state,'ready');
});

test('partial rejection retains earlier tasks and never retries remaining candidates',async()=>{
 let submits=0;const record={id:'partial',model:'banana-2',instruction:'edit',count:4,tasks:[]};const queue=new TaskQueue({persist(){},onChange(){},client:async()=>({submit:async()=>{if(++submits===2)throw Object.assign(new Error('参数错误'),{uncertain:false});return 'first';},status:async()=>({state:'success',is_final:true,result_url:'https://example.com/output.png'})})});
 await queue.submit(record,['source'],{});assert.equal(submits,2);assert.equal(record.tasks.length,1);assert.equal(record.state,'running');assert.equal(record.submissionFailed,true);await queue.tick();assert.equal(record.tasks[0].state,'ready');assert.equal(record.state,'failed');assert.equal(submits,2);
});
test('uncertain submission stays uncertain after previous successful tasks finish',async()=>{
 let submits=0;const record={id:'uncertain',model:'banana-2',count:2,tasks:[]};const queue=new TaskQueue({persist(){},onChange(){},client:async()=>({submit:async()=>{if(++submits===2)throw Object.assign(new Error('network lost'),{uncertain:true});return 'first';},status:async()=>({state:'success',is_final:true,result_url:'https://example.com/output.png'})})});await queue.submit(record,['source'],{});await queue.tick();assert.equal(record.state,'uncertain');assert.equal(record.tasks.length,1);assert.equal(submits,2);
});
