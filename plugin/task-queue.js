const {imageSources,unwrap}=require('./api');
class TaskQueue{
 constructor({jobs=[],persist,client,onChange}){this.jobs=jobs;this.persist=persist;this.client=client;this.onChange=onChange;this.querying=new Set();this.ticking=false;}
 save(){this.persist(this.jobs);this.onChange();}
 async submit(record,images,params){
  const index=this.jobs.findIndex(j=>j.id===record.id);if(index>=0)this.jobs[index]=record;else this.jobs.unshift(record);this.save();
  let api;try{api=await this.client(record);}catch(error){record.state='failed';record.submissionFailed=true;record.error=error.message;this.save();return;}
  for(let i=0;i<record.count;i++){
   record.state='submitting';this.save();let id;
   try{id=await api.submit(record.model,record.instruction,images,params);}catch(error){
    record.submissionFailed=true;record.state=error.uncertain===true?'uncertain':record.tasks.length?'running':'failed';
    record.error=(record.tasks.length?'已提交 '+record.tasks.length+' / '+record.count+' 张；剩余未自动重试。':'')+error.message;this.save();return;
   }
   record.tasks.push({id,state:'running',results:[]});this.save();
  }
  record.state=record.tasks.every(t=>t.state==='ready')?'ready':record.tasks.some(t=>t.state==='running')?'running':'failed';this.save();
 }
 async tick(){
  if(this.ticking)return;
  const pending=this.jobs.flatMap(job=>job.tasks.filter(task=>task.state==='running').map(task=>({job,task})));
  if(!pending.length)return;
  this.ticking=true;let next=0;
  try{await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
   while(next<pending.length){const {job,task}=pending[next++];await this.query(job,task,true);}
  }));}finally{this.ticking=false;this.save();}
 }
 async query(job,task,batched=false){if(this.querying.has(task.id))return;this.querying.add(task.id);try{const api=await this.client(job),response=await api.status(task.id),data=unwrap(response),state=data.state||response.state;task.progress=data.progress??response.progress;task.updatedAt=Date.now();task.error=null;if(data.is_final===true||response.is_final===true||['success','failed','error','cancelled','canceled'].includes(state)){task.state=state==='success'?'ready':'failed';const failure=data.error||response.error||data.failure_reason||data.失败原因;task.error=state==='success'?null:typeof failure==='string'?failure:failure?.message||failure?.type||data.msg||'平台任务失败';task.results=state==='success'?imageSources(response).map(source=>({source,imported:false})):[];if(task.state==='ready'&&!task.results.length){task.state='failed';task.error='平台完成但没有返回可识别图片。';}}else task.platformState=state||'running';if(job.state!=='uncertain'&&job.state!=='submitting')job.state=job.tasks.some(t=>t.state==='running')?'running':job.submissionFailed?'failed':job.tasks.every(t=>t.state==='ready')?'ready':'failed';}catch(e){task.error=e.message;}finally{this.querying.delete(task.id);if(!batched)this.save();}}
}
module.exports={TaskQueue};
