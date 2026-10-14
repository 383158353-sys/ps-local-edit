const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createUiButton,setButtonDisabled,initButtons}=require('../plugin/ui-controls');
function node(){const listeners=[];return {attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(type,fn,capture){listeners.push({type,fn,capture});},dispatchEvent(event){for(const l of listeners.filter(l=>l.type===event.type&&l.capture))l.fn(event);if(event.defaultPrevented)return false;this.onclick?.(event);for(const l of listeners.filter(l=>l.type===event.type&&!l.capture))l.fn(event);return true;},key(key,extra={}){const event={target:this,key,preventDefault(){},stopPropagation(){},...extra};for(const l of listeners.filter(l=>l.type==='keydown'))l.fn(event);}};}
test('shared buttons keep disabled clicks and Enter blocked, and never consume Space',()=>{
 const button=createUiButton({createElement:node});let calls=0;button.onclick=()=>calls++;
 button.dispatchEvent(new Event('click',{cancelable:true}));assert.equal(calls,1);button.key('Enter');assert.equal(calls,2);
 let prevented=false;button.key(' ',{preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(calls,2);
 for(const extra of [{repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true}])button.key('Enter',extra);assert.equal(calls,2);
 setButtonDisabled(button,true);assert.equal(button.attributes['aria-disabled'],'true');assert.equal(button.attributes.tabindex,'-1');button.dispatchEvent(new Event('click',{cancelable:true}));button.key('Enter');assert.equal(calls,2);
 setButtonDisabled(button,false);assert.equal(button.attributes.tabindex,'0');button.key('Enter');assert.equal(calls,3);
});
test('static buttons receive the same role, focus and Enter interaction',()=>{
 const button=node();let calls=0;button.onclick=()=>calls++;initButtons({querySelectorAll(selector){assert.equal(selector,'[data-ui-button]');return [button];}});assert.equal(button.attributes.role,'button');button.key('Enter');assert.equal(calls,1);
});
