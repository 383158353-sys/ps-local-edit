import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import responseParser from '../shared/media-response.cjs';
const {unwrap,providerError,imageSources,taskIdentifier}=responseParser;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function classifySubmission(payload,status=200){
  const data=unwrap(payload)||{};
  const code=data.code??payload?.code;
  const businessFailure=data.success===false||payload?.success===false||data.error||payload?.error||
    (code!=null&&code!==''&&!['0','200','success','ok'].includes(String(code).toLowerCase()));
  if(status>=400||businessFailure){
    return {state:status>=500?'uncertain':'failed',error:providerError({...payload,...data,error:data.error||payload?.error,message:data.message||payload?.message,msg:data.msg||payload?.msg,detail:data.detail||payload?.detail},status),terminal:status<500};
  }
  const taskId=taskIdentifier(payload);if(taskId)return {state:'accepted',taskId};
  const images=imageSources(payload);if(images.length)return {state:'complete',images};
  return {state:'uncertain',error:'平台返回了响应，但没有可确认的任务编号或生成图片。已保留提交记录，禁止自动重复生成。'};
}
export function createSubmissionStore({directory,fetchImpl=fetch}){
  let queue=Promise.resolve();
  const active=new Map();
  const filename=id=>path.join(directory,id+'.json');
  const valid=id=>/^[a-f0-9]{64}$/.test(id);
  async function write(record){await fs.mkdir(directory,{recursive:true});const file=filename(record.id);await fs.writeFile(file+'.tmp',JSON.stringify(record),{mode:0o600});await fs.rename(file+'.tmp',file);}
  async function read(id){if(!valid(id))throw Object.assign(new Error('提交编号无效'),{status:400});try{return JSON.parse(await fs.readFile(filename(id),'utf8'));}catch(e){if(e.code==='ENOENT')throw Object.assign(new Error('未找到原提交记录，尚未重新提交。'),{status:404});throw e;}}
  async function get(id){const record=await read(id);if(record.state==='submitting'&&!active.has(id)){record.state='uncertain';record.error='服务曾在提交过程中重启，平台结果未确认；请核对平台任务，勿重复生成。';await write(record);}return record;}
  function safeText(value,key){return String(value??'').replaceAll(key,'[隐藏]').replace(/(Bearer\s+|sk[-_])[A-Za-z0-9._-]+/gi,'$1[隐藏]').slice(0,400);}
  async function dispatch(record,key,payload){
    try{
      const response=await fetchImpl('https://api.lk888.ai/v1/media/generate',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(300000)});
      const text=await response.text();let parsed;try{parsed=JSON.parse(text);}catch{}
      const outcome=parsed?classifySubmission(parsed,response.status):{state:'uncertain',error:'平台返回的不是 JSON，已保留提交记录，勿重复生成。'};
      const data=unwrap(parsed)||{};
      record.diagnostic={httpStatus:response.status,contentType:response.headers.get('content-type')||'',fields:parsed&&typeof parsed==='object'?Object.keys(parsed).slice(0,24):[],code:safeText(data.code??parsed?.code??'',key),message:safeText(data.message||data.msg||parsed?.message||parsed?.msg||'',key),errorCode:safeText(data.error_code??parsed?.error_code??'',key)};
      Object.assign(record,outcome);if(record.error)record.error=safeText(record.error,key);
    }catch{
      record.state='uncertain';record.error='后台提交连接中断或超时，平台是否接单尚未确认。原提交记录已保留，请勿重复生成。';
    }
    record.updatedAt=Date.now();await write(record);
  }
  async function start(input){
    const key=typeof input?.key==='string'?input.key.trim():'';const payload=input?.payload;
    if(!key||key.length>4096||!payload||typeof payload.model!=='string'||!payload.model.trim()||typeof payload.prompt!=='string'||!input.requestId||String(input.requestId).length>160)throw Object.assign(new Error('提交参数不完整，尚未发起生图。'),{status:400});
    const fingerprint=hash(key+'\0'+JSON.stringify(payload));
    const id=hash(key+'\0'+String(input.requestId));
    const operation=queue.then(async()=>{
      await fs.mkdir(directory,{recursive:true});
      try{const existing=await get(id);if(existing.fingerprint!==fingerprint)throw Object.assign(new Error('同一提交编号对应不同内容，已阻止提交。'),{status:409});return existing;}catch(e){if(e.status!==404)throw e;}
      for(const file of await fs.readdir(directory)){
        if(!/^[a-f0-9]{64}\.json$/.test(file))continue;
        const record=await get(file.slice(0,-5));
        if(record.fingerprint===fingerprint&&['submitting','uncertain'].includes(record.state))return {...record,reused:true};
      }
      const record={id,fingerprint,state:'submitting',createdAt:Date.now(),updatedAt:Date.now()};
      await write(record);
      const pending=dispatch(record,key,payload).catch(()=>{}).finally(()=>active.delete(id));active.set(id,pending);
      return {...record};
    });
    queue=operation.catch(()=>{});return operation;
  }
  async function release(input){
    if(input?.confirmedNotSubmitted!==true)throw Object.assign(new Error('请先在平台核对是否存在对应任务。'),{status:400});
    const record=await get(input.id);
    if(record.state!=='uncertain'||record.taskId||record.images?.length)throw Object.assign(new Error('原提交状态不允许解除保护。'),{status:409});
    record.state='failed';record.confirmedNotSubmittedAt=Date.now();record.error='用户已在平台确认无对应任务，可以重新提交。';await write(record);return {ok:true};
  }
  return {start,get,release,lookup:input=>get(hash(String(input?.key||'').trim()+'\0'+String(input?.requestId||''))),settled:()=>Promise.all([...active.values()])};
}
