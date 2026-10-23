const {imageSources,unwrap,providerError}=require('./api');
class TaskQueue{
 constructor({jobs=[],persist,client,onChange}){this.jobs=jobs;this.persist=persist;this.client=client;this.onChange=onChange;this.querying=new Set();}
 save(){this.persist(this.jobs);this.onChange();}
 async submit(record,images,params){
  const index=this.jobs.findIndex(j=>j.id===record.id);if(index>=0)this.jobs[index]=record;else this.jobs.unshift(record);
  record.phase='准备图片';record.timings={startedAt:Date.now()};this.save();
  const api=await this.client();
  if(images.length&&api.prepareImages){try{images=await api.prepareImages(images);}catch(_){/* Original images remain valid; no generation has been submitted. */}}
  record.timings.preparedAt=Date.now();record.phase='上传图片，等待平台接单';
  record.pendingSubmissions=record.count;record.state='submitting';this.save();
  // Each requested output is submitted once. Independent requests need not wait
  // for the preceding model task to be accepted or completed.
  const failures=[];
  await Promise.all(Array.from({length:record.count},async(_,index)=>{
   try{const id=await api.submit(record.model,record.instruction,images,params);record.tasks.push({id,state:'running',results:[],outputIndex:index});}
   catch(e){
    failures.push(e);
    if(!e.taskId||e.terminal)record.error=e.message;
    if(e.taskId)record.tasks.push({id:String(e.taskId),state:e.terminal?'failed':'running',results:[],outputIndex:index,error:e.terminal?e.message:null});
   }
   finally{record.pendingSubmissions--;record.phase='已接单 '+record.tasks.length+'/'+record.count+'，待响应 '+record.pendingSubmissions;this.save();}
  }));
  record.tasks.sort((a,b)=>a.outputIndex-b.outputIndex);
  record.timings.acceptedAt=Date.now();
  if(failures.length){
   const running=record.tasks.some(t=>t.state==='running');
   if(running)record.state='running';
   else if(failures.some(e=>(e.uncertain||(!e.terminal&&!e.notSubmitted))&&!e.taskId))record.state='uncertain';
   else record.state='failed';
   record.phase=record.state==='uncertain'?'提交结果不确定，请到平台确认，勿重复生成':record.state==='failed'?'提交没有完成，可以重新生成':'部分提交失败，请查看原任务';
  }
  else{record.phase='平台生成中';record.state=record.tasks.every(t=>t.state==='ready')?'ready':record.tasks.some(t=>t.state==='running')?'running':'failed';}
  this.save();
 }
 async tick(){await Promise.all(this.jobs.flatMap(job=>job.tasks.filter(task=>task.state==='running').map(task=>this.query(job,task))));}
 async query(job,task){if(this.querying.has(task.id))return;this.querying.add(task.id);try{
  const api=await this.client(),response=await api.status(task.id),data=unwrap(response);
  const state=String(data.state||data.status||response.state||response.status||'').toLowerCase();
  const images=imageSources(response),failed=['failed','failure','error','cancelled','canceled'].includes(state)||!!(data.error||response.error);
  const succeeded=['success','succeeded','completed','complete','done','finished'].includes(state);
  const final=[data.is_final,response.is_final,data.isFinal,response.isFinal].some(value=>value===true||value===1||value==='true'||value==='1')||succeeded||failed;
  task.progress=data.progress??response.progress;task.updatedAt=Date.now();task.error=null;
  if(failed){task.state='failed';task.results=[];task.error=providerError(data.error?data:response,200);}
  else if(images.length){task.state='ready';task.results=images.map(source=>({source,imported:false}));}
  else if(final){task.state='failed';task.results=[];task.error='平台报告生成结束，但响应中没有可识别的图片。请查询原任务；未自动加图层，也不会重复提交。';}
  else task.platformState=state||'running';
  if(job.state!=='uncertain'&&!job.pendingSubmissions)job.state=job.tasks.every(t=>t.state==='ready')?'ready':job.tasks.some(t=>t.state==='running')?'running':'failed';
 }catch(e){task.error=e.message;if(e.terminal){task.state='failed';task.results=[];if(job.state!=='uncertain')job.state=job.tasks.some(t=>t.state==='running')?'running':'failed';}}finally{this.querying.delete(task.id);this.save();}}
}
module.exports={TaskQueue};
