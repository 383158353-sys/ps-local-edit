// Fixed upstream, memory-only credentials, no retries or request logging.
async function forwardGeneration(value,fetchImpl=fetch){
 if(typeof value?.key!=='string'||!value.key.trim()||!value.payload||typeof value.payload.model!=='string')throw Error('提交参数无效。');
 const started=Date.now();
 const response=await fetchImpl('https://api.lk888.ai/v1/media/generate',{method:'POST',headers:{Authorization:'Bearer '+value.key,'Content-Type':'application/json'},body:JSON.stringify(value.payload),signal:AbortSignal.timeout(300000)});
 return {status:response.status,payload:await response.json(),elapsedMs:Date.now()-started};
}
module.exports={forwardGeneration};
