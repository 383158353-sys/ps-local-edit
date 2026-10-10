// Native UXP textarea keeps Photoshop keyboard focus out of embedded WebViews.
class PromptEditor {
  constructor({node,voiceButton,expandButton,container,clipboard,onChange,onImage,onNotice,onVoice,context=()=>null,readImageClipboard}) {
    Object.assign(this,{node,voiceButton,expandButton,container,clipboard,onChange,onImage,onNotice,onVoice,context,readImageClipboard});
    this.busy=false;this.pasting=false;this.voiceState='idle';this.pendingPaste=null;this.pasteFallbackTimer=null;
    node.addEventListener('input',()=>this.changed());
    node.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'&&this.container?.classList?.contains('expanded')){event.preventDefault();this.setExpanded(false);return;}
      if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='v'){
        // Let the browser emit the actual paste event. Some UXP builds also
        // insert clipboard text natively when keydown is cancelled, so doing
        // both here and in `paste` duplicates the prompt. Fall back only when
        // no paste event arrives shortly after Ctrl+V.
        const pending={context:this.context()};this.pendingPaste=pending;
        clearTimeout(this.pasteFallbackTimer);
        this.pasteFallbackTimer=setTimeout(()=>{
          if(this.pendingPaste!==pending)return;
          this.pendingPaste=null;this.pasteFallbackTimer=null;
          this.pasteFallback(pending.context).catch(error=>this.onNotice(error.message||'粘贴失败，请重试。',true));
        },120);
      }
    });
    node.addEventListener('keyup',event=>event.stopPropagation());
    node.addEventListener('paste',event=>this.handlePaste(event));
    voiceButton.addEventListener('mousedown',event=>event.preventDefault());
    voiceButton.addEventListener('click',()=>{if(!this.busy)this.onVoice(['starting','listening','stopping'].includes(this.voiceState)?'stop':'start');});
    if(expandButton){
      expandButton.addEventListener('mousedown',event=>event.preventDefault());
      expandButton.addEventListener('click',()=>this.setExpanded(!this.container?.classList?.contains('expanded')));
    }
  }
  setExpanded(expanded){
    if(!this.container||!this.expandButton)return;
    this.container.classList.toggle('expanded',expanded);
    this.expandButton.textContent=expanded?'⤡':'⤢';
    this.expandButton.title=expanded?'收起修改要求':'展开修改要求';
    this.expandButton.setAttribute?.('aria-label',this.expandButton.title);
    this.expandButton.setAttribute?.('aria-expanded',String(expanded));
    if(expanded)this.node.focus();
  }
  changed(){this.onChange(this.node.value);}
  clipboardImage(event){
    const clipboard=event?.clipboardData;if(!clipboard)return null;
    const supported=type=>/^image\/(png|jpeg|webp)$/i.test(type||'');
    if(clipboard.files?.length){for(const file of clipboard.files)if(supported(file.type))return file;}
    for(const item of Array.from(clipboard.items||[]))if(supported(item.type)){const file=item.getAsFile?.();if(file)return file;}
    return null;
  }
  async addClipboardImage(file,context){
    if(this.busy||context!==this.context())return;
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取剪贴板图片失败。'));reader.readAsDataURL(file);});
    if(context!==this.context()||this.busy)return;
    if(typeof data!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(data))throw new Error('剪贴板图片格式暂不支持。');
    await this.onImage(data);this.onNotice('截图已添加到参考图。');
  }
  handlePaste(event){
    if(this.busy){event.preventDefault();event.stopPropagation();return;}
    // Always inspect the native Windows clipboard first: UXP sometimes labels
    // screenshots as text/plain, so relying on the paste event MIME types can
    // insert an image placeholder into the prompt instead of the reference list.
    event.preventDefault();event.stopPropagation();
    this.pendingPaste=null;clearTimeout(this.pasteFallbackTimer);this.pasteFallbackTimer=null;
    if(this.pasting)return;
    const context=this.context();
    const image=this.clipboardImage(event);
    if(image){this.pasting=true;this.addClipboardImage(image,context).catch(error=>this.onNotice(error.message,true)).finally(()=>{this.pasting=false;});return;}
    this.pasteFallback(context).catch(error=>this.onNotice(error.message||'粘贴失败，请重试。',true));
  }
  setBusy(busy){
    if(this.busy===busy)return;this.busy=busy;
    this.node.disabled=busy;this.voiceButton.disabled=busy;if(this.expandButton)this.expandButton.disabled=busy;
  }
  insert(value){
    if(this.busy||typeof value!=='string')return;
    const node=this.node,original=node.value||'';
    const start=Number.isFinite(node.selectionStart)?node.selectionStart:original.length;
    const end=Number.isFinite(node.selectionEnd)?node.selectionEnd:start;
    const text=value.replace(/\r\n?/g,'\n').slice(0,Math.max(0,20000-original.length+end-start));
    if(typeof node.setRangeText==='function')node.setRangeText(text,start,end,'end');
    else {node.value=original.slice(0,start)+text+original.slice(end);node.selectionStart=node.selectionEnd=start+text.length;}
    this.changed();
  }
  async pasteFallback(expectedContext=this.context()){
    if(this.busy||this.pasting)return;this.pasting=true;const context=this.context();
    try{
      if(context!==expectedContext)return;
      let contents={};try{contents=await this.clipboard?.getContent();}catch(_){}
      if(context!==this.context()||this.busy)return;
      for(const [type,value] of Object.entries(contents||{})){
        if(/^image\/(png|jpeg|webp)$/i.test(type)){
          if(typeof value==='string'&&value.startsWith('data:image/')){await this.onImage(value);this.onNotice('截图已添加到参考图。');return;}
          if(value instanceof ArrayBuffer || ArrayBuffer.isView(value)){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);const encoded=Array.from(bytes,b=>String.fromCharCode(b)).join('');const mime=type.toLowerCase();await this.onImage('data:'+mime+';base64,'+btoa(encoded));this.onNotice('截图已添加到参考图。');return;}
        }
      }
      let data={},bridgeError=null;
      try{data=await this.readImageClipboard();}catch(error){bridgeError=error;}
      if(context!==this.context()||this.busy)return;
      if(typeof data.image==='string'){await this.onImage(data.image);this.onNotice('截图已添加到参考图。');return;}
      if(typeof data.text==='string'&&data.text.length){this.insert(data.text);this.onNotice('');return;}
      if(typeof contents?.['text/plain']==='string'&&contents['text/plain'].length){this.insert(contents['text/plain']);this.onNotice('');return;}
      this.onNotice(bridgeError?.message||'剪贴板里没有文字或截图。',!!bridgeError);
      if(typeof this.node.focus==='function')this.node.focus();
    }catch(error){this.onNotice(error.message||'粘贴失败，请重新复制后再试。',true);}
    finally{this.pasting=false;}
  }
  voice(data){
    this.voiceState=data.state;this.voiceButton.textContent=['starting','listening','stopping'].includes(data.state)?'⏹ 停止':'🎙 语音';
    this.onNotice(data.message||'',data.state==='error');
  }
}
module.exports={PromptEditor};
