const {imageSources,unwrap,providerError}=require('./api');
class TaskQueue{
 constructor({jobs=[],persist,client,onChange}){this.jobs=jobs;this.persist=persist;this.client=client;this.onChange=onChange;this.querying=new Set();}
 save(){this.persist(this.jobs);this.onChange();}
 async submit(record,images,params){const index=this.jobs.findIndex(j=>j.id===record.id);if(index>=0)this.jobs[index]=record;else this.jobs.unshift(record);this.save();const api=await this.client();for(let i=0;i<record.count;i++){record.state='submitting';this.save();try{const id=await api.submit(record.model,record.instruction,images,params);record.tasks.push({id,state:'running',results:[]});this.save();}catch(e){record.state=e.terminal?'failed':'uncertain';record.error=e.message;this.save();return;}}record.state='running';this.save();}
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
  if(job.state!=='uncertain')job.state=job.tasks.every(t=>t.state==='ready')?'ready':job.tasks.some(t=>t.state==='running')?'running':'failed';
 }catch(e){task.error=e.message;if(e.terminal){task.state='failed';task.results=[];if(job.state!=='uncertain')job.state=job.tasks.some(t=>t.state==='running')?'running':'failed';}}finally{this.querying.delete(task.id);this.save();}}
}
module.exports={TaskQueue};
