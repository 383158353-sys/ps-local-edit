const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:500,height:400}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.sent=[];window.uxpHost={postMessage:s=>window.sent.push(JSON.parse(s))};});
    await page.goto(pathToFileURL(path.resolve('plugin/annotation.html')).href);
    const original=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,80,80);return canvas.toDataURL('image/png')});
    await page.evaluate(image=>window.dispatchEvent(new MessageEvent('message',{data:{type:'open',image}})),original);
    await page.waitForFunction(()=>document.querySelector('canvas').width===80);
    assert.equal(await page.getByRole('button',{name:'↗ 箭头'}).count(),1);
    assert.equal(await page.getByText(/圆圈|画笔|文字/).count(),0);
    const bounds=await page.locator('canvas').boundingBox();
    await page.mouse.move(bounds.x+10,bounds.y+10);await page.mouse.down();await page.mouse.move(bounds.x+55,bounds.y+55);await page.mouse.up();
    await page.locator('#save').click();
    const message=await page.evaluate(()=>window.sent.find(m=>m.type==='save'));
    assert.match(message.image,/^data:image\/png;base64,/);assert.notEqual(message.image,original);assert.deepEqual(errors,[]);
    console.log('Annotation editor offers only arrows, draws one and saves PNG.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
