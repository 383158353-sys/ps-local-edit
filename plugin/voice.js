// HTTP client for the optional Windows local helper (127.0.0.1:17402).
// The helper provides clipboard, annotation, file-picker and drag-drop support.
// Voice dictation has been removed; this class is kept for the helper HTTP layer.
class LocalHelper {
  constructor({fetchImpl=fetch}={}) {
    this.fetch=fetchImpl;this.starting=null;this.readyAt=0;
  }
  async ensureRunning(){
    if(this.readyAt&&Date.now()-this.readyAt<5000)return;
    const probe=async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1500);try{const response=await this.fetch('http://127.0.0.1:17402/health',{headers:{'X-PS-Local-Voice':'1'},signal:controller.signal});if(response.ok){this.readyAt=Date.now();return true;}return false;}finally{clearTimeout(timer);}};
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      try{if(await probe())return;}catch{}
      try{const {shell}=require('uxp');await shell.openExternal('pslocaledit-helper://start');}catch{throw new Error('独立助手尚未启动，请运行安装目录中的 start-helper.vbs。');}
      for(let attempt=0;attempt<20;attempt++){await new Promise(resolve=>setTimeout(resolve,500));try{if(await probe())return;}catch{}}
      throw new Error('独立助手启动超时，请运行 start-helper.vbs；无需打开影词魔方。');
    })().finally(()=>{this.starting=null;});return this.starting;
  }
  async request(path,method='GET',body=null) {
    await this.ensureRunning();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path.startsWith('/pick-images')?185000:path.startsWith('/clipboard')||path.startsWith('/annotate')||path.startsWith('/images/prepare')||path.startsWith('/drop')?25000:5000);
    const preparing=path.startsWith('/images/prepare');
    try {
      const response=await this.fetch('http://127.0.0.1:17402'+path,{method,signal:controller.signal,credentials:'omit',headers:{'X-PS-Local-Voice':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      let data={};
      try{data=await response.json();}catch(_){data={};}
      if(!response.ok){
        const raw=String(data.message||'');
        if(preparing||/语音会话|未知语音请求|本机服务没有这个接口/.test(raw)){
          const error=new Error(preparing?'本机助手当前版本不支持图片预处理，已使用原图直接提交。':'本机助手会话已结束。');
          error.prepareSkipped=preparing;
          error.sessionGone=!preparing;
          throw error;
        }
        throw new Error(raw||'本机服务异常。');
      }
      return data;
    } catch(error) {
      if(preparing){if(error.prepareSkipped)throw error;const skipped=new Error('图片预处理未完成，已使用原图直接提交。');skipped.prepareSkipped=true;throw skipped;}
      if(error.sessionGone)throw error;
      if(error.name==='AbortError'||/fetch|network|connect/i.test(error.message||'')){this.readyAt=0;throw new Error((path.startsWith('/clipboard')?'本机截图粘贴服务':path.startsWith('/drop')?'本机图片拖入服务':path.startsWith('/annotate')?'本机图片标注服务':'本机助手')+'未连接。请运行独立助手 start-helper.vbs 后重试。');}
      throw error;
    } finally {clearTimeout(timer);}
  }
}
module.exports={LocalHelper};
