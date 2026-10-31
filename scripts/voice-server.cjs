// Loopback-only local helper for UXP panel. Windows uses PowerShell workers;
// macOS degrades gracefully (clipboard via osascript; voice/drop overlay deferred).
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const PORT = 17402;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// Adobe's UXP WebView posts messages with the plugin ID as its origin. Keep
// the local clipboard API restricted to this plugin origin (plus native calls
// without an Origin header) rather than reflecting arbitrary website origins.
const UXP_ORIGINS = new Set(['com.local.lk888.psedit','plugin://com.local.lk888.psedit','uxp://com.local.lk888.psedit']);

function fakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    if (child.exitCode != null) return;
    child.killed = true;
    child.exitCode = 0;
    child.emit('exit', 0);
  };
  return child;
}

function unsupportedSpeechWorker(_probe = false) {
  const child = fakeChildProcess();
  const message = IS_MAC
    ? 'macOS 本机听写尚未接入。请用键盘输入，或使用系统听写（可在「键盘」设置中开启）。'
    : '当前系统不支持本机 Windows 中文听写引擎。';
  process.nextTick(() => {
    try { child.stdout.write(JSON.stringify({ type: 'error', message }) + '\n'); } catch (_) {}
    child.kill();
  });
  return child;
}

function worker(probe = false) {
  if (!IS_WIN) return unsupportedSpeechWorker(probe);
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'voice-worker.ps1'), ...(probe ? ['-Probe'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
function readEvents(child, onEvent) {
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
      try { onEvent(JSON.parse(line)); } catch (_) { /* Ignore non-protocol startup output. */ }
    }
  });
  child.stderr.on('data', () => {}); // Do not log transcripts or platform diagnostics.
}
function readClipboardWindows() {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Sta','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'clipboard-worker.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('读取剪贴板超时，请重试。'));},20000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>15*1024*1024){child.kill();reject(new Error('截图太大，请缩小范围后重试。'));}});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('无法读取本机剪贴板。'));});
    child.on('exit',()=>{clearTimeout(timer);try{const data=JSON.parse(output.trim());if(data.error)reject(new Error(data.error));else resolve(data);}catch(_){reject(new Error('读取剪贴板失败。'));}});
  });
}
function readClipboardMac() {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `ps-local-clip-${randomUUID()}.png`);
    const escaped = tmp.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = [
      'set outPath to POSIX file "' + escaped + '"',
      'try',
      '  set pngData to the clipboard as «class PNGf»',
      '  set fileRef to open for access outPath with write permission',
      '  set eof of fileRef to 0',
      '  write pngData to fileRef',
      '  close access fileRef',
      '  return "IMAGE"',
      'on error',
      '  try',
      '    return "TEXT:" & (the clipboard as text)',
      '  on error',
      '    return "EMPTY"',
      '  end try',
      'end try',
    ].join('\n');
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('读取剪贴板超时，请重试。')); }, 20000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法读取本机剪贴板（需要 osascript）。')); });
    child.on('exit', async () => {
      clearTimeout(timer);
      const result = output.trim();
      try {
        if (result === 'IMAGE' || result.startsWith('IMAGE')) {
          const bytes = await fsPromises.readFile(tmp);
          try { await fsPromises.unlink(tmp); } catch (_) {}
          if (!bytes.length) return reject(new Error('剪贴板图片为空。'));
          if (bytes.length > 14 * 1024 * 1024) return reject(new Error('截图太大，请缩小范围后重试。'));
          return resolve({ image: 'data:image/png;base64,' + bytes.toString('base64') });
        }
        try { await fsPromises.unlink(tmp); } catch (_) {}
        if (result.startsWith('TEXT:')) {
          const text = result.slice(5);
          if (text) return resolve({ text });
        }
        resolve({});
      } catch (error) {
        try { await fsPromises.unlink(tmp); } catch (_) {}
        reject(new Error(error.message || '读取剪贴板失败。'));
      }
    });
  });
}
function readClipboard() {
  if (IS_WIN) return readClipboardWindows();
  if (IS_MAC) return readClipboardMac();
  return Promise.reject(new Error('当前系统暂不支持本机剪贴板助手。'));
}
function openDropWindow(id) {
  if (!IS_WIN) return null;
  return spawn('powershell.exe',['-NoProfile','-Sta','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(__dirname,'drop-window.ps1'),'-SessionId',id],{windowsHide:false,stdio:'ignore'});
}
function openDropOverlay() {
  if (!IS_WIN) return null;
  return spawn('powershell.exe',['-NoProfile','-Sta','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(__dirname,'drop-overlay.ps1')],{windowsHide:true,stdio:'ignore'});
}
function pathApi() {
  // Tests on Linux still pass Windows paths; only darwin uses POSIX rules at runtime.
  return IS_MAC ? path.posix : path.win32;
}
function droppedImagePath(value) {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) return '';
  if (value.split(/[\\/]/).some(part => part === '..' || part === '.')) return '';
  const api = pathApi();
  const native = api.normalize(value);
  const ext = api.extname(native).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return '';
  if (!api.isAbsolute(native)) return '';
  if (IS_MAC) {
    if (!native.startsWith('/')) return '';
    return native;
  }
  if (!/^[A-Za-z]:\\/.test(native) && !native.startsWith('\\\\')) return '';
  return native;
}
function imageDataUrl(filePath, bytes) {
  const ext = pathApi().extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64');
}
async function readDroppedFile(filePath) {
  const stat = await fsPromises.stat(filePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > 10 * 1024 * 1024) throw new Error('每张图片不超过 10MB。');
  return fsPromises.readFile(filePath);
}
function openAnnotationWindow(id) {
  if (!IS_WIN) return null;
  return spawn('powershell.exe',['-NoProfile','-Sta','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(__dirname,'annotation-window.ps1'),'-SessionId',id],{windowsHide:false,stdio:'ignore'});
}
function forwardGenerate(raw) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { reject(new Error('生图请求格式无效。')); return; }
    const key = typeof parsed.key === 'string' ? parsed.key.trim() : '';
    const payload = parsed.payload;
    if (!key || !payload || typeof payload !== 'object' || Array.isArray(payload)) { reject(new Error('生图请求缺少密钥或内容。')); return; }
    const data = Buffer.from(JSON.stringify(payload));
    const req = https.request({
      hostname: 'api.lk888.ai', path: '/v1/media/generate', method: 'POST', timeout: 300000,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 502, body: Buffer.concat(chunks).toString('utf8') || '{}' }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('提交生图任务超时。请到平台确认是否已接单，勿重复生成。')); });
    req.on('error', () => reject(new Error('提交生图任务时网络连接失败。请检查网络；若平台已接单，勿重复生成。')));
    req.end(data);
  });
}
function createVoiceServer({ spawnWorker = worker, clipboardReader = readClipboard, dropWindowLauncher = openDropWindow, overlayLauncher = openDropOverlay, annotationWindowLauncher = openAnnotationWindow, generateProxy = forwardGenerate, pathReader = readDroppedFile } = {}) {
  let active = null, readiness = { state: 'starting' };
  const sessions = new Map();
  const dropSessions = new Map();
  const annotationSessions = new Map();
  let overlayChild = null;
  let overlayReady = false;
  let overlayGen = 0;
  let overlayWaiters = [];
  let overlayState = { action: 'idle', id: null, at: 0, x: null, y: null, left: null, top: null, width: null, height: null };
  function ensureOverlay() {
    if (overlayChild && overlayChild.exitCode == null && !overlayChild.killed) return overlayChild;
    const child = overlayLauncher();
    overlayChild = child || null;
    overlayReady = false;
    if (child && typeof child.on === 'function') {
      child.on('error', () => { if (overlayChild === child) { overlayChild = null; overlayReady = false; } });
      child.on('exit', () => { if (overlayChild === child) { overlayChild = null; overlayReady = false; } });
    }
    return child;
  }
  function overlayView() {
    return { action: overlayState.action, id: overlayState.id, at: overlayState.at, x: overlayState.x, y: overlayState.y, left: overlayState.left, top: overlayState.top, width: overlayState.width, height: overlayState.height, gen: overlayGen, ready: overlayReady };
  }
  function wakeOverlay() {
    const waiters = overlayWaiters.splice(0);
    for (const waiter of waiters) { try { waiter(); } catch (_) {} }
  }
  function publishOverlay(next) {
    overlayState = { action: 'idle', id: null, x: null, y: null, left: null, top: null, width: null, height: null, at: Date.now(), ...next };
    overlayGen += 1;
    wakeOverlay();
  }
  function idleOverlay() { publishOverlay({ action: 'idle', id: null, at: Date.now(), x: null, y: null }); }
  function readJsonBody(request, limit, onBody) {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > limit) request.destroy(); });
    request.on('end', () => {
      let parsed = {};
      if (body) { try { parsed = JSON.parse(body); } catch (_) { parsed = null; } }
      onBody(parsed, body);
    });
  }
  const probe = spawnWorker(true);
  const probeTimer = setTimeout(() => { readiness = {state:'error', message:'中文语音引擎检查超时。'}; probe.kill(); }, 15000);
  readEvents(probe, event => {
    if (event.type === 'ready') readiness = {state:'ready', language:event.language};
    if (event.type === 'error') readiness = {state:'error', message:'本机中文语音引擎不可用：' + event.message};
  });
  probe.on('error', () => { readiness = {state:'error', message: IS_WIN ? '无法启动 Windows 中文语音引擎。' : '本机语音引擎不可用。'}; clearTimeout(probeTimer); });
  probe.on('exit', () => { clearTimeout(probeTimer); if(readiness.state==='starting') readiness={state:'error',message:'中文语音引擎未能初始化。'}; });
  function stop(session) {
    if (['starting','listening'].includes(session.state)) {
      session.state = 'stopping';
      session.child.stdin.write('stop\n');
      session.stopTimer = setTimeout(() => { session.child.kill(); }, 5000);
    }
  }
  function snapshot(session, cursor) {
    return {id:session.id, state:session.state, message:session.message, audioLevel:session.audioLevel||0, events:session.events.filter(e=>e.seq>cursor), cursor:session.events.length};
  }
  const server = http.createServer((request, response) => {
    const origin=request.headers.origin||'';
    const trustedOrigin=!origin||UXP_ORIGINS.has(origin);
    const corsHeaders=origin&&trustedOrigin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
    const reply = (status, value) => { response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders}); response.end(JSON.stringify(value)); };
    if(request.method==='OPTIONS'){
      const requested=(request.headers['access-control-request-headers']||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
      if(trustedOrigin && request.headers['access-control-request-method'] && requested.every(value=>value==='x-ps-local-voice')){
        response.writeHead(204,{...corsHeaders,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'X-PS-Local-Voice','Access-Control-Max-Age':'600'});return response.end();
      }
      return reply(403,{message:'仅允许本机插件调用。'});
    }
    if (!trustedOrigin || request.headers['x-ps-local-voice'] !== '1') return reply(403,{message:'仅允许本机插件调用。'});
    const url = new URL(request.url,'http://127.0.0.1');
    if (url.pathname === '/health' && request.method === 'GET') return reply(200,readiness);
    if (url.pathname === '/clipboard' && request.method === 'GET') {
      clipboardReader().then(data=>reply(200,data)).catch(error=>reply(500,{message:error.message}));
      return;
    }
    if(url.pathname==='/drop/read'&&request.method==='POST'){
      let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(body.length>64*1024)request.destroy();});
      request.on('end',()=>{
        Promise.resolve().then(async()=>{
          let parsed;try{parsed=JSON.parse(body);}catch(_){throw new Error('图片无效。');}
          const paths=parsed.paths;
          if(!Array.isArray(paths)||paths.length<1||paths.length>5)throw new Error('图片数量无效。');
          const references=[];
          for(const item of paths){
            const native=droppedImagePath(item);
            if(!native)throw new Error('只接受本机 PNG、JPG 或 WebP 路径。');
            let bytes;
            try{bytes=await pathReader(native);}catch(_){throw new Error('拖入的图片无法读取。');}
            if(!bytes||bytes.length<1||bytes.length>10*1024*1024)throw new Error('每张图片不超过 10MB。');
            references.push({name:pathApi().basename(native).slice(0,150),data:imageDataUrl(native,bytes)});
          }
          reply(200,{references});
        }).catch(error=>reply(400,{message:error.message||'图片无效。'}));
      });
      return;
    }
    if(url.pathname==='/drop/open'&&request.method==='POST'){
      for(const [id,session] of dropSessions)if(Date.now()-session.createdAt>180000)dropSessions.delete(id);
      const id=randomUUID();dropSessions.set(id,{createdAt:Date.now(),references:[]});
      try{const child=dropWindowLauncher(id);if(!child){dropSessions.delete(id);return reply(501,{message:'当前系统暂不支持独立拖入窗口。请用粘贴或「添加图片」。'});}child?.on?.('error',()=>dropSessions.delete(id));return reply(200,{id});}
      catch(_){dropSessions.delete(id);return reply(500,{message:'无法打开本机拖入窗口。'});}
    }
    if(url.pathname==='/drop/arm'&&request.method==='POST'){
      try{const child=ensureOverlay();if(!child)return reply(501,{message:'当前系统暂不支持拖入接图层。请用粘贴或「添加图片」。'});return reply(200,{state:overlayReady?'ready':'starting',ready:overlayReady});}
      catch(_){return reply(500,{message:'本机图片拖入服务未开启。'});}
    }
    if(url.pathname==='/drop/ready'&&request.method==='POST'){overlayReady=true;return reply(200,{state:'ready',gen:overlayGen});}
    if(url.pathname==='/drop/cover'&&request.method==='POST'){
      readJsonBody(request, 4096, parsed => {
        if(parsed===null)return reply(400,{message:'拖入位置无效。'});
        for(const [id,session] of dropSessions)if(Date.now()-session.createdAt>180000)dropSessions.delete(id);
        try{const child=ensureOverlay();if(!child)return reply(501,{message:'当前系统暂不支持拖入接图层。请用粘贴或「添加图片」。'});}catch(_){return reply(500,{message:'本机图片拖入服务未开启。'});}
        const id=randomUUID();dropSessions.set(id,{createdAt:Date.now(),references:[]});
        const num=value=>Number.isFinite(Number(value))?Number(value):null;
        const x=num(parsed&&parsed.x);
        const y=num(parsed&&parsed.y);
        const left=num(parsed&&parsed.left);
        const top=num(parsed&&parsed.top);
        const width=num(parsed&&parsed.width);
        const height=num(parsed&&parsed.height);
        publishOverlay({action:'show',id,at:Date.now(),x,y,left,top,width,height});
        return reply(200,{id,ready:overlayReady});
      });
      return;
    }
    if(url.pathname==='/drop/hide'&&request.method==='POST'){idleOverlay();return reply(200,{state:'hidden'});}
    if(url.pathname==='/drop/overlay'&&request.method==='GET'){
      if(overlayState.action==='show'&&Date.now()-overlayState.at>8000)idleOverlay();
      const since=Number(url.searchParams.get('since'))||0;
      if(url.searchParams.get('wait')!=='1'||overlayGen!==since)return reply(200,overlayView());
      let replied=false,waiter;
      const send=()=>{if(replied)return;replied=true;clearTimeout(timer);const index=overlayWaiters.indexOf(waiter);if(index>=0)overlayWaiters.splice(index,1);try{reply(200,overlayView());}catch(_){}};
      const timer=setTimeout(send,250);
      waiter=()=>{clearTimeout(timer);send();};
      overlayWaiters.push(waiter);
      return;
    }
    if(url.pathname==='/drop/upload'&&request.method==='POST'){
      const session=dropSessions.get(url.searchParams.get('id'));
      if(!session||Date.now()-session.createdAt>180000)return reply(404,{message:'拖入窗口已过期，请重新打开。'});
      let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(body.length>72*1024*1024)request.destroy();});
      request.on('end',()=>{try{const value=JSON.parse(body),refs=value.references;if(!Array.isArray(refs)||refs.length<1||refs.length>5)throw Error('图片数量无效。');for(const ref of refs){if(typeof ref.name!=='string'||typeof ref.data!=='string'||ref.data.length>14*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(ref.data))throw Error('图片格式或大小无效。');}session.references.push(...refs.map(ref=>({name:ref.name.slice(0,150),data:ref.data})));if(overlayState.id===url.searchParams.get('id'))idleOverlay();reply(200,{state:'received',count:refs.length});}catch(error){reply(400,{message:error.message||'图片无效。'});}});return;
    }
    if(url.pathname==='/drop/poll'&&request.method==='GET'){
      const session=dropSessions.get(url.searchParams.get('id'));
      if(!session||Date.now()-session.createdAt>180000)return reply(404,{message:'拖入窗口已过期，请重新打开。'});
      const references=session.references.splice(0);return reply(200,{references});
    }
    if(url.pathname==='/annotate/open'&&request.method==='POST'){
      let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(body.length>14*1024*1024)request.destroy();});
      request.on('end',()=>{try{const image=JSON.parse(body).image;if(typeof image!=='string'||image.length>14*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(image))throw Error('标注图片无效或过大。');for(const [id,session] of annotationSessions)if(Date.now()-session.createdAt>600000)annotationSessions.delete(id);const id=randomUUID(),session={createdAt:Date.now(),image,result:null,error:null};annotationSessions.set(id,session);const child=annotationWindowLauncher(id);if(!child){annotationSessions.delete(id);return reply(501,{message:'当前系统暂不支持本机标注窗口。请在 Photoshop 内处理后导出。'});}child?.on?.('error',()=>{session.error='本机标注窗口启动失败。';});child?.on?.('exit',()=>{if(!session.result)session.error='标注窗口已关闭，未保存图片。';});reply(200,{id});}catch(error){reply(400,{message:error.message||'无法打开标注窗口。'});}});return;
    }
    if(url.pathname.startsWith('/annotate/')){
      const id=url.searchParams.get('id'),session=annotationSessions.get(id);
      if(!session||Date.now()-session.createdAt>600000)return reply(404,{message:'标注会话已结束。'});
      if(url.pathname==='/annotate/image'&&request.method==='GET')return reply(200,{image:session.image});
      if(url.pathname==='/annotate/poll'&&request.method==='GET'){
        if(session.error){const message=session.error;annotationSessions.delete(id);return reply(200,{state:'error',message});}
        if(!session.result)return reply(200,{state:'waiting'});
        const image=session.result;annotationSessions.delete(id);return reply(200,{state:'saved',image});
      }
      if(url.pathname==='/annotate/save'&&request.method==='POST'){
        let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(body.length>14*1024*1024)request.destroy();});
        request.on('end',()=>{try{const image=JSON.parse(body).image;if(typeof image!=='string'||image.length>14*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image))throw Error('标注结果无效或过大。');session.result=image;reply(200,{state:'saved'});}catch(error){reply(400,{message:error.message||'保存标注失败。'});}});return;
      }
    }
    if (url.pathname === '/start' && request.method === 'POST') {
      if (readiness.state !== 'ready') return reply(503,{message:readiness.message || '中文语音引擎启动中，请稍后重试。'});
      if (active && ['starting','listening'].includes(active.state)) return reply(200,{...snapshot(active,active.events.length),resumed:true});
      if (active && active.state === 'stopping') return reply(409,{message:'正在结束上一段语音，请稍后再开始。'});
      if (active && ['complete','error'].includes(active.state)) {
        clearTimeout(active.timer);clearTimeout(active.killTimer);clearTimeout(active.stopTimer);
        active.child.kill();active=null;
      }
      for (const [id, old] of sessions) if (Date.now()-old.createdAt > 600000) sessions.delete(id);
      const child=spawnWorker(false), session={id:randomUUID(),child,state:'starting',events:[],createdAt:Date.now(),audioLevel:0,peakAudioLevel:0};
      active=session; sessions.set(session.id,session);
      session.timer=setTimeout(()=>stop(session),60000);
      session.killTimer=setTimeout(()=>child.kill(),70000);
      readEvents(child,event=>{
        if(event.type==='listening') session.state='listening';
        if(event.type==='audiolevel') {session.audioLevel=Math.max(0,Math.min(100,Number(event.level)||0));session.peakAudioLevel=Math.max(session.peakAudioLevel,Math.max(0,Math.min(100,Number(event.peak)||0)));}
        if(event.type==='text' && typeof event.text==='string') session.events.push({seq:session.events.length+1,text:event.text.slice(0,2000)});
        if(event.type==='error') {session.state='error';session.message='语音识别失败，请检查默认麦克风及 Windows 麦克风权限。'+(event.message || '');}
        if(event.type==='complete') {
          session.state='complete';
          if(session.events.length) session.message='听写结束。';
          else if(session.peakAudioLevel<5) session.message='没有检测到麦克风声音。请在 Windows 设置 → 系统 → 声音 → 输入中选择实际麦克风并测试，确认未静音后重试。';
          else if((Number(event.rejected)||0)>0) session.message='检测到麦克风声音，但本机中文识别引擎未能识别。请放慢语速、减少背景噪声后重试。';
          else session.message='检测到麦克风声音，但没有识别出文字，请说完整短句后重试。';
        }
      });
      child.on('error',()=>{session.state='error';session.message='无法启动本机语音识别。';clearTimeout(session.timer);clearTimeout(session.killTimer);if(active===session)active=null;});
      child.stdin.on('error',()=>{});
      child.on('exit',()=>{clearTimeout(session.timer);clearTimeout(session.killTimer);clearTimeout(session.stopTimer);if(['starting','listening','stopping'].includes(session.state)){session.state='error';session.message='语音识别意外退出，请检查麦克风后重试。';}if(active===session)active=null;});
      return reply(200,snapshot(session,0));
    }
    if (url.pathname === '/media/generate' && request.method === 'POST') {
      let body = '', tooBig = false, answered = false;
      const fail = (status, message) => { if (answered) return; answered = true; reply(status, {error:{message}}); };
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; if (body.length > 72 * 1024 * 1024) { tooBig = true; fail(413, '生图图片过大，请缩小选区或减少参考图后再试。尚未提交。'); request.destroy(); } });
      request.on('end', () => {
        if (tooBig) return;
        Promise.resolve().then(() => generateProxy(body)).then(result => {
          if (answered) return;
          answered = true;
          const status = Number(result && result.status) || 502;
          const text = typeof result?.body === 'string' ? result.body : JSON.stringify(result && result.body || {});
          response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders});
          response.end(text);
        }).catch(error => fail(503, error && error.message || '本机转发生图请求失败。'));
      });
      request.on('error', () => fail(503, '本机接收生图请求失败。尚未提交。'));
      return;
    }
    if (url.pathname !== '/status' && url.pathname !== '/stop') return reply(404, {message:'本机服务没有这个接口。'});
    const session=sessions.get(url.searchParams.get('id'));
    if(!session) return reply(404,{message:'语音会话已结束，请重新开始。'});
    if(url.pathname==='/status' && request.method==='GET') return reply(200,snapshot(session,Number(url.searchParams.get('cursor'))||0));
    if(url.pathname==='/stop' && request.method==='POST') {stop(session);return reply(200,{state:session.state});}
    return reply(404,{message:'未知语音请求。'});
  });
  server.ensureOverlay=ensureOverlay;
  server.on('close',()=>{clearTimeout(probeTimer);probe.kill();overlayReady=false;wakeOverlay();if(overlayChild)overlayChild.kill();for(const session of sessions.values()){clearTimeout(session.timer);clearTimeout(session.killTimer);clearTimeout(session.stopTimer);session.child.kill();}});
  return server;
}
if(require.main===module){const server=createVoiceServer();server.on('error',error=>{if(error.code!=='EADDRINUSE'){console.error('本机语音服务无法启动。');process.exitCode=1;}});server.listen(PORT,'127.0.0.1',()=>{try{server.ensureOverlay();}catch(_){}});}
module.exports={createVoiceServer,PORT,droppedImagePath,IS_WIN,IS_MAC};
