function selectModel(node,models,id){
 const index=models.findIndex(model=>model.id===id);
 if(index<0)return false;
 // UXP's dropdown label follows selectedIndex, not a programmatic value alone.
 node.selectedIndex=index;
 node.value=id;
 const menu=node.children?.[0];
 Array.from(menu?.children||[]).forEach((item,i)=>{item.selected=i===index;if(i===index)item.setAttribute('selected','');else item.removeAttribute('selected');});
 node.setAttribute('title',models[index].label||id);
 return true;
}
module.exports={selectModel};
