const HOSTS=['http://127.0.0.1:5173/api/bridge','http://localhost:5173/api/bridge'];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class OptimizerClient {
  constructor({fetchImpl=fetch,timeoutMs=15*60*1000,pollMs=800,retryMs=500,xhrFactory=typeof XMLHttpRequest==='undefined'?null:()=>new XMLHttpRequest()}={}){
    this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.pollMs=pollMs;this.retryMs=retryMs;this.xhrFactory=xhrFactory;this.controller=null;this.epoch=0;this.base=HOSTS[0];
  }
  cancel(){++this.epoch;this.controller?.abort();this.controller=null;}
  async request(path,{method='GET',body,timeoutMs=10000,epoch=this.epoch}={}){
    if(epoch!==this.epoch)throw new Error('已取消优化。');
    const controller=new AbortController();this.controller=controller;
    const headers={'X-Cine-Bridge':'1',...(body?{'Content-Type':'application/json'}:{})};
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      let response;
      try{response=await this.fetch(this.base+path,{method,signal:controller.signal,credentials:'omit',headers,...(body?{body:JSON.stringify(body)}:{})});}
      catch(error){
        if(epoch!==this.epoch)throw new Error('已取消优化。');
        if(!this.xhrFactory)throw error;
        response=await this.xhr(this.base+path,{method,headers,body,timeoutMs,signal:controller.signal});
      }
      if(epoch!==this.epoch)throw new Error('已取消优化。');
      let data;try{data=await response.json();}catch{throw new Error('影词联动返回格式不正确，请更新桌面程序后重试。');}
      if(!response.ok){const error=new Error(data.error||`影词联动请求失败（HTTP ${response.status}）。`);error.status=response.status;throw error;}
      return data;
    }finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
  xhr(url,{method,headers,body,timeoutMs,signal}){
    return new Promise((resolve,reject)=>{
      const req=this.xhrFactory();const abort=()=>req.abort();const clean=()=>signal.removeEventListener('abort',abort);
      req.open(method,url,true);req.timeout=timeoutMs;
      Object.entries(headers).forEach(([key,value])=>req.setRequestHeader(key,value));
      req.onload=()=>{clean();resolve({ok:req.status>=200&&req.status<300,status:req.status,json:async()=>JSON.parse(req.responseText)});};
      req.onerror=()=>{clean();reject(new Error('本机联动连接中断'));};
      req.ontimeout=()=>{clean();reject(new Error('本机联动连接超时'));};
      req.onabort=()=>{clean();reject(new Error('本机联动连接已取消'));};
      signal.addEventListener('abort',abort);if(signal.aborted){abort();reject(new Error('本机联动连接已取消'));return;}
      req.send(body?JSON.stringify(body):null);
    });
  }
  async health({epoch=this.epoch}={}){
    let last;
    for(let attempt=0;attempt<4;attempt++){
      for(const host of HOSTS){
        if(epoch!==this.epoch)throw new Error('已取消优化。');
        this.base=host;
        try{const result=await this.request('/health',{timeoutMs:3000,epoch});if(result.ok)return result;throw new Error('本地端口未返回影词服务');}catch(error){last=error;}
      }
      await delay(this.retryMs);
    }
    if(epoch!==this.epoch)throw new Error('已取消优化。');
    throw new Error(`无法连接影词的本地联动服务。窗口已打开时请退出托盘中的影词再重新打开，然后重试优化。${last?.status?' HTTP '+last.status:''}`);
  }
  async optimize({text='',images=[],target='generic_image'}={}){
    this.cancel();const epoch=this.epoch;
    await this.health({epoch});
    // Only create once: retries are limited to read-only polling, avoiding duplicate image submissions.
    let session;
    try{session=await this.request('/sessions',{method:'POST',body:{text,images,purpose:'ps_local_edit',target,language:'zh',direction:''},timeoutMs:60000,epoch});}
    catch(error){if(epoch!==this.epoch)throw new Error('已取消优化。');if(error.status)throw error;throw new Error('图片传送到影词时连接中断，请重试优化；不需要重新添加原图。');}
    if(!session.sessionId)throw new Error('影词联动版本不兼容，请更新桌面程序。');
    const deadline=Date.now()+this.timeoutMs;let failures=0;
    while(Date.now()<deadline){
      if(epoch!==this.epoch)throw new Error('已取消优化。');
      try{
        const state=await this.request('/session?id='+encodeURIComponent(session.sessionId),{epoch});failures=0;
        if(state.state==='complete')return state.result;
        if(state.state==='error')throw Object.assign(new Error(state.error||'增强失败，请回到影词重试。'),{status:400});
      }catch(error){
        if(epoch!==this.epoch)throw new Error('已取消优化。');
        if(error.status===404)throw new Error('影词已重启或联动会话已过期，请在 PS 重新点击优化。');
        if(error.status)throw error;
        if(++failures>=8)throw new Error('图片已传入影词，但回传连接持续中断。请保持影词运行后重试。');
      }
      await delay(this.pollMs);
    }
    throw new Error('等待增强结果超时。请在 PS 重新点击优化，再到影词完成增强。');
  }
}
module.exports={OptimizerClient};
