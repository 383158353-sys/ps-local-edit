const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const base=path.resolve(__dirname,'..'),lock=path.join(base,'supervisor.lock');let child,stopping=false;
try{const previous=JSON.parse(fs.readFileSync(lock,'utf8'));try{process.kill(previous.pid,0);process.exit(0);}catch{}}catch{}
fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{mode:0o600});
function launch(){
 if(stopping)return;
 const request=http.get('http://127.0.0.1:17402/health',{headers:{'X-PS-Local-Voice':'1'},timeout:1500},res=>{res.resume();if(!stopping)setTimeout(launch,5000);});
 request.on('timeout',()=>request.destroy());
 request.on('error',()=>{if(stopping)return;child=spawn(process.execPath,[path.join(__dirname,'standalone-helper.cjs')],{cwd:base,windowsHide:true,stdio:'ignore'});child.on('exit',()=>{child=null;if(!stopping)setTimeout(launch,2000);});});
}
function stop(){stopping=true;child?.kill();try{const current=JSON.parse(fs.readFileSync(lock,'utf8'));if(current.pid===process.pid)fs.unlinkSync(lock);}catch{}process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);launch();
