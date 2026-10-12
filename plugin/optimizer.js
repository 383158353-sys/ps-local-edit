const BASE_URL='http://127.0.0.1:5173/api/bridge';

class OptimizerClient {
  constructor({fetchImpl=fetch,timeoutMs=15*60*1000}={}){this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.controller=null;this.cancelled=false;}
  cancel(){this.cancelled=true;this.controller?.abort();this.controller=null;}
  async request(path,{method='GET',body,timeoutMs=this.timeoutMs}={}){
    this.cancel();this.cancelled=false;
    const controller=new AbortController();this.controller=controller;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await this.fetch(BASE_URL+path,{method,signal:controller.signal,credentials:'omit',headers:{'X-Cine-Bridge':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      let data;try{data=await response.json();}catch{throw new Error('影词魔方返回了无效结果。');}
      if(!response.ok)throw new Error(data.error||'影词魔方优化失败。');
      return data;
    }catch(error){
      if(error.name==='AbortError')throw new Error(this.cancelled?'已取消优化。':'优化等待超时，请稍后重试。');
      if(/fetch|network|connect|failed/i.test(error.message||''))throw new Error('影词魔方没有运行。请从开始菜单打开「影词魔方」后再点优化。');
      throw error;
    }finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
  health(){return this.request('/health',{timeoutMs:5000});}
  optimize({text='',images=[],target='generic_image'}={}){return this.request('/optimize',{method:'POST',body:{text,images,purpose:'ps_local_edit',target,language:'zh',direction:''}});}
}

module.exports={OptimizerClient};
