// Loopback-only, on-demand Windows dictation. No audio or transcript is sent online.
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const PORT = 17402;
// Adobe's UXP WebView posts messages with the plugin ID as its origin. Keep
// the local clipboard API restricted to this plugin origin (plus native calls
// without an Origin header) rather than reflecting arbitrary website origins.
const UXP_ORIGINS = new Set(['com.local.lk888.psedit','plugin://com.local.lk888.psedit','uxp://com.local.lk888.psedit']);
function worker(probe = false) {
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
function readClipboard() {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Sta','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'clipboard-worker.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('读取剪贴板超时，请重试。'));},20000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>15*1024*1024){child.kill();reject(new Error('截图太大，请缩小范围后重试。'));}});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('无法读取本机剪贴板。'));});
    child.on('exit',()=>{clearTimeout(timer);try{const data=JSON.parse(output.trim());if(data.error)reject(new Error(data.error));else resolve(data);}catch(_){reject(new Error('读取剪贴板失败。'));}});
  });
}
function createVoiceServer({ spawnWorker = worker, clipboardReader = readClipboard } = {}) {
  let active = null, readiness = { state: 'starting' };
  const sessions = new Map();
  const probe = spawnWorker(true);
  const probeTimer = setTimeout(() => { readiness = {state:'error', message:'中文语音引擎检查超时。'}; probe.kill(); }, 15000);
  readEvents(probe, event => {
    if (event.type === 'ready') readiness = {state:'ready', language:event.language};
    if (event.type === 'error') readiness = {state:'error', message:'本机中文语音引擎不可用：' + event.message};
  });
  probe.on('error', () => { readiness = {state:'error', message:'无法启动 Windows 中文语音引擎。'}; clearTimeout(probeTimer); });
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
    const session=sessions.get(url.searchParams.get('id'));
    if(!session) return reply(404,{message:'语音会话已结束，请重新开始。'});
    if(url.pathname==='/status' && request.method==='GET') return reply(200,snapshot(session,Number(url.searchParams.get('cursor'))||0));
    if(url.pathname==='/stop' && request.method==='POST') {stop(session);return reply(200,{state:session.state});}
    return reply(404,{message:'未知语音请求。'});
  });
  server.on('close',()=>{clearTimeout(probeTimer);probe.kill();for(const session of sessions.values()){clearTimeout(session.timer);clearTimeout(session.killTimer);clearTimeout(session.stopTimer);session.child.kill();}});
  return server;
}
if(require.main===module){const server=createVoiceServer();server.on('error',error=>{if(error.code!=='EADDRINUSE'){console.error('本机语音服务无法启动。');process.exitCode=1;}});server.listen(PORT,'127.0.0.1');}
module.exports={createVoiceServer,PORT};
