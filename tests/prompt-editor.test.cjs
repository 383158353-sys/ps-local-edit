const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PromptEditor}=require('../plugin/prompt-editor');

function node(value=''){
  return {value,selectionStart:0,selectionEnd:0,events:{},addEventListener(name,fn){this.events[name]=fn;},focus(){this.focused=true;}};
}
function fixture(options={}){
  const input=node('红色花瓶'),voice=node(),expand=node(),classes=new Set();
  const container={classList:{contains:name=>classes.has(name),toggle(name,force){if(force)classes.add(name);else classes.delete(name);}}};
  expand.setAttribute=(name,value)=>{expand[name]=value;};
  const changes=[],images=[],notices=[];
  const editor=new PromptEditor({node:input,voiceButton:voice,expandButton:expand,container,clipboard:{getContent:async()=>({'text/plain':'白色'})},onChange:text=>changes.push(text),onImage:image=>images.push(image),onNotice:(...args)=>notices.push(args),onVoice:()=>{},readImageClipboard:async()=>({}),...options});
  return {editor,input,voice,expand,container,changes,images,notices};
}
function pasteEvent(clipboardData={}){
  return {clipboardData,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
}
async function flush(){await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));}

test('plain text paste replaces selected words and preserves surrounding prompt',async()=>{
  const h=fixture();h.input.selectionStart=0;h.input.selectionEnd=2;
  const event=pasteEvent();h.input.events.paste(event);await flush();
  assert.equal(h.input.value,'白色花瓶');assert.equal(h.input.selectionStart,2);assert.equal(h.changes.at(-1),'白色花瓶');assert.equal(event.prevented,true);
});

test('screenshot paste adds a reference without changing prompt or caret',async()=>{
  const h=fixture({clipboard:{getContent:async()=>({})},readImageClipboard:async()=>({image:'data:image/png;base64,YWJj'})});
  h.input.selectionStart=h.input.selectionEnd=2;h.input.events.paste(pasteEvent());await flush();
  assert.deepEqual(h.images,['data:image/png;base64,YWJj']);assert.equal(h.input.value,'红色花瓶');assert.equal(h.input.selectionStart,2);
});
test('paste image action reads screenshot and never inserts clipboard text',async()=>{
  const h=fixture({clipboard:{getContent:async()=>({'text/plain':'别改提示词'})},readImageClipboard:async()=>({image:'data:image/png;base64,YWJj'})});
  await h.editor.pasteImage();
  assert.deepEqual(h.images,['data:image/png;base64,YWJj']);
  assert.equal(h.input.value,'红色花瓶');
});
test('prompt height follows its content and stops growing after the limit',()=>{
  const h=fixture();h.input.style={};
  Object.defineProperty(h.input,'scrollHeight',{get(){return this.value.length>500?600:this.value.length>50?148:56;}});
  h.editor.resize();assert.equal(h.input.style.height,'56px');
  h.input.value='文字'.repeat(30);h.editor.changed();assert.equal(h.input.style.height,'148px');
  h.input.value='文字'.repeat(300);h.editor.changed();assert.equal(h.input.style.height,'320px');
});

test('Ctrl+V followed by a paste event inserts clipboard content exactly once',async()=>{
  let reads=0;const h=fixture({clipboard:{getContent:async()=>{reads++;return {'text/plain':'加上'};}}});
  let keyDefaultPrevented=false;h.input.events.keydown({key:'v',ctrlKey:true,stopPropagation(){},preventDefault(){keyDefaultPrevented=true;}});
  h.input.events.paste(pasteEvent());await flush();await new Promise(resolve=>setTimeout(resolve,140));
  assert.equal(h.input.value,'加上红色花瓶');assert.equal(h.changes.length,1);assert.equal(reads,1);assert.equal(keyDefaultPrevented,false);
});

test('Ctrl+V falls back once when UXP does not emit a paste event',async()=>{
  let reads=0;const h=fixture({clipboard:{getContent:async()=>{reads++;return {'text/plain':'加上'};}}});
  h.input.events.keydown({key:'v',ctrlKey:true,stopPropagation(){},preventDefault(){}});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(h.input.value,'加上红色花瓶');assert.equal(h.changes.length,1);assert.equal(reads,1);
});

test('late paste cannot alter a different region after switching history',async()=>{
  let resolve,context='a';const h=fixture({context:()=>context,clipboard:{getContent:()=>new Promise(r=>resolve=r)}});
  h.input.events.paste(pasteEvent());context='b';h.input.value='新的修改';resolve({'text/plain':'旧剪贴板'});await flush();
  assert.equal(h.input.value,'新的修改');assert.deepEqual(h.changes,[]);
});

test('dictation inserts at caret without replacing typed prompt',()=>{
  const h=fixture();h.input.selectionStart=h.input.selectionEnd=4;h.editor.insert('，保留纹理');
  assert.equal(h.input.value,'红色花瓶，保留纹理');h.editor.voice({state:'listening',message:'正在听写'});assert.equal(h.voice.textContent,'⏹ 停止');
});

test('context-menu paste inserts text once without a separate paste button',async()=>{
  const h=fixture();h.input.selectionStart=h.input.selectionEnd=2;const event=pasteEvent();h.input.events.paste(event);await flush();
  assert.equal(event.prevented,true);assert.equal(h.input.value,'红色白色花瓶');assert.equal(h.changes.length,1);
});

test('copied image file with an empty MIME type does not ask the helper',async()=>{
  let helperCalls=0;
  const h=fixture({readHelperClipboard:async()=>{helperCalls++;return null;},readImageClipboard:async()=>({text:'不要插入'})});
  const file={name:'shot.png',type:'',size:1,arrayBuffer:async()=>Uint8Array.from([65]).buffer};
  h.input.events.paste(pasteEvent({files:[file],items:[]}));
  await flush();
  assert.equal(helperCalls,0);
  assert.equal(h.images[0],'data:image/png;base64,QQ==');
  assert.equal(h.input.value,'红色花瓶');
});
test('paste image uses the helper only after clipboard files are empty',async()=>{
  const h=fixture({clipboard:{getContent:async()=>({})},readImageClipboard:async()=>({}),readHelperClipboard:async()=>({success:true,image:'data:image/png;base64,QQ=='})});
  await h.editor.pasteImage();
  assert.deepEqual(h.images,['data:image/png;base64,QQ==']);
  assert.equal(h.input.value,'红色花瓶');
});
test('a stopped helper does not block paste',async()=>{
  const h=fixture({clipboard:{getContent:async()=>({})},readImageClipboard:async()=>{throw new Error('本机截图粘贴服务未连接。');},readHelperClipboard:async()=>{throw new Error('ECONNREFUSED');}});
  await h.editor.pasteImage();
  assert.equal(h.images.length,0);
  assert.match(h.notices.at(-1)[0],/未连接|没有图片/);
});
test('expand button reveals the full editable prompt and Escape collapses it without changing text',()=>{
  const h=fixture();const original=h.input.value;
  h.expand.events.click();
  assert.equal(h.container.classList.contains('expanded'),true);assert.equal(h.expand.title,'收起修改要求');assert.equal(h.expand['aria-expanded'],'true');assert.equal(h.input.value,original);
  let prevented=false;h.input.events.keydown({key:'Escape',stopPropagation(){},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.container.classList.contains('expanded'),false);assert.equal(h.expand.title,'展开修改要求');assert.equal(h.input.value,original);
});
