// State belongs to the plugin; native value/selectedIndex/checked flags are never read.
// Stable control IDs also avoid depending on native DOM wrapper identity.
const controls=new Map(),popups=new WeakMap();let activeDocument=null;
function initChoices(doc){if(activeDocument)closeChoices(activeDocument);controls.clear();activeDocument=doc;}
function forgetChoice(id){controls.delete(id);}
function readChoice(node){return controls.get(node?.id)?.value||'';}
function paint(state){
 const chosen=state.values.find(item=>item.value===state.value),caption=chosen?.label||'请选择';
 if(state.caption.textContent!==caption)state.caption.textContent=caption;
 state.node.title=chosen?.description||caption;state.node.setAttribute('aria-label',state.label+'：'+caption);
}
function selectChoice(node,value){
 const state=controls.get(node?.id);if(!state)return false;
 if(value!==''&&!state.values.some(item=>item.value===value))return false;
 state.value=value;paint(state);return true;
}
function closeChoices(doc,restoreFocus=false){
 const popup=popups.get(doc);if(!popup)return;
 popup.owner.node.setAttribute('aria-expanded','false');popup.layer.parentNode?.removeChild(popup.layer);popups.delete(doc);
 if(restoreFocus)popup.owner.node.focus?.();
}
function openChoices(state){
 if(state.disabled)return;
 const doc=state.document,existing=popups.get(doc);
 if(existing?.owner===state){closeChoices(doc,true);return;}
 closeChoices(doc);
 const layer=doc.createElement('div'),sheet=doc.createElement('div'),header=doc.createElement('div'),title=doc.createElement('strong'),close=doc.createElement('div'),list=doc.createElement('div');
 layer.className='choice-backdrop';sheet.className='choice-sheet';header.className='choice-sheet-header';list.className='choice-sheet-list';
 sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','选择'+state.label);list.setAttribute('role','listbox');
 title.textContent='选择'+state.label;close.textContent='×';close.className='choice-close';close.setAttribute('role','button');close.setAttribute('tabindex','0');close.setAttribute('aria-label','关闭选项');
 const dismiss=event=>{event?.stopPropagation?.();closeChoices(doc,true);};close.addEventListener('click',dismiss);close.addEventListener('keydown',event=>{if(event.target===close&&!event.repeat&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key==='Enter'){event.preventDefault();dismiss(event);}});
 header.appendChild(title);header.appendChild(close);sheet.appendChild(header);sheet.appendChild(list);layer.appendChild(sheet);
 layer.addEventListener('click',event=>{if(event.target===layer)dismiss(event);});layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dismiss(event);}});
 const rows=[];
 state.values.forEach((item,index)=>{
  const row=doc.createElement('div'),text=doc.createElement('div'),label=doc.createElement('span'),mark=doc.createElement('span');
  row.className='choice-row';row.setAttribute('role','option');row.setAttribute('tabindex','0');row.setAttribute('aria-selected',String(item.value===state.value));row.setAttribute('data-value',item.value);
  label.textContent=item.label;text.appendChild(label);
  if(item.description){const detail=doc.createElement('span');detail.className='choice-detail';detail.textContent=item.description;text.appendChild(detail);}
  mark.textContent=item.value===state.value?'✓':'';mark.className='choice-mark';row.appendChild(text);row.appendChild(mark);
  const choose=event=>{event?.preventDefault?.();event?.stopPropagation?.();if(state.disabled)return;selectChoice(state.node,item.value);closeChoices(doc,true);state.onChange?.(item.value);};
  row.addEventListener('click',choose);row.addEventListener('keydown',event=>{
   if(event.target!==row||event.repeat||event.altKey||event.ctrlKey||event.metaKey)return;
   if(event.key==='Enter'){choose(event);return;}
   const target=event.key==='ArrowDown'?Math.min(index+1,rows.length-1):event.key==='ArrowUp'?Math.max(index-1,0):event.key==='Home'?0:event.key==='End'?rows.length-1:-1;
   if(target>=0){event.preventDefault();rows[target]?.focus?.();}
  });list.appendChild(row);rows.push(row);
 });
 (doc.body||doc.getElementById('editor')).appendChild(layer);popups.set(doc,{owner:state,layer});state.node.setAttribute('aria-expanded','true');
 rows[Math.max(0,state.values.findIndex(item=>item.value===state.value))]?.focus?.();
}
function setChoices(node,values,{document,label,value='',onChange}={}){
 let state=controls.get(node?.id);
 if(!state){
  const caption=document.createElement('span'),arrow=document.createElement('span');node.innerHTML='';caption.className='choice-caption';arrow.className='choice-arrow';arrow.textContent='⌄';node.appendChild(caption);node.appendChild(arrow);
  node.className='choice-control';node.setAttribute('role','combobox');node.setAttribute('tabindex','0');node.setAttribute('aria-haspopup','listbox');node.setAttribute('aria-expanded','false');
  state={node,document,caption,values:[],value:'',disabled:false,label};controls.set(node.id,state);
  node.addEventListener('click',event=>{event.stopPropagation?.();openChoices(state);});node.addEventListener('keydown',event=>{if(event.target!==node||event.repeat||event.altKey||event.ctrlKey||event.metaKey)return;if(['Enter','ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation?.();openChoices(state);}});
 }
 const signature=JSON.stringify(values);
 if(state.signature!==signature){closeChoices(document);state.values=values.map(item=>({...item,value:String(item.value)}));state.signature=signature;}
 state.label=label;state.onChange=onChange;selectChoice(node,value);
}
function setChoiceDisabled(node,disabled){
 const state=controls.get(node?.id);node.disabled=!!disabled;
 if(!state)return;state.disabled=!!disabled;node.setAttribute('aria-disabled',String(state.disabled));node.setAttribute('tabindex',state.disabled?'-1':'0');
 if(state.disabled&&popups.get(state.document)?.owner===state)closeChoices(state.document);
}
module.exports={readChoice,selectChoice,setChoices,setChoiceDisabled,closeChoices,initChoices,forgetChoice};
