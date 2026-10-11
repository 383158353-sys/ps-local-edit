const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    for(const width of [320,390,500]){
      const page=await browser.newPage({viewport:{width,height:700}});
      await page.goto(pathToFileURL(path.resolve('plugin/index.html')).href);
      await page.evaluate(()=>{document.getElementById('tab-tasks').textContent='历史记录 (13)';});
      assert.equal(await page.locator('webview').count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
      const layout=await page.evaluate(()=>{
        const options=document.querySelector('.options'),prompt=document.querySelector('.prompt-editor'),generate=document.querySelector('#generate');
        const rows=[...options.querySelectorAll('.option')].map(node=>({label:node.querySelector('label').textContent,rect:node.getBoundingClientRect()}));
        return {display:getComputedStyle(options).display,top:options.getBoundingClientRect().top,bottom:options.getBoundingClientRect().bottom,promptBottom:prompt.getBoundingClientRect().bottom,generateTop:generate.getBoundingClientRect().top,rows:rows.map(({label,rect})=>({label,x:rect.x,y:rect.y,width:rect.width}))};
      });
      assert.equal(layout.display,'flex');assert.deepEqual(layout.rows.map(row=>row.label),['模型','清晰度','张数','尺寸']);
      assert.ok(layout.rows.every(row=>row.width>35));assert.ok(layout.rows.every(row=>Math.abs(row.y-layout.rows[0].y)<2));
      assert.ok(layout.top>=layout.promptBottom&&layout.bottom<=layout.generateTop);
      const toolbar=await page.evaluate(()=>{
        const ids=['refresh-selection','tab-edit','tab-tasks','reload-panel','settings-toggle'];
        return ids.map(id=>{const node=document.getElementById(id),rect=node.getBoundingClientRect();return{id,tag:node.tagName,text:node.textContent,x:rect.x,y:rect.y,right:rect.right,width:rect.width,height:rect.height};});
      });
      assert.ok(toolbar.every(button=>button.width>20));
      assert.ok(toolbar.every(button=>button.tag==='BUTTON'&&button.height===32));
      assert.equal(toolbar[1].text,'＋');
      assert.ok(toolbar[1].x-toolbar[0].right>=5);
      for(let i=1;i<toolbar.length;i++)if(Math.abs(toolbar[i].y-toolbar[i-1].y)<2)assert.ok(toolbar[i].x-toolbar[i-1].right>=5,`${width}px: ${toolbar[i-1].id} overlaps ${toolbar[i].id}`);
      assert.ok(toolbar[2].y>=toolbar[0].y);
      await page.close();
    }
    console.log('Four parameter controls remain visible on one row at narrow and wide panel sizes.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
