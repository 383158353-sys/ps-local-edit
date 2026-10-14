const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readChoice,selectChoice,setChoices,setChoiceDisabled,closeChoices,initChoices}=require('../plugin/dropdown');
function harness(){
 const doc={createElement:()=>node(),body:null,activeElement:null};
 function node(id=''){return {id,attributes:{},children:[],value:'stale Banana 2',selectedIndex:0,style:{},setAttribute(k,v){this.attributes[k]=v;},appendChild(child){child.parentNode=this;this.children.push(child);},removeChild(child){this.children=this.children.filter(c=>c!==child);child.parentNode=null;},addEventListener(k,fn){this[k]=fn;},focus(){doc.activeElement=this;},set innerHTML(_){this.children=[];}};}
 doc.body=node('body');const control=node('model'),changes=[];initChoices(doc);setChoices(control,[{value:'banana-2',label:'Banana 2'},{value:'banana-2.1',label:'纳米香蕉 2.1 按次',description:'banana-2.1'}],{document:doc,label:'模型',value:'banana-2',onChange:id=>changes.push(id)});
 const rows=()=>doc.body.children[0]?.children[0]?.children[1]?.children||[];
 const event=(target,key,extra={})=>({target,key,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
 return {doc,control,changes,rows,event};
}
test('clicking a visible model updates caption, identity and callback despite stale native values',()=>{
 const h=harness();h.control.click(h.event(h.control));const row=h.rows()[1];row.click(h.event(row));
 assert.equal(readChoice(h.control),'banana-2.1');assert.equal(h.control.children[0].textContent,'纳米香蕉 2.1 按次');assert.deepEqual(h.changes,['banana-2.1']);assert.equal(h.control.value,'stale Banana 2');assert.equal(h.doc.body.children.length,0);
 h.control.click(h.event(h.control));assert.equal(h.rows()[1].attributes['aria-selected'],'true');assert.equal(h.rows()[0].attributes['aria-selected'],'false');
});
test('Space never opens, commits or dismisses a picker and is not consumed',()=>{
 const h=harness();const space=h.event(h.control,' ');h.control.keydown(space);assert.equal(h.doc.body.children.length,0);assert.equal(space.prevented,false);
 h.control.click(h.event(h.control));const row=h.rows()[1],rowSpace=h.event(row,' ');row.keydown(rowSpace);assert.equal(readChoice(h.control),'banana-2');assert.equal(h.doc.body.children.length,1);assert.equal(rowSpace.prevented,false);
 const close=h.doc.body.children[0].children[0].children[0].children[1],closeSpace=h.event(close,' ');close.keydown(closeSpace);assert.equal(h.doc.body.children.length,1);assert.equal(closeSpace.prevented,false);
});
test('Enter and arrow navigation work while repeated, modified and descendant keys do not open',()=>{
 const h=harness();for(const extra of [{repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true},{target:h.control.children[0]}])h.control.keydown(h.event(h.control,'Enter',extra));assert.equal(h.doc.body.children.length,0);
 h.control.keydown(h.event(h.control,'ArrowDown'));const [first,second]=h.rows();assert.equal(h.doc.activeElement,first);first.keydown(h.event(first,'ArrowDown'));assert.equal(h.doc.activeElement,second);second.keydown(h.event(second,'Enter'));assert.equal(readChoice(h.control),'banana-2.1');assert.equal(h.doc.activeElement,h.control);
});
test('invalid model cannot silently become the first option and disabled controls cannot open',()=>{
 const h=harness();selectChoice(h.control,'banana-2.1');assert.equal(selectChoice(h.control,'missing'),false);assert.equal(readChoice(h.control),'banana-2.1');setChoiceDisabled(h.control,true);h.control.click(h.event(h.control));assert.equal(h.doc.body.children.length,0);
});
test('Escape and explicit close preserve selection',()=>{
 const h=harness();h.control.click(h.event(h.control));const layer=h.doc.body.children[0];layer.keydown(h.event(h.rows()[1],'Escape'));assert.equal(h.doc.body.children.length,0);assert.equal(readChoice(h.control),'banana-2');h.control.click(h.event(h.control));closeChoices(h.doc);assert.equal(h.doc.body.children.length,0);
});
