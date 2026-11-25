// Super Smash BHS server: static game + WebSocket accounts, presence, invites, parties, leaderboard.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,ORIGINS=(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean),DBF=process.env.DB_FILE||path.join(__dirname,'data.json');
let db={users:{},tokens:{}};try{db=JSON.parse(fs.readFileSync(DBF,'utf8'))}catch(e){}
let dirty=false;const save=()=>{dirty=true};setInterval(()=>{if(dirty){dirty=false;fs.writeFile(DBF,JSON.stringify(db),()=>{})}},2000);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const mk=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const ok=(p,h)=>{const a=Buffer.from(mk(p,h.split(':')[0])),b=Buffer.from(h);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const pub=u=>({name:u.name,w:u.w,b:u.b,m:u.m});
const srv=http.createServer((q,r)=>{if(q.url==='/health'){r.end('ok');return}
 fs.readFile(path.join(__dirname,'public','index.html'),(e,d)=>{if(e){r.writeHead(404);r.end();return}
  const h={'Content-Type':'text/html; charset=utf-8'};if(process.env.FRAME_ANCESTORS)h['Content-Security-Policy']='frame-ancestors '+process.env.FRAME_ANCESTORS;r.writeHead(200,h);r.end(d)})});
const wss=new WebSocketServer({server:srv,maxPayload:2048,verifyClient:i=>!ORIGINS.length||ORIGINS.includes(i.origin)});
const S=new Map(),tx=(w,o)=>{if(w&&w.readyState===1)w.send(JSON.stringify(o))};
const by=n=>{for(const s of S.values())if(s.u&&s.u.name.toLowerCase()===String(n).toLowerCase())return s};
const cast=()=>{const p={t:'players',list:[...S.values()].filter(s=>s.u).map(s=>({n:s.u.name,s:s.st}))},b={t:'board',rows:Object.values(db.users).sort((a,b)=>b.w-a.w||b.b-a.b).slice(0,20).map(u=>({n:u.name,w:u.w,b:u.b,m:u.m}))};for(const s of S.values())if(s.u){tx(s.w,p);tx(s.w,b)}};
function cancel(s){const t=s.sentTo;s.sentTo=null;if(t&&t.inv&&t.inv.s===s){t.inv=null;tx(t.w,{t:'gone',from:s.u?s.u.name:''})}}
function sendParty(p){for(const x of p.m){const o=p.m.find(y=>y!==x);tx(x.w,{t:'party',opp:o.u.name,my:x.ready?1:0,or:o.ready?1:0,op:o.pick})}}
function endParty(s){const p=s.party;if(!p)return;clearTimeout(p.tm);for(const x of p.m){x.party=null;x.ready=false;x.pick=null;if(x!==s)tx(x.w,{t:'ended'})}}
function score(mt,wi){if(mt.scored)return;mt.scored=true;const W=mt.u[wi],L=mt.u[1-wi];W.w++;W.m++;W.streak=(W.streak||0)+1;W.b=Math.max(W.b,W.streak);L.m++;L.streak=0;save();mt.p.forEach(x=>{if(x.u)tx(x.w,{t:'me',acct:pub(x.u)})});cast()}
function start(p){const c=[p.m[0].pick,p.m[1].pick],map=Math.random()*3|0,names=p.m.map(x=>x.u.name),mt={p:p.m,u:p.m.map(x=>x.u),rep:[null,null],scored:false};p.m.forEach((x,i)=>{x.match=mt;x.role=i;x.party=null;x.ready=false;tx(x.w,{t:'start',c,role:i,names,map})})}
function enter(s,u){const old=by(u.name);if(old&&old!==s){tx(old.w,{t:'kicked'});old.w.close()}s.u=u;s.st='ONLINE';const k=crypto.randomBytes(24).toString('hex');db.tokens[sha(k)]=u.name.toLowerCase();save();tx(s.w,{t:'auth',ok:1,acct:pub(u),token:k});cast()}
function handle(w,s,m){
 if(m.t==='signup'||m.t==='login'){if(s.bad>8)return w.close();const u=String(m.u||'').trim(),p=String(m.p||''),key=u.toLowerCase(),no=e=>tx(w,{t:'auth',ok:0,err:e});
  if(m.t==='signup'){if(!/^[A-Za-z0-9_-]{3,16}$/.test(u)||p.length<4||p.length>64)return no('INVALID USERNAME OR PASSWORD');if(db.users[key])return no('USERNAME TAKEN - PICK SOMETHING ELSE');db.users[key]={name:u,h:mk(p),w:0,b:0,m:0,streak:0};save();return enter(s,db.users[key])}
  const a=db.users[key];if(!a){s.bad++;return no('NO ACCOUNT WITH THAT NAME - USE CREATE ACCOUNT')}if(!ok(p,a.h)){s.bad++;return no('WRONG PASSWORD')}return enter(s,a)}
 if(m.t==='resume'){const n=db.tokens[sha(String(m.k||''))],a=n&&db.users[n];if(a)enter(s,a);return}
 if(!s.u)return;
 switch(m.t){
 case'logout':cancel(s);endParty(s);s.u=null;cast();break;
 case'status':if(['ONLINE','VS BOT','MULTIPLAYER'].includes(m.s)){s.st=m.s;cast()}break;
 case'invite':{cancel(s);const ts=by(m.to);if(!ts||ts===s||ts.inv||s.party||ts.party||ts.match||s.match){tx(w,{t:'declined'});break}ts.inv={s};s.sentTo=ts;tx(ts.w,{t:'invite',from:s.u.name});setTimeout(()=>{if(s.sentTo===ts&&ts.inv&&ts.inv.s===s){cancel(s);tx(s.w,{t:'declined'})}},15000);break}
 case'cancel':cancel(s);break;
 case'decline':if(s.inv){const f=s.inv.s;s.inv=null;f.sentTo=null;tx(f.w,{t:'declined'})}break;
 case'accept':{if(!s.inv||s.party)break;const f=s.inv.s;s.inv=null;if(f.sentTo!==s||f.party){tx(w,{t:'ended'});break}f.sentTo=null;const p={m:[f,s],tm:0};f.party=s.party=p;f.ready=s.ready=false;f.pick=s.pick=null;sendParty(p);break}
 case'pick':if(s.party&&!s.ready&&Number.isInteger(m.c)&&m.c>=0&&m.c<16){s.pick=m.c;sendParty(s.party)}break;
 case'ready':if(s.party){const p=s.party;s.ready=!!m.r&&s.pick!=null;sendParty(p);clearTimeout(p.tm);if(p.m.every(x=>x.ready)){p.m.forEach(x=>tx(x.w,{t:'countdown'}));p.tm=setTimeout(()=>start(p),3000)}else p.m.forEach(x=>tx(x.w,{t:'stop'}))}break;
 case'in':{const mt=s.match;if(mt&&Number.isInteger(m.k)&&Number.isInteger(m.m)&&Number.isInteger(m.r))tx(mt.p[1-s.role].w,{t:'in',k:m.k,r:m.r,m:m.m&127});break}
 case'result':{const mt=s.match;if(!mt||mt.scored||(m.w!==0&&m.w!==1))break;mt.rep[s.role]=m.w;if(mt.rep[0]!==null&&mt.rep[1]!==null){if(mt.rep[0]===mt.rep[1])score(mt,m.w);else{mt.scored=true;console.log('result mismatch, not scored')}}break}
 case'forfeit':{const mt=s.match;s.match=null;if(mt&&!mt.scored){score(mt,1-s.role);tx(mt.p[1-s.role].w,{t:'left'})}break}
 case'done':s.match=null;break;
 case'leave':endParty(s);break}}
wss.on('connection',w=>{const s={w,u:null,st:'ONLINE',inv:null,sentTo:null,party:null,ready:false,pick:null,n:0,ni:0,bad:0,match:null,role:0};S.set(w,s);const rl=setInterval(()=>{s.n=0;s.ni=0},1000);
 w.on('message',d=>{let m;try{m=JSON.parse(d)}catch(e){return}if(!m||typeof m.t!=='string')return;if(m.t==='in'?++s.ni>100:++s.n>30)return w.close();handle(w,s,m)});
 w.on('close',()=>{clearInterval(rl);const mt=s.match;if(mt&&!mt.scored){score(mt,1-s.role);tx(mt.p[1-s.role].w,{t:'left'})}cancel(s);s.inv=null;endParty(s);S.delete(w);cast()})});
setInterval(()=>wss.clients.forEach(c=>c.ping()),25000);
srv.listen(PORT,()=>console.log('Smash BHS server on :'+PORT));
