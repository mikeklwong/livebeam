import http from 'node:http';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,extname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {emptyConfig,sanitizedConfig,canManage} from './config.mjs';
import {Providers,Engine,requestJSON} from './engine.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=resolve(process.env.LIVEBEAM_DATA_DIR||resolve(root,'data'));
mkdirSync(dataDir,{recursive:true});
function read(name){const path=resolve(dataDir,name+'.json');return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{}}
function write(name,data){const path=resolve(dataDir,name+'.json');writeFileSync(path+'.tmp',JSON.stringify(data,null,2),{mode:0o600});renameSync(path+'.tmp',path)}
const configs=read('config'),runtime=read('runtime'),activity=read('activity');
const providers=new Providers();
function addLog(guild,message){const arr=activity[guild]??=[];if(arr[0]?.message===message&&Date.now()-Date.parse(arr[0].time)<600000)return;arr.unshift({id:randomUUID(),message:message.slice(0,500),time:new Date().toISOString()});activity[guild]=arr.slice(0,100);write('activity',activity)}
const engine=new Engine({providers,readConfigs:()=>configs,readRuntime:()=>runtime,writeRuntime:()=>write('runtime',runtime),addLog});
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const origin=new URL(process.env.PUBLIC_URL||`http://localhost:${port}`).origin;
if(!origin.startsWith('https://')&&!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('PUBLIC_URL must use HTTPS outside localhost');
const secure=origin.startsWith('https://'),sessions=new Map(),pending=new Map(),limits=new Map();
const cookie=(name,value,maxAge)=>`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')))}
function json(res,status,body,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body))}
function err(status,message){const e=new Error(message);e.status=status;return e}
async function body(req){let text='';for await(const part of req){text+=part;if(text.length>2000000)throw err(413,'Request too large')}try{return JSON.parse(text||'{}')}catch{throw err(400,'Invalid JSON')}}
function current(req){const s=sessions.get(cookies(req).lb_session);if(!s||s.expires<Date.now())throw err(401,'Please connect your Discord account');return s}
async function userGuilds(s){return requestJSON('https://discord.com/api/v10/users/@me/guilds',{headers:{Authorization:'Bearer '+s.token}})}
async function authorized(req,guild){const s=current(req);const guilds=await userGuilds(s);const g=guilds.find(g=>g.id===guild);if(!g)throw err(403,'You are not a member of this server');if(canManage(g))return {session:s,guild:g,admin:true};const roles=(configs[guild]?.settings.managerRoles||'').split(',').map(x=>x.trim()).filter(Boolean);if(roles.length){const member=await providers.discord(`/guilds/${guild}/members/${s.user.id}`);if(roles.some(r=>member.roles.includes(r)))return {session:s,guild:g,admin:false}}throw err(403,'Manage Server or a configured manager role is required')}
async function manageable(s){const guilds=await userGuilds(s);const result=[];for(const g of guilds){if(canManage(g)){result.push(g);continue}const roles=(configs[g.id]?.settings.managerRoles||'').split(',').map(x=>x.trim()).filter(Boolean);if(!roles.length)continue;try{const member=await providers.discord(`/guilds/${g.id}/members/${s.user.id}`);if(roles.some(r=>member.roles.includes(r)))result.push(g)}catch{}}return result.map(g=>({id:g.id,name:g.name,icon:g.icon}))}
async function metadata(guild){const [channels,roles]=await Promise.all([providers.discord(`/guilds/${guild}/channels`),providers.discord(`/guilds/${guild}/roles`)]);return {channels:channels.filter(c=>[0,5].includes(c.type)).map(c=>({id:c.id,name:c.name,type:c.type})),roles:roles.map(r=>({id:r.id,name:r.name,managed:r.managed,position:r.position}))}}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try{
    const url=new URL(req.url,origin),path=url.pathname;
    if(req.headers.host!==new URL(origin).host&&req.headers.host!==`127.0.0.1:${port}`)throw err(400,'Unexpected Host header');
    if(path.startsWith('/api/')||path.startsWith('/auth/')){const key=req.socket.remoteAddress;const record=limits.get(key)||{count:0,expires:Date.now()+60000};if(record.expires<Date.now()){record.count=0;record.expires=Date.now()+60000}record.count++;limits.set(key,record);if(record.count>180)throw err(429,'Too many requests. Please wait a minute.');}
    if(!['GET','HEAD'].includes(req.method)){if(req.headers.origin!==origin)throw err(403,'Origin check failed');if(!req.headers['content-type']?.startsWith('application/json'))throw err(415,'JSON content type required')}
    if(path==='/api/health'&&req.method==='GET')return json(res,200,{services:{'Web interface':true,'Discord sign-in':Boolean(process.env.DISCORD_CLIENT_ID&&process.env.DISCORD_CLIENT_SECRET),'Discord bot':Boolean(process.env.DISCORD_BOT_TOKEN),'Twitch':Boolean(process.env.TWITCH_CLIENT_ID&&process.env.TWITCH_CLIENT_SECRET),'YouTube':Boolean(process.env.YOUTUBE_API_KEY),'Kick':Boolean(process.env.KICK_ACCESS_TOKEN)}});
    if(path==='/api/connect'&&req.method==='GET'){
      if(!process.env.DISCORD_CLIENT_ID||!process.env.DISCORD_CLIENT_SECRET)throw err(503,'Discord sign-in is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in the server environment.');
      const state=randomBytes(24).toString('hex');pending.set(state,Date.now()+600000);
      const query=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,response_type:'code',redirect_uri:origin+'/auth/discord/callback',scope:'identify guilds',state});
      return json(res,200,{url:'https://discord.com/oauth2/authorize?'+query},{'Set-Cookie':cookie('lb_oauth',state,600)});
    }
    if(path==='/auth/discord/callback'&&req.method==='GET'){
      const state=url.searchParams.get('state');if(!state||cookies(req).lb_oauth!==state||!pending.has(state)||pending.get(state)<Date.now())throw err(400,'Invalid or expired OAuth state');pending.delete(state);
      if(url.searchParams.has('error'))throw err(400,'Discord authorization was cancelled');const code=url.searchParams.get('code');if(!code)throw err(400,'Missing authorization code');
      const token=await requestJSON('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:origin+'/auth/discord/callback'})});
      const user=await requestJSON('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token.access_token}});
      const sessionID=randomBytes(32).toString('hex');const old=cookies(req).lb_session;if(old)sessions.delete(old);
      sessions.set(sessionID,{token:token.access_token,user:{id:user.id,username:user.username,avatar:user.avatar},expires:Date.now()+Math.min(token.expires_in*1000,86400000)});
      res.writeHead(302,{Location:'/#/dashboard','Set-Cookie':[cookie('lb_session',sessionID,86400),cookie('lb_oauth','',0)]});return res.end();
    }
    if(path==='/api/invite'&&req.method==='GET'){if(!process.env.DISCORD_CLIENT_ID)throw err(503,'Set DISCORD_CLIENT_ID in the server environment first');const perms=(1n<<10n)|(1n<<11n)|(1n<<14n)|(1n<<16n)|(1n<<28n)|(1n<<33n)|(1n<<44n);return json(res,200,{url:'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,scope:'bot',permissions:perms.toString()})})}
    if(path==='/api/session'&&req.method==='GET'){let s;try{s=current(req)}catch{return json(res,200,{user:null,guilds:[]})}return json(res,200,{user:s.user,guilds:await manageable(s)})}
    if(path==='/api/logout'&&req.method==='POST'){sessions.delete(cookies(req).lb_session);return json(res,200,{ok:true},{'Set-Cookie':cookie('lb_session','',0)})}
    const route=path.match(/^\/api\/guilds\/(\d{17,20})\/(config|metadata)$/);
    if(route){const [,guild,action]=route;const access=await authorized(req,guild);if(action==='metadata'&&req.method==='GET')return json(res,200,await metadata(guild));if(action==='config'&&req.method==='GET'){const c=configs[guild]||emptyConfig();return json(res,200,{...c,logs:activity[guild]||[]})}if(action==='config'&&req.method==='PUT'){
        let c;try{c=sanitizedConfig(await body(req))}catch(e){throw err(400,e.message)}
        if(!access.admin&&c.settings.managerRoles!==(configs[guild]?.settings.managerRoles||''))throw err(403,'Only server administrators can change manager roles');
        const meta=await metadata(guild);const channels=new Set(meta.channels.map(c=>c.id)),roles=new Set(meta.roles.map(r=>r.id));
        if(c.notifications.some(n=>!channels.has(n.channel))||c.roles.some(r=>r.channel&&!channels.has(r.channel)))throw err(400,'Choose a text or announcement channel in this server');
        if(c.roles.some(r=>!roles.has(r.roleId)||meta.roles.find(x=>x.id===r.roleId)?.managed||r.roleId===guild))throw err(400,'Choose an assignable server role');
        const filterIds=c.roles.flatMap(r=>r.filterRoles.split(',')).concat(c.settings.managerRoles.split(',')).map(s=>s.trim()).filter(Boolean);if(filterIds.some(id=>!roles.has(id)))throw err(400,'A filter or manager role does not exist in this server');
        for(const n of c.notifications){if(n.webhookKey&&!process.env[n.webhookKey])throw err(400,`Webhook environment key ${n.webhookKey} is not configured`);if(n.webhookKey)await providers.verifyWebhook(n,guild);if(n.crosspost&&meta.channels.find(ch=>ch.id===n.channel)?.type!==5)throw err(400,'Crossposting requires an announcement channel')}
        configs[guild]=c;write('config',configs);addLog(guild,'Configuration updated by '+access.session.user.username);return json(res,200,{ok:true});
      }throw err(405,'Method not allowed')}
    if(path.startsWith('/api/')||path.startsWith('/auth/'))throw err(404,'Endpoint not found');
    if(!['GET','HEAD'].includes(req.method))throw err(405,'Method not allowed');
    const staticRoot=resolve(root,'dist'),relative=path==='/'?'index.html':decodeURIComponent(path.slice(1));
    const file=resolve(staticRoot,relative);if(!file.startsWith(staticRoot+'/')&&!file.startsWith(staticRoot+'\\'))throw err(403,'Forbidden');
    if(!['.html','.css','.js','.svg','.png','.jpg','.webp','.ico'].includes(extname(file)))throw err(404,'File not found');
    let content;try{content=readFileSync(file)}catch{throw err(404,'File not found')}
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'})[extname(file)]);res.setHeader('Cache-Control','no-cache');res.writeHead(200);res.end(req.method==='HEAD'?undefined:content);
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'The service could not complete this request. Check provider credentials and permissions.'});else res.end()}
});
server.listen(port,host,()=>console.log(`Livebeam ready at ${origin}\nLive delivery: ${process.env.DISCORD_BOT_TOKEN?'enabled':'disabled — demo mode'}`));
const interval=Math.max(60000,Number(process.env.POLL_INTERVAL_MS)||120000);
const poll=setInterval(()=>{if(process.env.DISCORD_BOT_TOKEN)engine.tick().catch(e=>console.error('Polling cycle failed:',e.message))},interval);poll.unref();
const cleanup=setInterval(()=>{const now=Date.now();for(const [k,v] of sessions)if(v.expires<now)sessions.delete(k);for(const [k,v] of pending)if(v<now)pending.delete(k);for(const [k,v] of limits)if(v.expires<now)limits.delete(k)},60000);cleanup.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(poll);clearInterval(cleanup);server.close(()=>process.exit(0))});
