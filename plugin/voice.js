// Talks only to the user's local Windows helper, never to the image API.
class VoiceController {
  constructor({fetchImpl=fetch,onState=()=>{},onText=()=>{},context=()=>null}={}) {
    this.fetch=fetchImpl;this.onState=onState;this.onText=onText;this.context=context;
    this.session=null;this.epoch=0;this.timer=null;this.phase='idle';
  }
  update(state,message){this.phase=state;this.onState({state,message});}
  async request(path,method='GET') {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path.startsWith('/clipboard')?25000:5000);
    try {
      const response=await this.fetch('http://127.0.0.1:17402'+path,{method,signal:controller.signal,credentials:'omit',headers:{'X-PS-Local-Voice':'1'}});
      const data=await response.json();if(!response.ok)throw new Error(data.message||'本机语音服务异常。');return data;
    } catch(error) {
      if(error.name==='AbortError'||/fetch|network|connect/i.test(error.message||''))throw new Error((path.startsWith('/clipboard')?'本机截图粘贴服务':'本机语音服务')+'未连接。请双击“打开局部改图插件.cmd”后重试。');
      throw error;
    } finally {clearTimeout(timer);}
  }
  async start() {
    if(['starting','listening','stopping'].includes(this.phase))return;
    const epoch=++this.epoch,context=this.context();this.update('starting','正在启动中文听写…');
    try {
      const health=await this.request('/health');
      if(health.state!=='ready')throw new Error(health.message||'语音引擎启动中，请稍后再点语音。');
      if(epoch!==this.epoch)return;
      let session;
      for(let attempt=0;attempt<8;attempt++){
        try{session=await this.request('/start','POST');break;}
        catch(error){
          if(!/正在结束上一段语音/.test(error.message)||attempt===7)throw error;
          await new Promise(resolve=>setTimeout(resolve,500));
          if(epoch!==this.epoch)return;
        }
      }
      if(!session)throw new Error('语音启动失败，请再试一次。');
      if(epoch!==this.epoch){await this.request('/stop?id='+encodeURIComponent(session.id),'POST');return;}
      // Photoshop can recreate the UXP panel while Windows dictation keeps
      // running. Adopt that session at its current cursor without repeating
      // text that was already inserted before the panel reload.
      this.session={id:session.id,cursor:Number(session.cursor)||0,context};await this.poll(epoch);
    } catch(error){if(epoch===this.epoch){this.session=null;this.update('error',error.message);}}
  }
  async poll(epoch) {
    if(epoch!==this.epoch||!this.session)return;
    if(this.session.context!==this.context()){this.cancel();return;}
    try {
      const data=await this.request('/status?id='+encodeURIComponent(this.session.id)+'&cursor='+this.session.cursor);
      if(epoch!==this.epoch)return;
      for(const event of data.events||[])if(event.seq>this.session.cursor){this.onText(event.text);this.session.cursor=event.seq;}
      const inputLevel=Math.max(0,Math.min(100,Number(data.audioLevel)||0));
      const listeningMessage=data.state==='listening'?(inputLevel<3?'正在听写 · 暂未检测到声音，请检查麦克风。':`正在听写 · 输入音量 ${inputLevel}%`):'';
      this.update(data.state,data.message||(listeningMessage|| (data.state==='stopping'?'正在结束听写…':'正在启动中文听写…')));
      if(['complete','error'].includes(data.state)){this.session=null;return;}
      this.timer=setTimeout(()=>this.poll(epoch),350);
    } catch(error){if(epoch===this.epoch){const id=this.session?.id;this.session=null;this.update('error',error.message);if(id)this.request('/stop?id='+encodeURIComponent(id),'POST').catch(()=>{});}}
  }
  async stop() {
    if(!this.session){this.cancel();return;}
    const epoch=this.epoch;this.update('stopping','正在结束听写…');
    try{await this.request('/stop?id='+encodeURIComponent(this.session.id),'POST');}
    catch(error){if(epoch===this.epoch){this.cancel();this.update('error',error.message);}}
  }
  cancel() {
    ++this.epoch;clearTimeout(this.timer);const id=this.session?.id;this.session=null;this.update('idle','');
    if(id)this.request('/stop?id='+encodeURIComponent(id),'POST').catch(()=>{});
  }
}
module.exports={VoiceController};
