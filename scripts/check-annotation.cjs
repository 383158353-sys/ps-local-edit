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
    const original='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    await page.evaluate(image=>window.dispatchEvent(new MessageEvent('message',{data:{type:'open',image}})),original);
    await page.waitForFunction(()=>document.querySelector('canvas').width===1);
    await page.locator('#text-entry').fill('标注');await page.locator('[data-tool="text"]').click();
    await page.locator('canvas').click();await page.locator('#save').click();
    const message=await page.evaluate(()=>window.sent.find(m=>m.type==='save'));
    assert.match(message.image,/^data:image\/png;base64,/);assert.notEqual(message.image,original);assert.deepEqual(errors,[]);
    console.log('Annotation editor opens image, draws text and saves PNG.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
