// User preference: do not offer or submit Token-billed variants.
function isTokenModel(model){
 const item=model&&typeof model==='object'?model:{id:model},id=item.id||item.name||'';
 return /(?:^|[-_\s])token(?:$|[-_\s])/i.test(String(id))||['token','tokens','by_token'].includes(String(item.billing_mode||'').toLowerCase())||/token\s*(?:版|计费)/i.test(String(item.label||item.display_name||''));
}
function requireAllowedModel(id){if(isTokenModel(id))throw new Error('Token 版模型已停用，请选择按次计费模型。');}
module.exports={isTokenModel,requireAllowedModel};
