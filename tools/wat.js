
const net=require('net'),path=require('path'),{spawn}=require('child_process'),fs=require('fs');
const RT='E:\\CG_analyze\\engine',NODE=path.join(RT,'node.exe'),ENGINE=path.join(RT,'engine.js');
const cfg=JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json','utf8'));
const px=(cfg.proxies||[]).map(p=>p.split(':').join('|'));
const o={l:cfg.accounts[1].url,p:9390,px:px[1],dev:145};
const T0=Date.now();const ts=()=>'+'+String(Date.now()-T0).padStart(6)+'ms';
const log=(...a)=>console.log(ts(),...a);
let bag=null,res=null;
o.proc=spawn(NODE,[ENGINE,String(o.p),o.l,'1','',o.px,'8','0',String(o.dev)],{cwd:RT,stdio:['ignore','pipe','pipe'],windowsHide:true});
o.proc.stdout.on('data',()=>{});o.buf='';
setTimeout(()=>{
  const s=net.connect(o.p,'127.0.0.1',()=>s.write(JSON.stringify({cmd:'join'})+'\n'));
  s.on('error',()=>{});
  s.on('data',d=>{o.buf+=d.toString();let i;while((i=o.buf.indexOf('\n'))>=0){const l=o.buf.slice(0,i).trim();o.buf=o.buf.slice(i+1);
    try{const m=JSON.parse(l);if(m.type==='joinres')log('进房 桌'+m.room);
      if(m.type==='evt'&&/聊天室/.test(m.ev))log(m.ev);
      if(m.type==='bagid'&&m.btype===1)bag=m;
      if(m.type==='grabres')res=m.res;}catch(e){}}});
  // 等 45 秒（不做 change），然后再抢 3 包
  setTimeout(()=>{
    log('等待 45 秒结束，开始抢（没做过 change）');
    let n=0;
    const t=setInterval(()=>{
      if(!bag)return;
      if(n>=3){clearInterval(t);o.proc.kill();process.exit(0);}
      n++;res=null;
      const b=bag;s.write(JSON.stringify({cmd:'grab',id:Number(b.id)})+'\n');
      setTimeout(()=>{const r=res||{};const m2=r.data&&(r.data.money||r.data.reward);
        log('包 '+b.id+' → '+(String(r.code)==='200'&&Number(m2)>0?'✅'+m2:'✗'+(r.code||'?')+' '+(r.msg||'')));},1500);
    },4000);
  },45000);
},4000);
setTimeout(()=>{try{o.proc.kill()}catch(e){}process.exit(0)},120000);
