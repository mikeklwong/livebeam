const idPattern=/^\d{17,20}$/;
const str=(v,max=2000)=>typeof v==='string'&&v.length<=max;
const ids=v=>v.split(',').map(s=>s.trim()).filter(Boolean);
export const emptyConfig=()=>({notifications:[],roles:[],schedules:[],logs:[],settings:{serverName:'My community',managerRoles:''}});
export function validateConfig(c){
  if(!c||typeof c!=='object'||!c.settings||!str(c.settings.serverName,80)||!str(c.settings.managerRoles,1000)||!ids(c.settings.managerRoles).every(x=>idPattern.test(x)))throw Error('Invalid server settings');
  for(const k of ['notifications','roles','schedules','logs'])if(!Array.isArray(c[k])||c[k].length>({notifications:270,roles:5,schedules:20,logs:100}[k]))throw Error(`Too many or invalid ${k}`);
  const unique=new Set();
  for(const n of [...c.notifications,...c.roles,...c.schedules]){if(!str(n.id,80)||!/^[a-zA-Z0-9-]+$/.test(n.id)||unique.has(n.id))throw Error('Invalid or duplicate configuration ID');unique.add(n.id)}
  for(const n of c.notifications){
    if(!['twitch','youtube','kick'].includes(n.platform)||!str(n.creator,100)||!n.creator.trim()||!idPattern.test(n.channel)||!str(n.message,1800)||!/^#[0-9a-f]{6}$/i.test(n.color)||!Number.isInteger(n.cooldown)||n.cooldown<0||n.cooldown>10080||typeof n.enabled!=='boolean'||!['keep','edit','delete','message'].includes(n.cleanup))throw Error('Invalid notification configuration');
    if(n.platform==='twitch'&&!/^[a-zA-Z0-9_]+$/.test(n.creator))throw Error('Use a Twitch login without a URL');
    if(n.platform==='youtube'&&!/^UC[\w-]{22}$/.test(n.creator))throw Error('Use a YouTube channel ID beginning with UC');
    if(n.platform==='kick'&&!/^\d+$/.test(n.creator))throw Error('Use a numeric Kick broadcaster ID');
    for(const key of ['games','keywords'])if(n[key]!==undefined&&(!str(n[key],300)||ids(n[key]).length>5))throw Error('Use at most five game or title filters');
    if(n.videoType&&!['uploads','live','both'].includes(n.videoType))throw Error('Invalid YouTube content filter');
    for(const key of ['thumbnail','botAvatar'])if(n[key]&&(!str(n[key],2000)||!/^https:\/\/[^\s]+$/.test(n[key])))throw Error('Image URLs must use HTTPS');
    if(n.webhookKey&&!/^[A-Z][A-Z0-9_]{0,79}$/.test(n.webhookKey))throw Error('Invalid webhook environment key');
    if(n.botName&&!str(n.botName,80))throw Error('Bot name is too long');
    if(n.endMessage&&!str(n.endMessage,1800))throw Error('Ending message is too long');
  }
  for(const r of c.roles){if(!str(r.name,80)||!idPattern.test(r.roleId)||!['include','exclude'].includes(r.filterMode)||!str(r.filterRoles,1000)||!ids(r.filterRoles).every(x=>idPattern.test(x))||!str(r.members,10000)||!r.members.trim()||!r.members.trim().split('\n').every(line=>/^\d{17,20}:[a-zA-Z0-9_]+$/.test(line.trim()))||r.members.trim().split('\n').length>100||r.channel&&!idPattern.test(r.channel)||!str(r.message,1800))throw Error('Invalid Live Role configuration');}
  for(const s of c.schedules)if(!str(s.creator,100)||!/^[a-zA-Z0-9_]+$/.test(s.creator)||!str(s.title,100)||!str(s.description,1000))throw Error('Invalid schedule configuration');
  for(const l of c.logs)if(!str(l.message,500)||!Number.isFinite(Date.parse(l.time)))throw Error('Invalid activity record');
  return c;
}
export function sanitizedConfig(c){
  validateConfig(c);
  const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
  return {settings:pick(c.settings,['serverName','managerRoles']),notifications:c.notifications.map(n=>pick(n,['id','platform','creator','channel','message','color','cooldown','cleanup','enabled','videoType','games','keywords','endMessage','thumbnail','botName','botAvatar','webhookKey','crosspost'])),roles:c.roles.map(r=>pick(r,['id','name','roleId','filterMode','filterRoles','members','channel','message'])),schedules:c.schedules.map(s=>pick(s,['id','creator','title','description'])),logs:[]};
}
export function renderMessage(template,stream){return String(template||'').replace(/\{(name|title|game|url)\}/g,(_,k)=>String(stream[k]||''));}
export function matchesFilters(notification,stream){const games=ids(notification.games||'').map(s=>s.toLowerCase());const keywords=ids(notification.keywords||'').map(s=>s.toLowerCase());return (!games.length||games.includes((stream.game||'').toLowerCase()))&&keywords.every(k=>(stream.title||'').toLowerCase().includes(k));}
export function eligibleRole(rule,member){const filter=ids(rule.filterRoles||'');if(!filter.length)return true;const has=filter.some(id=>member.roles.includes(id));return rule.filterMode==='exclude'?!has:has;}
export function canManage(guild){return Boolean(guild.owner)||(BigInt(guild.permissions||0)&40n)!==0n;}
