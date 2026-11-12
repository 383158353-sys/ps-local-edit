const {imageSources,unwrap,providerError}=require('./api');
class TaskQueue{
 constructor({jobs=[],persist,client,onChange}){this.jobs=jobs;this.persist=persist;this.client=client;this.onChange=onChange;this.querying=new Set();for(const job of jobs){if(job.state==='submitting'){job.state='uncertain';job.pendingSubmissions=0;job.error='上次提交等待被中断，正在只读查询原提交；不会重复生成。';job.recoveries=job.recoveries||[];for(let index=0;index<(job.count||1);index++){if(!job.tasks.some(task=>task.outputIndex===index)&&!job.recoveries.some(item=>item.outputIndex===index))job.recoveries.push({requestId:job.id+'-'+index,outputIndex:index});}}}}
 save(){this.persist(this.jobs);this.onChange();}
 async submit(record,images,params){
  const index=this.jobs.findIndex(j=>j.id===record.id);if(index>=0)this.jobs[index]=record;else this.jobs.unshift(record);
  record.phase='准备图片';record.timings={startedAt:Date.now()};this.save();
  const api=await this.client();
  if(images.length&&api.prepareImages){try{images=await api.prepareImages(images);}catch(error){record.prepareNote=error&&error.prepareSkipped?error.message:'本机助手未开启，已改用原图直接提交。';}}
  record.timings.preparedAt=Date.now();record.phase='上传图片，等待平台接单';
  record.pendingSubmissions=record.count;record.state='submitting';this.save();
  // Each requested output is submitted once. Independent requests need not wait
  // for the preceding model task to be accepted or completed.
  const failures=[];
  await Promise.all(Array.from({length:record.count},async(_,index)=>{
   try{const accepted=await api.submit(record.model,record.instruction,images,params,record.id+'-'+index);if(accepted&&typeof accepted==='object'&&Array.isArray(accepted.images)&&accepted.images.length){record.tasks.push({id:'sync-'+record.id+'-'+index,state:'ready',results:accepted.images.map(source=>({source,imported:false})),outputIndex:index});}else{record.tasks.push({id:accepted,state:'running',results:[],outputIndex:index});}}
   catch(e){failures.push(e);record.error=e.message;if(e.diagnostic)record.diagnostic=e.diagnostic;if(e.submissionRequestId){record.recoveries=record.recoveries||[];record.recoveries.push({requestId:e.submissionRequestId,outputIndex:index});}if(e.submissionId){record.submissionId=e.submissionId;record.recoveries=record.recoveries||[];record.recoveries.push({id:e.submissionId,outputIndex:index});}}
   finally{record.pendingSubmissions--;record.phase='已接单 '+record.tasks.length+'/'+record.count+'，待响应 '+record.pendingSubmissions;refreshOutputNote(record);this.save();}
  }));
  record.tasks.sort((a,b)=>a.outputIndex-b.outputIndex);
  record.timings.acceptedAt=Date.now();
  if(failures.length){record.error=[...new Set(failures.map(e=>e&&e.message).filter(Boolean))].join('；')||'生成提交失败。';record.state=failures.some(e=>!e.terminal)?'uncertain':record.tasks.some(t=>t.state==='running')?'running':record.tasks.length&&record.tasks.every(t=>t.state==='ready')?'ready':'failed';record.phase=record.state==='uncertain'?'提交结果待确认，请勿重复生成':record.state==='running'?'部分已接单，其余提交失败':'提交失败';}
  else{record.phase='平台生成中';record.state=record.tasks.every(t=>t.state==='ready')?'ready':record.tasks.some(t=>t.state==='running')?'running':'failed';}
  refreshOutputNote(record);this.save();
 }
 async tick(){await Promise.all(this.jobs.filter(job=>job.state==='uncertain'&&job.recoveries?.length).map(job=>this.recover(job)));await Promise.all(this.jobs.flatMap(job=>job.tasks.filter(task=>task.state==='running').map(task=>this.query(job,task))));}
 async recover(job){
  const key='recover-'+job.id;if(this.querying.has(key))return;this.querying.add(key);
  try{
   const api=await this.client();if(!api.resumeSubmission)return;
   for(const recovery of [...job.recoveries]){
    const record=await api.resumeSubmission(recovery.id,recovery.requestId);let task;
    if(record.state==='accepted'&&record.taskId)task={id:record.taskId,state:'running',results:[],outputIndex:recovery.outputIndex};
    else if(record.state==='complete'&&record.images?.length)task={id:'sync-'+job.id+'-'+recovery.outputIndex,state:'ready',results:record.images.map(source=>({source,imported:false})),outputIndex:recovery.outputIndex};
    else if(record.state==='failed'){job.error=record.error;job.recoveries=job.recoveries.filter(item=>item!==recovery);continue;}
    if(task){if(!job.tasks.some(item=>item.outputIndex===task.outputIndex))job.tasks.push(task);job.recoveries=job.recoveries.filter(item=>item!==recovery);}
   }
   if(!job.recoveries.length){job.state=job.tasks.some(task=>task.state==='running')?'running':job.tasks.length&&job.tasks.every(task=>task.state==='ready')?'ready':'failed';if(job.state!=='failed')job.error='';}
  }catch{/* A read-only retry can resume later; never submit from recovery. */}finally{this.querying.delete(key);this.save();}
 }
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
  sharePolledTask(job,task);
  if(job.state!=='uncertain'&&!job.pendingSubmissions)job.state=job.tasks.every(t=>t.state==='ready')?'ready':job.tasks.some(t=>t.state==='running')?'running':'failed';
 }catch(e){task.error=e.message;if(e.terminal){task.state='failed';task.results=[];if(job.state!=='uncertain')job.state=job.tasks.some(t=>t.state==='running')?'running':'failed';}}finally{this.querying.delete(task.id);refreshOutputNote(job);this.save();}}
}
function fingerprint(value){
 let hash=2166136261;
 const text=String(value);
 for(let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619);
 return (hash>>>0).toString(16).padStart(8,'0');
}
function sharePolledTask(job,task){
 for(const other of job.tasks||[]){
  if(other===task||String(other.id)!==String(task.id)||other.state==='ready') continue;
  other.state=task.state;
  other.error=task.error||null;
  other.results=(task.results||[]).map(result=>({source:result.source,imported:false}));
 }
}
function refreshOutputNote(record){
 if(!record) return;
 const marker='输出核对：';
 const base=String(record.prepareNote||'').split(marker)[0].trim();
 const tasks=Array.isArray(record.tasks)?record.tasks:[];
 const ids=tasks.map(task=>String(task.id||'')).filter(Boolean);
 const sources=[];
 tasks.forEach(task=>(task.results||[]).forEach(result=>{if(result&&result.source)sources.push(String(result.source));}));
 const distinctIds=new Set(ids).size;
 const distinctSources=new Set(sources).size;
 const duplicateIds=ids.length>1&&distinctIds<ids.length;
 const duplicateSources=sources.length>1&&distinctSources<sources.length;
 if(!(record.count>1)||(!duplicateIds&&!duplicateSources)){record.prepareNote=base;return;}
 const parts=[marker+'提交 '+record.count+' 次，任务记录 '+ids.length+' 条，不同任务号 '+distinctIds+' 个'];
 if(ids.length) parts.push('任务号 '+ids.join('、'));
 if(sources.length) parts.push('结果 '+sources.length+' 条，地址摘要不同 '+distinctSources+' 个（'+sources.map(fingerprint).join('、')+'）');
 parts.push('没有改写提示词，也没有再次提交');
 record.prepareNote=(base?base+' ':'')+parts.join('。')+'。';
}
module.exports={TaskQueue,fingerprint};
