// HTTP client for the optional Windows local helper (127.0.0.1:17402).
// The helper provides clipboard, annotation, file-picker and drag-drop support.
// Voice dictation has been removed; this class is kept for the helper HTTP layer.
class LocalHelper {
  constructor({fetchImpl=fetch}={}) {
    this.fetch=fetchImpl;
  }
  async request(path,method='GET',body=null) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path.startsWith('/pick-images')?185000:path.startsWith('/clipboard')||path.startsWith('/annotate')||path.startsWith('/images/prepare')||path.startsWith('/drop')?25000:5000);
    const preparing=path.startsWith('/images/prepare');
    try {
      const response=await this.fetch('http://127.0.0.1:17402'+path,{method,signal:controller.signal,credentials:'omit',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      let data={};
      try{data=await response.json();}catch(_){data={};}
      if(!response.ok){
        const raw=String(data.message||'');
        if(preparing||/语音会话|未知语音请求|本机服务没有这个接口/.test(raw)){
          const error=new Error('本机助手未开启。');
          error.sessionGone=!preparing;
          throw error;
        }
        throw new Error(raw||'本机服务异常。');
      }
      return data;
    } catch(error) {
      if(preparing)throw new Error('本机助手未开启。');
      if(error.sessionGone)throw error;
      if(error.name==='AbortError'||/fetch|network|connect/i.test(error.message||''))throw new Error((path.startsWith('/clipboard')?'本机截图粘贴服务':path.startsWith('/drop')?'本机图片拖入服务':path.startsWith('/annotate')?'本机图片标注服务':'本机助手')+'未连接。请双击"打开局部改图插件.cmd"后重试。');
      throw error;
    } finally {clearTimeout(timer);}
  }
}
module.exports={LocalHelper};
