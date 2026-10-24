// Native UXP textarea keeps Photoshop keyboard focus out of embedded WebViews.
class PromptEditor {
  constructor({node,voiceButton,expandButton,container,clipboard,onChange,onImage,onNotice,onVoice,context=()=>null,readImageClipboard}) {
    Object.assign(this,{node,voiceButton,expandButton,container,clipboard,onChange,onImage,onNotice,onVoice,context,readImageClipboard});
    this.busy=false;this.pasting=false;this.voiceState='idle';this.pendingPaste=null;this.pasteSnap=null;this.pasteFallbackTimer=null;
    node.addEventListener('input',()=>this.changed());
    node.addEventListener('beforeinput',event=>{
      if(event.inputType==='insertFromPaste'||event.inputType==='insertFromPasteAsQuotation')this.pasteSnap=this.captureSelection();
    });
    node.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'&&this.container?.classList?.contains('expanded')){event.preventDefault();this.setExpanded(false);return;}
      if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='v'){
        // Remember the field before Photoshop inserts. Some UXP builds still
        // paste natively after preventDefault, and inserting again doubles the text.
        const pending=this.captureSelection();this.pasteSnap=pending;this.pendingPaste=pending;
        clearTimeout(this.pasteFallbackTimer);
        this.pasteFallbackTimer=setTimeout(()=>{
          if(this.pendingPaste!==pending)return;
          this.pendingPaste=null;this.pasteFallbackTimer=null;
          this.pasteFallback(pending).catch(error=>this.onNotice(error.message||'粘贴失败，请重试。',true));
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
    this.resize();
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
  changed(){this.resize();this.onChange(this.node.value);}
  resize(){
    if(!this.node.style)return;
    this.node.style.height='56px';
    const estimatedLines=String(this.node.value||'').split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil(line.length/32)),0);
    const measured=Number(this.node.scrollHeight)||estimatedLines*18+42;
    this.node.style.height=Math.min(320,Math.max(56,measured))+'px';
  }
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
  captureSelection(){
    const node=this.node,value=node.value||'';
    const start=Number.isFinite(node.selectionStart)?node.selectionStart:value.length;
    const end=Number.isFinite(node.selectionEnd)?node.selectionEnd:start;
    return {value,start,end,context:this.context()};
  }
  restorePrompt(snap){
    if(!snap)return;
    const node=this.node;
    if((node.value||'')===snap.value)return;
    node.value=snap.value;
    node.selectionStart=snap.start;node.selectionEnd=snap.end;
  }
  applyClipboardText(snap,value){
    const text=String(value||'').replace(/\r\n?/g,'\n');
    if(!text||!snap)return;
    const node=this.node,current=node.value||'';
    const once=snap.value.slice(0,snap.start)+text+snap.value.slice(snap.end);
    if(current===once){node.selectionStart=node.selectionEnd=Math.min(snap.start+text.length,once.length);this.changed();return;}
    if(current!==snap.value)return;
    node.selectionStart=snap.start;node.selectionEnd=snap.end;
    this.insert(text);
  }
  handlePaste(event){
    if(this.busy){event.preventDefault();event.stopPropagation();return;}
    // Snapshot first. UXP may insert the clipboard text while preventDefault runs,
    // or may already have inserted it; pasteFallback must not add that text again.
    const snap=this.pasteSnap||this.captureSelection();
    this.pasteSnap=null;
    event.preventDefault();event.stopPropagation();
    this.pendingPaste=null;clearTimeout(this.pasteFallbackTimer);this.pasteFallbackTimer=null;
    if(this.pasting)return;
    const image=this.clipboardImage(event);
    if(image){this.pasting=true;this.restorePrompt(snap);this.addClipboardImage(image,snap.context).catch(error=>this.onNotice(error.message,true)).finally(()=>{this.pasting=false;});return;}
    this.pasteFallback(snap).catch(error=>this.onNotice(error.message||'粘贴失败，请重试。',true));
  }
  setBusy(busy){
    if(this.busy===busy)return;this.busy=busy;
    this.node.readOnly=busy;this.voiceButton.disabled=busy;if(this.expandButton)this.expandButton.disabled=busy;
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
  async pasteFallback(expected){
    if(this.busy||this.pasting)return;this.pasting=true;
    const snap=expected&&typeof expected==='object'&&typeof expected.value==='string'?expected:this.captureSelection();
    const expectedContext=snap.context??this.context();
    try{
      if(this.context()!==expectedContext)return;
      let contents={};try{contents=await this.clipboard?.getContent();}catch(_){}
      if(this.context()!==expectedContext||this.busy)return;
      for(const [type,value] of Object.entries(contents||{})){
        if(/^image\/(png|jpeg|webp)$/i.test(type)){
          if(typeof value==='string'&&value.startsWith('data:image/')){this.restorePrompt(snap);await this.onImage(value);this.onNotice('截图已添加到参考图。');return;}
          if(value instanceof ArrayBuffer || ArrayBuffer.isView(value)){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);const encoded=Array.from(bytes,b=>String.fromCharCode(b)).join('');const mime=type.toLowerCase();this.restorePrompt(snap);await this.onImage('data:'+mime+';base64,'+btoa(encoded));this.onNotice('截图已添加到参考图。');return;}
        }
      }
      let data={},bridgeError=null;
      try{data=await this.readImageClipboard();}catch(error){bridgeError=error;}
      if(this.context()!==expectedContext||this.busy)return;
      if(typeof data.image==='string'){this.restorePrompt(snap);await this.onImage(data.image);this.onNotice('截图已添加到参考图。');return;}
      if(typeof data.text==='string'&&data.text.length){this.applyClipboardText(snap,data.text);this.onNotice('');return;}
      if(typeof contents?.['text/plain']==='string'&&contents['text/plain'].length){this.applyClipboardText(snap,contents['text/plain']);this.onNotice('');return;}
      this.onNotice(bridgeError?.message||'剪贴板里没有文字或截图。',!!bridgeError);
      if(typeof this.node.focus==='function')this.node.focus();
    }catch(error){this.onNotice(error.message||'粘贴失败，请重新复制后再试。',true);}
    finally{this.pasting=false;}
  }
  async pasteImage(){
    if(this.busy||this.pasting)return;
    this.pasting=true;const context=this.context();
    try{
      let bridgeError=null;
      try{
        const data=await this.readImageClipboard();
        if(context!==this.context()||this.busy)return;
        if(typeof data.image==='string'){await this.onImage(data.image);this.onNotice('图片已添加到参考图。');return;}
      }catch(error){bridgeError=error;}
      let contents={};try{contents=await Promise.race([this.clipboard?.getContent()||Promise.resolve({}),new Promise(resolve=>setTimeout(()=>resolve({}),1200))]);}catch(_){}
      if(context!==this.context()||this.busy)return;
      for(const [type,value] of Object.entries(contents||{})){
        if(!/^image\/(png|jpeg|webp)$/i.test(type))continue;
        if(typeof value==='string'&&value.startsWith('data:image/')){await this.onImage(value);this.onNotice('截图已添加到参考图。');return;}
        if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
          const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
          let encoded='';for(const byte of bytes)encoded+=String.fromCharCode(byte);
          await this.onImage('data:'+type.toLowerCase()+';base64,'+btoa(encoded));this.onNotice('截图已添加到参考图。');return;
        }
      }
      throw bridgeError||new Error('剪贴板中没有图片，请先复制截图或图片文件。');
    }catch(error){this.onNotice(error.message||'粘贴图片失败。',true);}
    finally{this.pasting=false;}
  }
  voice(data){
    const live=['starting','listening','stopping'].includes(data.state);
    if(live)this.voiceEngaged=true;
    this.voiceState=data.state;
    this.voiceButton.textContent=live?'⏹ 停止':'🎙 语音';
    // Idle cancel and leftover session errors must not appear when dictation was never started.
    if(!this.voiceEngaged)return;
    this.onNotice(data.message||'',data.state==='error');
    if(data.state==='idle'||data.state==='complete')this.voiceEngaged=false;
  }
}
module.exports={PromptEditor};
