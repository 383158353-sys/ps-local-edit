function selectModel(node,models,id){
 const index=models.findIndex(model=>model.id===id);
 if(index<0)return false;
 node.selectedIndex=index;
 node.value=id;
 const menu=node.children?.[0];
 Array.from(menu?.children||[]).forEach((item,i)=>{item.selected=i===index;if(i===index)item.setAttribute('selected','');else item.removeAttribute('selected');});
 node.setAttribute('title',models[index].label||id);
 try{node.dispatchEvent(new Event('change',{bubbles:true}));}catch(_){}
 return true;
}
module.exports={selectModel};
