const {OFFLINE_MESSAGE, UPLOAD_MESSAGE}=require('./optimize-image');
const BASE_URL='http://127.0.0.1:5173/api/bridge';
const RETRY_MESSAGE='请求没能传到影词魔方。请稍后重试。';

function isSizeReason(status, reason){
  return status===413 || /过大|超过\s*\d+\s*MB|14\s*MB|26\s*MB|payload|entity too large|too large/i.test(reason||'');
}
function isTransport(error){
  if(!error||error.status)return false;
  return /fetch|network|connect|failed|reset|socket|ECONN|EPIPE|aborted|timeout|timed out|Load failed/i.test(String(error.message||''));
}

class OptimizerClient {
  constructor({fetchImpl=fetch,timeoutMs=15*60*1000,maxBodyBytes=12*1024*1024,baseUrl=BASE_URL}={}){
    this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.maxBodyBytes=maxBodyBytes;this.baseUrl=baseUrl;this.controller=null;this.cancelled=false;
  }
  cancel(){this.cancelled=true;this.controller?.abort();this.controller=null;}
  async probe(){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await this.fetch(this.baseUrl+'/health',{method:'GET',signal:controller.signal,credentials:'omit',headers:{'X-Cine-Bridge':'1'}});
      return !!(response&&response.ok);
    }catch{return false;}
    finally{clearTimeout(timer);}
  }
  async request(path,{method='GET',body,timeoutMs=this.timeoutMs,purpose='call'}={}){
    this.cancel();this.cancelled=false;
    const hadImages=Array.isArray(body?.images)&&body.images.length>0;
    let payload;
    if(body){
      payload=JSON.stringify(body);
      if(payload.length>this.maxBodyBytes)throw new Error(UPLOAD_MESSAGE);
    }
    const controller=new AbortController();this.controller=controller;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await this.fetch(this.baseUrl+path,{method,signal:controller.signal,credentials:'omit',headers:{'X-Cine-Bridge':'1',...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:payload}:{})});
      let data;
      try{data=await response.json();}
      catch{
        if(!response.ok){
          const message=isSizeReason(response.status,'')?UPLOAD_MESSAGE:`影词魔方优化失败（HTTP ${response.status}）。`;
          throw Object.assign(new Error(message),{status:response.status,upload:message===UPLOAD_MESSAGE});
        }
        throw new Error('影词魔方返回了无效结果。');
      }
      if(!response.ok){
        const reason=typeof data?.error==='string'?data.error:'';
        const message=isSizeReason(response.status,reason)?UPLOAD_MESSAGE:(reason||`影词魔方优化失败（HTTP ${response.status}）。`);
        throw Object.assign(new Error(message),{status:response.status,upload:message===UPLOAD_MESSAGE});
      }
      return data;
    }catch(error){
      if(this.cancelled)throw new Error('已取消优化。');
      if(error&&(error.upload||error.message===UPLOAD_MESSAGE))throw new Error(UPLOAD_MESSAGE);
      if(error&&error.status)throw error;
      if(error&&error.name==='AbortError')throw new Error(purpose==='health'?OFFLINE_MESSAGE:'优化等待超时，请稍后重试。');
      // A failed POST is not proof that 影词魔方 is closed: an oversized body dies inside fetch
      // with the same message as a refused port. Check /health before using the offline text.
      if(isTransport(error)||purpose==='health'){
        if(purpose==='health')throw new Error(OFFLINE_MESSAGE);
        const online=await this.probe();
        if(this.cancelled)throw new Error('已取消优化。');
        if(!online)throw new Error(OFFLINE_MESSAGE);
        throw new Error(hadImages?UPLOAD_MESSAGE:RETRY_MESSAGE);
      }
      throw error;
    }finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
  health(){return this.request('/health',{timeoutMs:5000,purpose:'health'});}
  optimize({text='',images=[],target='generic_image'}={}){
    return this.request('/optimize',{method:'POST',purpose:'optimize',body:{text,images,purpose:'ps_local_edit',target,language:'zh',direction:''}});
  }
}

module.exports={OptimizerClient,OFFLINE_MESSAGE,UPLOAD_MESSAGE};
