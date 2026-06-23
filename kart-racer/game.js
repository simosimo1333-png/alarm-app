/* =====================================================================
   ANIMAL KART RACING  -  pseudo-3D arcade kart racer
   Pure HTML5 Canvas. No assets, everything drawn procedurally.
   ===================================================================== */
(() => {
'use strict';

/* ----------------------------- Utilities ----------------------------- */
const U = {
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
  lerp:(a,b,t)=>a+(b-a)*t,
  rnd:(a,b)=>a+Math.random()*(b-a),
  ease:(a,b,t)=>a+(b-a)*((-Math.cos(t*Math.PI)/2)+0.5),
  accel:(v,a,dt)=>v+a*dt,
  fmtTime:(ms)=>{
    if(ms<0)ms=0;
    const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), c=Math.floor((ms%1000)/10);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
  },
  ord:(n)=>['th','st','nd','rd'][(n%100>>3^1&&n%10)||0]||'th'
};
// simpler ordinal
function ordinal(n){ const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
function ordSuffix(n){ const s=['th','st','nd','rd'], v=n%100; return (s[(v-20)%10]||s[v]||s[0]); }

/* ----------------------------- Constants ----------------------------- */
const SEG_LEN = 200;          // length of a single road segment
const RUMBLE = 4;             // segments per stripe
const ROAD_W = 2200;          // half road width in world units
const LANES = 3;
const FOV = 100;
const CAM_HEIGHT = 1100;
const CAM_DEPTH = 1/Math.tan((FOV/2)*Math.PI/180);
const DRAW_DIST = 240;        // segments rendered ahead
const FOG = 4.0;
const MAX_SPEED = SEG_LEN/0.0166 * 0.55;   // top speed (world units/sec)
const ACCEL = MAX_SPEED/3.2;
const BREAKING = -MAX_SPEED/1.4;
const DECEL = -MAX_SPEED/5;
const OFFROAD_DECEL = -MAX_SPEED/2.2;
const OFFROAD_LIMIT = MAX_SPEED/3.2;
const CENTRIFUGAL = 0.32;
const TOTAL_LAPS = 3;
const RACERS = 6;             // 1 player + 5 AI

/* ----------------------------- Palettes ----------------------------- */
const PALETTES = {
  jungle: {
    type:'jungle',
    sky:['#7fc7ff','#bfe6ff','#e9f7ff'],
    fog:'#cfeef0',
    grass:['#3f8c2f','#347a26'],
    roadCol:['#6e4b2c','#765230'],
    rumble:['#e8e2d0','#c0392b'],
    lane:'#f2e9d0',
    sceneryColor:'#1f6b1c'
  },
  neon: {
    type:'neon',
    sky:['#0a0726','#241048','#3a0f5c'],
    fog:'#1a0b3a',
    grass:['#160a30','#1d0f3c'],
    roadCol:['#241038','#2c1644'],
    rumble:['#ff2bd6','#19e8ff'],
    lane:'#ff63e6',
    sceneryColor:'#ff2bd6'
  },
  beach: {
    type:'beach',
    sky:['#36b6ff','#86d8ff','#d9f5ff'],
    fog:'#cfeeff',
    grass:['#e9d59a','#e0c884'],
    roadCol:['#7a5733','#82603a'],
    rumble:['#ffffff','#ff5a5a'],
    lane:'#fff3d6',
    sceneryColor:'#0a8a9c'
  }
};

/* ----------------------------- Characters ----------------------------- */
const CHARS = [
  {name:'タイガー', face:'🐯', color:'#e23b2e', accent:'#ffffff'},
  {name:'ハスキー', face:'🐶', color:'#3a7bd5', accent:'#dfe9ff'},
  {name:'パンサー', face:'🐱', color:'#7a4fd6', accent:'#e8d9ff'},
  {name:'モンキー', face:'🐵', color:'#e58a2a', accent:'#ffe6b0'},
  {name:'フロッグ', face:'🐸', color:'#3aaf4a', accent:'#dfffdf'},
  {name:'ペンギン', face:'🐧', color:'#2b3a55', accent:'#bcd6ff'},
  {name:'フォックス', face:'🦊', color:'#ff7a1a', accent:'#ffe0c0'},
  {name:'パンダ',   face:'🐼', color:'#222831', accent:'#ffffff'},
];

/* ----------------------------- Courses ----------------------------- */
const COURSES = [
  {name:'ジャングル神殿', flag:'🌴', palette:'jungle', grad:'linear-gradient(160deg,#2e7d32,#0e4d1a)'},
  {name:'ネオンシティ',   flag:'🌃', palette:'neon',   grad:'linear-gradient(160deg,#7a1fa2,#1a0b3a)'},
  {name:'トロピカルビーチ', flag:'🏝', palette:'beach',  grad:'linear-gradient(160deg,#2bb6ff,#0a6e9c)'},
];

/* ----------------------------- Items ----------------------------- */
const ITEMS = {
  boost:{icon:'🔥'},
  shield:{icon:'🛡'},
  rocket:{icon:'🚀'},
  bolt:{icon:'⚡'},
};
const ITEM_POOL = ['boost','shield','rocket','bolt'];

/* ----------------------------- DOM ----------------------------- */
const $ = id => document.getElementById(id);
const scene = $('scene'), sctx = scene.getContext('2d');
const mini = $('minimap'), mctx = mini.getContext('2d');
const speedo = $('speedo'), spctx = speedo.getContext('2d');

let W=0, H=0, DPR=1;
function resize(){
  DPR = Math.min(window.devicePixelRatio||1, 2);
  W = window.innerWidth; H = window.innerHeight;
  scene.width = W*DPR; scene.height = H*DPR;
  scene.style.width=W+'px'; scene.style.height=H+'px';
  sctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resize);
resize();

/* ============================================================
                       ROAD / TRACK
   ============================================================ */
let segments = [];
let trackLength = 0;
let mapPath = [];          // {x,y} per segment for minimap
let mapBox = {minx:0,miny:0,maxx:1,maxy:1};

function lastY(){ return segments.length===0?0:segments[segments.length-1].p2.world.y; }

function addSegment(curve, y){
  const n = segments.length;
  segments.push({
    index:n,
    p1:{world:{x:0,y:lastY(),z:n*SEG_LEN}, camera:{}, screen:{}},
    p2:{world:{x:0,y:y,     z:(n+1)*SEG_LEN}, camera:{}, screen:{}},
    curve, sprites:[], cars:[],
    colorIndex: Math.floor(n/RUMBLE)%2,
    start:false, finish:false
  });
}
function addRoad(enter, hold, leave, curve, y){
  const startY = lastY(), endY = startY + y*SEG_LEN;
  const total = enter+hold+leave;
  for(let n=0;n<enter;n++) addSegment(U.ease(0,curve,n/enter), U.ease(startY,endY,n/total));
  for(let n=0;n<hold;n++)  addSegment(curve,                 U.ease(startY,endY,(enter+n)/total));
  for(let n=0;n<leave;n++) addSegment(U.ease(curve,0,n/leave),U.ease(startY,endY,(enter+hold+n)/total));
}
const L={n:0,a:2,b:4,c:6}; // curve amounts
function addStraight(num=30){ addRoad(num,num,num,0,0); }
function addCurve(num=30,curve=3,height=0){ addRoad(num,num,num,curve,height); }
function addHill(num=40,height=40){ addRoad(num,num,num,0,height); }
function addSCurve(){ addRoad(20,20,20,-4,0); addRoad(20,20,20,4,30); addRoad(20,20,20,-2,-30); addRoad(20,20,20,4,10); }
function addBumps(){ for(let i=0;i<10;i++) addRoad(8,8,8,0, (i%2)?12:-10); }

function addScenery(type, density){
  // add roadside sprites along whole track
  for(let n=10;n<segments.length-10;n+=Math.floor(U.rnd(density*0.6,density*1.4))){
    const side = Math.random()<0.5?-1:1;
    const off = side*(1.25+Math.random()*1.4);
    segments[n].sprites.push({type, offset:off});
  }
}

function buildTrack(courseIdx){
  segments=[]; mapPath=[];
  // layout differs a bit per course for variety
  if(courseIdx===0){ // jungle - flowing curves & hills
    addStraight(40); addCurve(40,3,30); addHill(40,60); addSCurve();
    addCurve(50,-5,-20); addStraight(20); addCurve(40,6,40);
    addBumps(); addCurve(40,-4,0); addHill(40,-50); addStraight(30);
    addCurve(50,5,20); addSCurve(); addCurve(40,-6,30); addStraight(40);
  } else if(courseIdx===1){ // neon - fast & twisty
    addStraight(50); addCurve(45,5,0); addCurve(45,-5,0); addStraight(20);
    addCurve(60,7,20); addCurve(40,-3,-20); addSCurve(); addStraight(20);
    addCurve(50,-6,0); addCurve(50,6,30); addBumps(); addStraight(30);
    addCurve(45,4,-10); addCurve(45,-4,0); addStraight(50);
  } else { // beach - long sweeps
    addStraight(50); addCurve(60,4,20); addHill(50,50); addStraight(30);
    addCurve(60,-4,-30); addCurve(50,6,0); addSCurve(); addStraight(30);
    addCurve(70,-5,40); addHill(40,-40); addCurve(50,3,0); addStraight(40);
    addCurve(60,5,20); addStraight(50);
  }
  // start / finish line
  for(let n=0;n<RUMBLE*2;n++) segments[n].colorIndex=2; // dark start tint
  segments[2].start=true;
  for(let n=segments.length-RUMBLE*2;n<segments.length;n++) segments[n] && (segments[n].finish=true);

  trackLength = segments.length*SEG_LEN;

  // scenery per palette
  const t = COURSES[courseIdx].palette;
  if(t==='jungle') addScenery('tree', 6);
  else if(t==='neon') addScenery('billboard', 9);
  else addScenery('palm', 7);

  buildMapPath();
}

function buildMapPath(){
  let heading=0, x=0, y=0; let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  for(let i=0;i<segments.length;i++){
    heading += segments[i].curve * 0.0009;
    x += Math.sin(heading); y += Math.cos(heading);
    mapPath[i]={x,y};
    minx=Math.min(minx,x); maxx=Math.max(maxx,x);
    miny=Math.min(miny,y); maxy=Math.max(maxy,y);
  }
  mapBox={minx,miny,maxx,maxy};
}
function findSegment(z){ return segments[Math.floor(z/SEG_LEN)%segments.length]; }

/* ============================================================
                         PROJECTION
   ============================================================ */
function project(p, camX, camY, camZ){
  p.camera.x = (p.world.x||0) - camX;
  p.camera.y = (p.world.y||0) - camY;
  p.camera.z = (p.world.z||0) - camZ;
  p.screen.scale = CAM_DEPTH / p.camera.z;
  p.screen.x = Math.round((W/2) + (p.screen.scale * p.camera.x * W/2));
  p.screen.y = Math.round((H/2) - (p.screen.scale * p.camera.y * H/2));
  p.screen.w = Math.round(        (p.screen.scale * ROAD_W   * W/2));
}
function fog(d,density){ return 1/Math.pow(Math.E, d*d*density); }

/* ============================================================
                          GAME STATE
   ============================================================ */
const G = {
  state:'menu',        // menu | countdown | race | finish
  courseIdx:0, charIdx:0,
  pal:PALETTES.jungle,
  position:0, playerX:0, speed:0,
  steer:0, drifting:false, driftDir:0, driftCharge:0,
  lap:1, lapStartT:0, raceT:0, lapTimes:[],
  cars:[], me:null,
  item:null, itemCooldown:0, shieldT:0, boostT:0, spinT:0,
  projectiles:[],     // {z,offset,owner}
  hazards:[],         // bananas etc (unused-light)
  bgX:0,
  countT:0, finished:false, finishRank:0,
  startTime:0,
};

const keys={};
window.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()]=true;
  if(e.key===' ') useItem();
});
window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });

/* ----------------------------- Touch ----------------------------- */
function bindHold(id,on,off){
  const el=$(id); if(!el)return;
  const s=e=>{e.preventDefault();on();}, t=e=>{e.preventDefault();off();};
  el.addEventListener('touchstart',s,{passive:false});
  el.addEventListener('touchend',t); el.addEventListener('touchcancel',t);
  el.addEventListener('mousedown',s); el.addEventListener('mouseup',t); el.addEventListener('mouseleave',t);
}
const touch={left:false,right:false,gas:false,brake:false};
bindHold('t-left',()=>touch.left=true,()=>touch.left=false);
bindHold('t-right',()=>touch.right=true,()=>touch.right=false);
bindHold('t-gas',()=>touch.gas=true,()=>touch.gas=false);
bindHold('t-brake',()=>touch.brake=true,()=>touch.brake=false);
$('t-item').addEventListener('touchstart',e=>{e.preventDefault();useItem();},{passive:false});
$('t-item').addEventListener('click',useItem);
if('ontouchstart' in window) $('touch').classList.remove('hidden');

/* ============================================================
                            MENU
   ============================================================ */
function buildMenu(){
  const cl=$('course-list'); cl.innerHTML='';
  COURSES.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='course-card'+(i===G.courseIdx?' sel':'');
    d.style.background=c.grad;
    d.innerHTML=`<span class="flag">${c.flag}</span><span>${c.name}</span>`;
    d.onclick=()=>{ G.courseIdx=i; buildMenu(); };
    cl.appendChild(d);
  });
  const hl=$('char-list'); hl.innerHTML='';
  CHARS.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='char-card'+(i===G.charIdx?' sel':'');
    d.style.borderColor=i===G.charIdx?'':'';
    d.innerHTML=`<div class="face">${c.face}</div><div class="nm" style="color:${i===G.charIdx?'#ffd27a':'#cdd6ff'}">${c.name}</div>`;
    d.onclick=()=>{ G.charIdx=i; buildMenu(); };
    hl.appendChild(d);
  });
}
$('start-btn').onclick=startRace;
$('again-btn').onclick=()=>{ $('results').classList.add('hidden'); startRace(); };
$('menu-btn').onclick=()=>{ $('results').classList.add('hidden'); $('menu').classList.remove('hidden'); G.state='menu'; };

/* ============================================================
                       RACE SETUP
   ============================================================ */
function startRace(){
  G.pal = PALETTES[COURSES[G.courseIdx].palette];
  buildTrack(G.courseIdx);

  // racers
  G.cars=[];
  const usedChars=[G.charIdx];
  for(let i=0;i<RACERS;i++){
    let ci;
    if(i===0) ci=G.charIdx;
    else { do{ ci=Math.floor(Math.random()*CHARS.length);}while(usedChars.includes(ci)); usedChars.push(ci); }
    const car={
      id:i, isPlayer:i===0, ch:CHARS[ci],
      z: -i*SEG_LEN*1.2,           // staggered grid behind line
      offset: ((i%LANES)-1)*0.55,  // lanes
      speed:0, lap:0, lapProg:0,
      finished:false, rank:i+1, total:0,
      aiAggro: U.rnd(0.92,1.04),
      aiLane: ((i%LANES)-1)*0.55,
      laneTimer: U.rnd(1,3),
      spinT:0, shieldT:0, boostT:0, item:null, itemTimer:U.rnd(2,5),
      screen:{}
    };
    if(car.z<0) car.z += trackLength; // wrap so they're at the back of grid
    G.cars.push(car);
  }
  G.me = G.cars[0];
  // starting grid: player at the back (z=0), AI staggered ahead in lanes
  G.cars.forEach((c,i)=>{
    c.lap = 1;
    c.z = i*SEG_LEN*1.15;
    c.offset = ((i%LANES)-1)*0.55;
  });

  G.position = G.me.z;
  G.playerX = G.me.offset;
  G.speed=0; G.steer=0; G.drifting=false; G.driftCharge=0;
  G.lap=1; G.lapTimes=[]; G.raceT=0;
  G.item=null; G.itemCooldown=2; G.shieldT=0; G.boostT=0; G.spinT=0;
  G.projectiles=[]; G.bgX=0; G.finished=false; G.finishRank=0;

  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('lap-max').textContent=TOTAL_LAPS;
  updateItemUI();

  // countdown
  G.state='countdown'; G.countT=3.999;
  $('countdown').classList.remove('hidden');
  lastTime=performance.now();
}

/* ============================================================
                        ITEMS
   ============================================================ */
function giveRandomItem(){
  // bias toward boost when behind
  const r=Math.random();
  if(G.me.rank>=4 && r<0.4) G.item='boost';
  else G.item = ITEM_POOL[Math.floor(Math.random()*ITEM_POOL.length)];
  updateItemUI();
}
function updateItemUI(){
  const ic=$('item-icon'), box=$('item-box');
  if(G.item){ ic.textContent=ITEMS[G.item].icon; box.classList.remove('charging'); }
  else { ic.textContent=''; box.classList.add('charging'); }
}
function useItem(){
  if(G.state!=='race' || !G.item) return;
  const it=G.item; G.item=null; updateItemUI(); G.itemCooldown=2.5;
  if(it==='boost' || it==='bolt'){ G.boostT = it==='bolt'?1.6:1.1; }
  else if(it==='shield'){ G.shieldT=4; }
  else if(it==='rocket'){
    G.projectiles.push({z:G.me.z, offset:G.playerX, speed:MAX_SPEED*1.7, owner:0, life:3});
  }
}

/* ============================================================
                       UPDATE
   ============================================================ */
function update(dt){
  if(G.state==='countdown'){
    G.countT-=dt;
    const n=Math.ceil(G.countT-0.999);
    const cd=$('countdown');
    if(G.countT<=1){ cd.textContent='GO!'; cd.style.color='#5dff8b'; }
    else { cd.textContent=n; cd.style.color='#fff'; }
    if(G.countT<=0){ G.state='race'; cd.classList.add('hidden'); G.startTime=performance.now(); }
    return;
  }
  if(G.state!=='race') return;

  G.raceT+=dt*1000;
  updatePlayer(dt);
  updateAI(dt);
  updateProjectiles(dt);
  updateRanks();
  updateHUD();
}

function curveAt(z){ return findSegment(z).curve; }

function updatePlayer(dt){
  const me=G.me;
  const seg=findSegment(G.position);
  const speedPct = G.speed/MAX_SPEED;
  const dx = dt * 2 * speedPct;   // steering responsiveness scaled by speed

  // input
  let steerInput=0;
  if(keys['arrowleft']||keys['a']||touch.left) steerInput=-1;
  if(keys['arrowright']||keys['d']||touch.right) steerInput=1;
  const gas = keys['arrowup']||keys['w']||touch.gas;
  const brake = keys['arrowdown']||keys['s']||touch.brake;
  G.drifting = (keys['shift']) && G.speed>MAX_SPEED*0.4 && steerInput!==0;

  // acceleration
  if(G.spinT>0){ G.speed=U.accel(G.speed, DECEL*1.4, dt); G.spinT-=dt; }
  else if(G.boostT>0){ G.speed=U.accel(G.speed, ACCEL*1.5, dt); G.boostT-=dt; G.speed=Math.min(G.speed,MAX_SPEED*1.45); }
  else if(gas) G.speed=U.accel(G.speed, ACCEL, dt);
  else if(brake) G.speed=U.accel(G.speed, BREAKING, dt);
  else G.speed=U.accel(G.speed, DECEL, dt);

  // steering
  const steerMul = G.drifting?1.9:1;
  G.playerX += dx * steerInput * steerMul;
  G.steer = U.lerp(G.steer, steerInput, 0.2);

  // centrifugal pull on curves
  G.playerX -= dx * speedPct * seg.curve * CENTRIFUGAL;

  // drift charge -> mini boost
  if(G.drifting){ G.driftCharge+=dt; }
  else if(G.driftCharge>0){ if(G.driftCharge>0.8){ G.boostT=Math.max(G.boostT,0.5); } G.driftCharge=0; }

  // offroad
  if((G.playerX<-1||G.playerX>1) && G.speed>OFFROAD_LIMIT){
    G.speed=U.accel(G.speed, OFFROAD_DECEL, dt);
    // rumble shake handled in render
  }
  G.playerX=U.clamp(G.playerX,-2.2,2.2);
  G.speed=U.clamp(G.speed,0,MAX_SPEED*1.5);

  // collide with other cars
  for(const c of G.cars){
    if(c.isPlayer) continue;
    const dzRaw = c.z - G.position;
    const dz = ((dzRaw+trackLength*1.5)%trackLength)-0; // forward distance approx
    let fwd = c.z - G.position;
    if(fwd>trackLength/2) fwd-=trackLength;
    if(fwd<-trackLength/2) fwd+=trackLength;
    if(Math.abs(fwd) < SEG_LEN*1.6 && Math.abs(c.offset-G.playerX)<0.5){
      if(G.speed>c.speed){ G.speed=c.speed*0.85; }
      G.playerX += (G.playerX-c.offset)>0?0.04:-0.04;
    }
  }

  // advance
  G.position += G.speed*dt;
  while(G.position>=trackLength){ G.position-=trackLength; onLap(); }
  while(G.position<0) G.position+=trackLength;
  me.z=G.position; me.offset=G.playerX; me.speed=G.speed;

  // item cooldown
  if(!G.item){
    if(G.itemCooldown>0) G.itemCooldown-=dt;
    if(G.itemCooldown<=0) giveRandomItem();
  }
  if(G.shieldT>0) G.shieldT-=dt;

  // bg parallax
  G.bgX -= seg.curve*speedPct*2 + speedPct*0.3;
}

function onLap(){
  if(G.finished) return;
  G.lapTimes.push(G.raceT - (G.lapTimes.reduce((a,b)=>a+b,0)));
  G.lap++;
  if(G.lap>TOTAL_LAPS){
    G.lap=TOTAL_LAPS;
    finishRace();
  }
}

function updateAI(dt){
  for(const c of G.cars){
    if(c.isPlayer) continue;
    const seg=findSegment(c.z);
    // target speed with rubber-band based on distance to player
    let target = MAX_SPEED*0.96*c.aiAggro;
    let diff = c.total - G.me.total;
    if(diff>SEG_LEN*40) target*=0.9;       // ahead -> slow a touch
    else if(diff<-SEG_LEN*40) target*=1.08; // behind -> catch up
    if(c.spinT>0){ c.speed=U.accel(c.speed,DECEL*1.4,dt); c.spinT-=dt; }
    else if(c.boostT>0){ target*=1.4; c.boostT-=dt; c.speed=U.accel(c.speed,ACCEL*1.3,dt); }
    else c.speed = U.accel(c.speed, c.speed<target?ACCEL*0.85:DECEL, dt);
    c.speed=U.clamp(c.speed,0,MAX_SPEED*1.4);

    // racing line: follow curve, switch lanes occasionally
    c.laneTimer-=dt;
    if(c.laneTimer<=0){ c.aiLane=((Math.floor(Math.random()*LANES))-1)*0.6; c.laneTimer=U.rnd(1.5,3.5); }
    let want = c.aiLane - seg.curve*0.12;
    // avoid player if close ahead
    let fwd = G.me.z - c.z; if(fwd>trackLength/2)fwd-=trackLength; if(fwd<-trackLength/2)fwd+=trackLength;
    if(fwd>0 && fwd<SEG_LEN*4 && Math.abs(G.playerX-c.offset)<0.5){ want += (c.offset>G.playerX)?0.5:-0.5; }
    c.offset=U.lerp(c.offset, U.clamp(want,-0.95,0.95), dt*2.2);

    if(c.shieldT>0)c.shieldT-=dt;

    c.z += c.speed*dt;
    while(c.z>=trackLength){ c.z-=trackLength; if(!c.finished){ c.lap++; if(c.lap>TOTAL_LAPS){ c.finished=true; c.speed*=0.5; } } }
  }
}

function updateProjectiles(dt){
  for(const p of G.projectiles){
    p.z += p.speed*dt; p.life-=dt;
    // hit nearest car ahead of owner
    for(const c of G.cars){
      if(c.id===p.owner) continue;
      let fwd=c.z-p.z; if(fwd>trackLength/2)fwd-=trackLength; if(fwd<-trackLength/2)fwd+=trackLength;
      if(Math.abs(fwd)<SEG_LEN*1.4){
        if(c.isPlayer){ if(G.shieldT<=0){ G.spinT=1.2; } }
        else { if(c.shieldT<=0){ c.spinT=1.2; } }
        p.life=0; break;
      }
    }
  }
  G.projectiles=G.projectiles.filter(p=>p.life>0);
}

function updateRanks(){
  G.me.lap = G.lap;   // keep player car's lap in sync for ranking
  for(const c of G.cars) c.total = c.lap*trackLength + c.z;
  const sorted=[...G.cars].sort((a,b)=>b.total-a.total);
  sorted.forEach((c,i)=>c.rank=i+1);
}

function finishRace(){
  if(G.finished) return;
  G.finished=true; G.finishRank=G.me.rank;
  setTimeout(()=>{ G.state='finish'; showResults(); }, 1200);
  const b=$('banner'); b.textContent='FINISH!'; b.classList.remove('hidden');
  setTimeout(()=>b.classList.add('hidden'),1500);
}

function showResults(){
  $('hud').classList.add('hidden');
  const r=$('results'); r.classList.remove('hidden');
  const sorted=[...G.cars].sort((a,b)=>b.total-a.total);
  $('result-title').textContent = G.me.rank===1?'🏆 WIN!':'FINISH!';
  const list=$('result-list'); list.innerHTML='';
  sorted.forEach((c,i)=>{
    const li=document.createElement('li');
    if(c.isPlayer) li.className='me';
    li.innerHTML=`<span class="pl">${ordinal(i+1)}</span><span class="fc">${c.ch.face}</span><span>${c.ch.name}${c.isPlayer?'（あなた）':''}</span><span class="tm">${i===0?'':''}</span>`;
    list.appendChild(li);
  });
}

/* ============================================================
                          HUD
   ============================================================ */
function updateHUD(){
  $('lap-cur').textContent=Math.min(G.lap,TOTAL_LAPS);
  $('time-val').textContent=U.fmtTime(G.raceT);
  $('pos-num').textContent=G.me.rank;
  $('pos-ord').textContent=ordSuffix(G.me.rank);

  // standings
  const sorted=[...G.cars].sort((a,b)=>a.rank-b.rank);
  const ol=$('standings');
  if(ol.children.length!==sorted.length){
    ol.innerHTML='';
    for(let i=0;i<sorted.length;i++){ const li=document.createElement('li'); ol.appendChild(li); }
  }
  sorted.forEach((c,i)=>{
    const li=ol.children[i];
    li.className=c.isPlayer?'me':'';
    li.innerHTML=`<span class="rk">${i+1}</span><span class="av">${c.ch.face}</span>`;
  });
}

/* ============================================================
                       RENDERING
   ============================================================ */
function render(){
  sctx.clearRect(0,0,W,H);
  drawBackground();
  drawRoad();
  drawPlayerKart();
  drawSpeedo();
  drawMinimap();
}

/* ----- background ----- */
function drawBackground(){
  const pal=G.pal;
  const horizon=H*0.5;
  // sky gradient
  const g=sctx.createLinearGradient(0,0,0,horizon+40);
  g.addColorStop(0,pal.sky[0]); g.addColorStop(0.6,pal.sky[1]); g.addColorStop(1,pal.sky[2]);
  sctx.fillStyle=g; sctx.fillRect(0,0,W,horizon+40);

  const off=((G.bgX*0.4)%W+W)%W;
  if(pal.type==='jungle'){
    // sun
    sctx.fillStyle='rgba(255,250,210,0.9)';
    sctx.beginPath(); sctx.arc(W*0.78,horizon*0.4,40,0,7); sctx.fill();
    drawHills(horizon,'#2f7d3a','#1f5a28',off);
  } else if(pal.type==='neon'){
    // stars
    sctx.fillStyle='rgba(255,255,255,0.6)';
    for(let i=0;i<40;i++){ const x=(i*97+13)%W, y=(i*53)%(horizon*0.7); sctx.fillRect(x,y,2,2); }
    drawCity(horizon,off);
  } else {
    sctx.fillStyle='rgba(255,255,235,0.95)';
    sctx.beginPath(); sctx.arc(W*0.2,horizon*0.35,46,0,7); sctx.fill();
    drawClouds(horizon,off);
    drawHills(horizon,'#0f8fa0','#0a6e80',off); // distant islands
  }
}
function drawHills(horizon,c1,c2,off){
  for(let layer=0;layer<2;layer++){
    sctx.fillStyle=layer?c2:c1;
    const base=horizon - (layer?2:18);
    const amp=layer?30:55, step=180, ph=off*(layer?0.6:1);
    sctx.beginPath(); sctx.moveTo(0,horizon);
    for(let x=-step;x<=W+step;x+=step){
      const px=x-(ph%step);
      sctx.lineTo(px, base - Math.abs(Math.sin((px+layer*90)*0.01))*amp);
      sctx.lineTo(px+step/2, base - amp*(layer?0.4:0.7));
    }
    sctx.lineTo(W,horizon); sctx.closePath(); sctx.fill();
  }
}
function drawCity(horizon,off){
  // skyline silhouette with neon windows
  sctx.fillStyle='#120726';
  const bw=70;
  for(let x=-bw;x<W+bw;x+=bw){
    const px=x-((off*0.5)%bw);
    const h=40+((Math.abs(Math.sin(px*0.07))*90)|0);
    sctx.fillStyle='#160a30';
    sctx.fillRect(px,horizon-h,bw-8,h);
    // neon windows
    const colW=['#ff2bd6','#19e8ff','#ffe11a','#7a5bff'][(px|0)%4];
    sctx.fillStyle=colW;
    for(let wy=horizon-h+8; wy<horizon-6; wy+=12)
      for(let wx=px+6; wx<px+bw-12; wx+=12)
        if((wx*wy|0)%5===0){ sctx.globalAlpha=0.8; sctx.fillRect(wx,wy,5,6); }
    sctx.globalAlpha=1;
  }
}
function drawClouds(horizon,off){
  sctx.fillStyle='rgba(255,255,255,0.85)';
  for(let i=0;i<6;i++){
    const x=((i*260 - off*0.3)%(W+260)+W+260)%(W+260)-130;
    const y=horizon*0.3 + (i%3)*26;
    cloud(x,y,40+i*6);
  }
}
function cloud(x,y,r){
  sctx.beginPath();
  sctx.arc(x,y,r*0.5,0,7); sctx.arc(x+r*0.5,y-r*0.2,r*0.4,0,7);
  sctx.arc(x+r,y,r*0.5,0,7); sctx.arc(x+r*0.5,y+r*0.1,r*0.55,0,7);
  sctx.fill();
}

/* ----- road ----- */
function drawRoad(){
  const pal=G.pal;
  const base=findSegment(G.position);
  const basePct=(G.position%SEG_LEN)/SEG_LEN;
  const playerSeg=findSegment(G.position+CAM_HEIGHT*CAM_DEPTH);
  const playerPct=((G.position+CAM_HEIGHT*CAM_DEPTH)%SEG_LEN)/SEG_LEN;
  const playerY=U.lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPct);

  let maxy=H, x=0, dx=-(base.curve*basePct);
  const camX = G.playerX*ROAD_W;

  // shake when offroad
  let shake=0;
  if((G.playerX<-1||G.playerX>1)&&G.speed>OFFROAD_LIMIT) shake=Math.sin(performance.now()*0.05)* (G.speed/MAX_SPEED) *4;

  const drawn=[];
  for(let n=0;n<DRAW_DIST;n++){
    const seg=segments[(base.index+n)%segments.length];
    seg.looped = seg.index < base.index;
    seg.fogv = fog(n/DRAW_DIST, FOG);
    seg.clip = maxy;
    const camZ = G.position - (seg.looped?trackLength:0);
    project(seg.p1, camX - x,      playerY+CAM_HEIGHT, camZ);
    project(seg.p2, camX - x - dx, playerY+CAM_HEIGHT, camZ);
    x+=dx; dx+=seg.curve;

    if(seg.p1.camera.z<=CAM_DEPTH || seg.p2.screen.y>=seg.p1.screen.y || seg.p2.screen.y>=maxy) continue;
    renderSegment(seg, pal, shake);
    drawn.push(seg);
    maxy=seg.p1.screen.y;
  }

  // sprites + cars: far to near
  for(let i=drawn.length-1;i>=0;i--){
    const seg=drawn[i];
    // scenery
    for(const sp of seg.sprites) drawScenery(sp.type, seg, sp.offset, shake);
    // cars in this segment range
    for(const c of G.cars){
      if(c.isPlayer) continue;
      const cs=findSegment(c.z);
      if(cs.index===seg.index) drawCar(c, seg, shake);
    }
    // projectiles
    for(const p of G.projectiles){
      if(findSegment(p.z).index===seg.index) drawProjectile(p,seg,shake);
    }
  }
}

function renderSegment(seg,pal,shake){
  const p1=seg.p1.screen, p2=seg.p2.screen;
  const ci=seg.colorIndex;
  const grass = ci===2?pal.grass[0]:pal.grass[ci%2];
  let road = seg.colorIndex===2 ? '#3a3a3a' : pal.roadCol[ci%2];
  let rumble = pal.rumble[ci%2];
  const fogv=seg.fogv;

  const sx=shake;
  // grass full width band
  sctx.fillStyle=grass;
  sctx.fillRect(0,p2.y,W,p1.y-p2.y+1);

  // rumble
  poly(p1.x+sx, p1.y, p1.w*1.15, p2.x+sx, p2.y, p2.w*1.15, rumble);
  // road
  poly(p1.x+sx, p1.y, p1.w, p2.x+sx, p2.y, p2.w, road);

  // lane markers
  if(ci%2===0){
    const lw1=p1.w*0.04, lw2=p2.w*0.04;
    for(let l=1;l<LANES;l++){
      const lp1 = -1 + 2*l/LANES, lp2=lp1;
      const x1=p1.x+sx + p1.w*lp1, x2=p2.x+sx + p2.w*lp2;
      poly(x1, p1.y, lw1, x2, p2.y, lw2, pal.lane);
    }
  }
  // start/finish checker
  if(seg.start||seg.finish){
    const n=10;
    for(let i=0;i<n;i++){
      const a=-1+2*i/n, b=-1+2*(i+1)/n;
      sctx.fillStyle=(i%2)?'#fff':'#111';
      sctx.beginPath();
      sctx.moveTo(p1.x+sx+p1.w*a,p1.y); sctx.lineTo(p1.x+sx+p1.w*b,p1.y);
      sctx.lineTo(p2.x+sx+p2.w*b,p2.y); sctx.lineTo(p2.x+sx+p2.w*a,p2.y);
      sctx.closePath(); sctx.fill();
    }
  }
  // fog overlay
  if(fogv<1){
    sctx.globalAlpha=1-fogv;
    sctx.fillStyle=pal.fog;
    sctx.fillRect(0,p2.y,W,p1.y-p2.y+1);
    sctx.globalAlpha=1;
  }
}
function poly(x1,y1,w1,x2,y2,w2,color){
  sctx.fillStyle=color;
  sctx.beginPath();
  sctx.moveTo(x1-w1,y1); sctx.lineTo(x1+w1,y1);
  sctx.lineTo(x2+w2,y2); sctx.lineTo(x2-w2,y2);
  sctx.closePath(); sctx.fill();
}

/* ----- scenery ----- */
function drawScenery(type, seg, offset, shake){
  const s=seg.p1.screen;
  if(s.scale<=0) return;
  const sx = s.x + shake + s.w*offset;
  const sy = s.y;
  const scale = s.scale;
  const size = scale * 3200;          // world height of scenery
  if(size<4) return;
  sctx.globalAlpha=U.clamp(seg.fogv,0,1);
  if(type==='tree'){
    const h=size, w=size*0.5;
    sctx.fillStyle='#5a3a1d'; sctx.fillRect(sx-w*0.08, sy-h*0.32, w*0.16, h*0.32);
    sctx.fillStyle=G.pal.sceneryColor;
    blob(sx, sy-h*0.45, w*0.5); blob(sx-w*0.3, sy-h*0.32, w*0.36); blob(sx+w*0.3, sy-h*0.32, w*0.36);
    sctx.fillStyle='#2f8f2c'; blob(sx, sy-h*0.55, w*0.34);
  } else if(type==='palm'){
    const h=size;
    sctx.strokeStyle='#7a5a2a'; sctx.lineWidth=Math.max(2,h*0.06);
    sctx.beginPath(); sctx.moveTo(sx,sy); sctx.quadraticCurveTo(sx+h*0.06,sy-h*0.5,sx-h*0.05,sy-h*0.7); sctx.stroke();
    sctx.fillStyle='#1f9e6a';
    for(let a=0;a<6;a++){ const ang=Math.PI+a*(Math.PI/5); leaf(sx-h*0.05,sy-h*0.7,h*0.4,ang); }
  } else if(type==='billboard'){
    const h=size*0.9, w=size*0.55;
    sctx.fillStyle='#0c0420'; sctx.fillRect(sx-w*0.06,sy-h,w*0.12,h);
    const col=['#ff2bd6','#19e8ff','#ffe11a'][seg.index%3];
    sctx.fillStyle=col; sctx.globalAlpha*=0.9;
    sctx.fillRect(sx-w*0.5, sy-h, w, h*0.5);
    sctx.globalAlpha=U.clamp(seg.fogv,0,1);
    sctx.strokeStyle='#fff'; sctx.lineWidth=Math.max(1,w*0.03);
    sctx.strokeRect(sx-w*0.5, sy-h, w, h*0.5);
  }
  sctx.globalAlpha=1;
}
function blob(x,y,r){ sctx.beginPath(); sctx.arc(x,y,r,0,7); sctx.fill(); }
function leaf(x,y,len,ang){
  sctx.beginPath(); sctx.moveTo(x,y);
  sctx.quadraticCurveTo(x+Math.cos(ang)*len*0.6, y+Math.sin(ang)*len*0.6 - len*0.2,
                        x+Math.cos(ang)*len, y+Math.sin(ang)*len);
  sctx.lineWidth=Math.max(2,len*0.18); sctx.strokeStyle='#1f9e6a'; sctx.stroke();
}

/* ----- karts ----- */
function drawCar(c, seg, shake){
  const s=seg.p1.screen;
  if(s.scale<=0) return;
  const sx=s.x+shake + s.w*c.offset;
  const destW = s.w*0.85;
  const destH = destW*0.82;
  const sy=s.y;
  sctx.globalAlpha=U.clamp(seg.fogv,0,1);
  drawKart(sx, sy, destW, destH, c.ch, {boost:c.boostT>0, shield:c.shieldT>0, spin:c.spinT>0, steer:0});
  sctx.globalAlpha=1;
}
function drawProjectile(p,seg,shake){
  const s=seg.p1.screen; if(s.scale<=0)return;
  const sx=s.x+shake+s.w*p.offset, sy=s.y - s.w*0.3, r=Math.max(6,s.w*0.18);
  sctx.globalAlpha=U.clamp(seg.fogv,0,1);
  sctx.font=`${r*2}px serif`; sctx.textAlign='center'; sctx.textBaseline='middle';
  sctx.fillText('🚀', sx, sy);
  sctx.globalAlpha=1;
}

// generic kart drawn with its bottom-center at (cx, by)
function drawKart(cx, by, w, h, ch, opt){
  const steer=opt.steer||0;
  sctx.save();
  sctx.translate(cx, by);
  sctx.rotate(steer*0.08);

  // shadow
  sctx.fillStyle='rgba(0,0,0,0.32)';
  sctx.beginPath(); sctx.ellipse(0,-h*0.04,w*0.52,h*0.13,0,0,7); sctx.fill();

  // boost flames (blue, like reference)
  if(opt.boost){
    const fl=h*0.9*(0.7+Math.random()*0.4);
    for(const dxo of [-w*0.26, w*0.26]){
      const g=sctx.createLinearGradient(0,-h*0.1,0,-h*0.1+fl);
      g.addColorStop(0,'#bff4ff'); g.addColorStop(0.5,'#29b6ff'); g.addColorStop(1,'rgba(40,80,255,0)');
      sctx.fillStyle=g;
      sctx.beginPath();
      sctx.moveTo(dxo-w*0.1,-h*0.1); sctx.lineTo(dxo+w*0.1,-h*0.1);
      sctx.lineTo(dxo, -h*0.1+fl); sctx.closePath(); sctx.fill();
    }
  }

  // rear wheels
  sctx.fillStyle='#16181d';
  rrect(-w*0.5, -h*0.42, w*0.18, h*0.4, 4);
  rrect( w*0.32, -h*0.42, w*0.18, h*0.4, 4);
  sctx.fillStyle='#3a3f46';
  rrect(-w*0.47,-h*0.30,w*0.12,h*0.12,3); rrect(w*0.35,-h*0.30,w*0.12,h*0.12,3);

  // body (team color), trapezoid seen from behind
  const col=ch.color, acc=ch.accent;
  const grd=sctx.createLinearGradient(0,-h*0.9,0,-h*0.1);
  grd.addColorStop(0, shade(col,30)); grd.addColorStop(1, shade(col,-25));
  sctx.fillStyle=grd;
  sctx.beginPath();
  sctx.moveTo(-w*0.40,-h*0.12);
  sctx.lineTo(-w*0.30,-h*0.66);
  sctx.quadraticCurveTo(0,-h*0.80, w*0.30,-h*0.66);
  sctx.lineTo(w*0.40,-h*0.12);
  sctx.closePath(); sctx.fill();

  // white accent stripe + emblem
  sctx.fillStyle=acc;
  sctx.beginPath();
  sctx.moveTo(-w*0.12,-h*0.66); sctx.lineTo(w*0.12,-h*0.66);
  sctx.lineTo(w*0.16,-h*0.16); sctx.lineTo(-w*0.16,-h*0.16);
  sctx.closePath(); sctx.fill();

  // spoiler
  sctx.fillStyle=shade(col,-35);
  rrect(-w*0.46,-h*0.74,w*0.92,h*0.10,4);
  sctx.fillStyle='#0e0f12';
  rrect(-w*0.40,-h*0.70,w*0.06,h*0.10,2); rrect(w*0.34,-h*0.70,w*0.06,h*0.10,2);

  // driver head (emoji)
  const fs=h*0.42;
  sctx.font=`${fs}px serif`; sctx.textAlign='center'; sctx.textBaseline='middle';
  sctx.fillText(ch.face, 0, -h*0.74);

  // shield bubble
  if(opt.shield){
    sctx.strokeStyle='rgba(120,200,255,0.9)'; sctx.lineWidth=Math.max(2,w*0.03);
    sctx.fillStyle='rgba(120,200,255,0.15)';
    sctx.beginPath(); sctx.ellipse(0,-h*0.45,w*0.62,h*0.6,0,0,7); sctx.fill(); sctx.stroke();
  }
  if(opt.spin){
    sctx.font=`${h*0.5}px serif`; sctx.fillText('💫',0,-h*1.0);
  }
  sctx.restore();
}
function rrect(x,y,w,h,r){
  sctx.beginPath();
  sctx.moveTo(x+r,y); sctx.arcTo(x+w,y,x+w,y+h,r); sctx.arcTo(x+w,y+h,x,y+h,r);
  sctx.arcTo(x,y+h,x,y,r); sctx.arcTo(x,y,x+w,y,r); sctx.closePath(); sctx.fill();
}
function shade(hex, amt){
  let c=hex.replace('#',''); if(c.length===3)c=c.split('').map(x=>x+x).join('');
  let r=parseInt(c.substr(0,2),16), g=parseInt(c.substr(2,2),16), b=parseInt(c.substr(4,2),16);
  r=U.clamp(r+amt,0,255); g=U.clamp(g+amt,0,255); b=U.clamp(b+amt,0,255);
  return `rgb(${r|0},${g|0},${b|0})`;
}

function drawPlayerKart(){
  if(G.state==='menu'||G.state==='finish') return;
  const cx=W/2 + G.steer*W*0.04;
  const by=H*0.86 + (G.speed>OFFROAD_LIMIT&&(G.playerX<-1||G.playerX>1)?Math.sin(performance.now()*0.05)*3:0);
  const w=Math.min(W,H*1.4)*0.30, h=w*0.82;
  let st=G.steer + (G.drifting?G.driftDir:0);
  drawKart(cx, by, w, h, G.me.ch, {
    boost:G.boostT>0||G.drifting, shield:G.shieldT>0, spin:G.spinT>0, steer:G.steer
  });
  // drift sparks
  if(G.drifting && G.driftCharge>0.4){
    sctx.fillStyle = G.driftCharge>0.8?'#ff8a2b':'#7fdcff';
    for(let i=0;i<6;i++){ const x=cx+U.rnd(-w*0.5,w*0.5), y=by+U.rnd(-4,8); sctx.beginPath(); sctx.arc(x,y,U.rnd(1,3),0,7); sctx.fill(); }
  }
}

/* ----- speedometer ----- */
function drawSpeedo(){
  const c=spctx, S=180; c.clearRect(0,0,S,S);
  const cx=S/2, cy=S*0.56, r=S*0.40;
  const a0=Math.PI*0.8, a1=Math.PI*2.2;
  // back ring
  c.lineWidth=12; c.lineCap='round';
  c.strokeStyle='rgba(10,16,36,0.7)';
  c.beginPath(); c.arc(cx,cy,r,a0,a1); c.stroke();
  // value arc gradient cyan->orange
  const kmh=Math.round(G.speed/MAX_SPEED*200);
  const pct=U.clamp(G.speed/(MAX_SPEED*1.0),0,1);
  const grad=c.createLinearGradient(0,0,S,0);
  grad.addColorStop(0,'#29d3ff'); grad.addColorStop(0.6,'#5dff8b'); grad.addColorStop(1,'#ff7a1a');
  c.strokeStyle=grad; c.lineWidth=12;
  c.beginPath(); c.arc(cx,cy,r,a0,a0+(a1-a0)*pct); c.stroke();
  // ticks
  c.strokeStyle='rgba(255,255,255,0.25)'; c.lineWidth=2;
  for(let i=0;i<=10;i++){ const a=a0+(a1-a0)*i/10; c.beginPath();
    c.moveTo(cx+Math.cos(a)*(r-10),cy+Math.sin(a)*(r-10));
    c.lineTo(cx+Math.cos(a)*(r-2),cy+Math.sin(a)*(r-2)); c.stroke(); }
  // number
  c.fillStyle='#fff'; c.textAlign='center'; c.textBaseline='middle';
  c.font='900 40px Segoe UI, sans-serif';
  c.fillText(kmh, cx, cy-2);
  c.font='800 13px Segoe UI, sans-serif'; c.fillStyle='#9fb0e0';
  c.fillText('KM/H', cx, cy+24);
}

/* ----- minimap ----- */
function drawMinimap(){
  const c=mctx, S=150; c.clearRect(0,0,S,S);
  const pad=18;
  const bw=mapBox.maxx-mapBox.minx||1, bh=mapBox.maxy-mapBox.miny||1;
  const sc=Math.min((S-pad*2)/bw,(S-pad*2)/bh);
  const ox=(S-bw*sc)/2 - mapBox.minx*sc, oy=(S-bh*sc)/2 - mapBox.miny*sc;
  const tx=p=>p.x*sc+ox, ty=p=>p.y*sc+oy;
  // path
  c.strokeStyle='rgba(255,255,255,0.85)'; c.lineWidth=4; c.lineJoin='round';
  c.beginPath();
  for(let i=0;i<mapPath.length;i+=2){ const p=mapPath[i]; if(i===0)c.moveTo(tx(p),ty(p)); else c.lineTo(tx(p),ty(p)); }
  c.closePath(); c.stroke();
  c.strokeStyle='rgba(40,50,90,0.9)'; c.lineWidth=2; c.stroke();
  // dots
  for(const car of G.cars){
    const seg=findSegment(car.z); const p=mapPath[seg.index]||mapPath[0];
    c.fillStyle=car.isPlayer?'#ffd200':car.ch.color;
    c.beginPath(); c.arc(tx(p),ty(p),car.isPlayer?5:3.5,0,7); c.fill();
    if(car.isPlayer){ c.strokeStyle='#000'; c.lineWidth=1.5; c.stroke(); }
  }
}

/* ============================================================
                       MAIN LOOP
   ============================================================ */
let lastTime=performance.now();
function loop(now){
  let dt=(now-lastTime)/1000; lastTime=now;
  if(dt>0.05)dt=0.05;            // clamp
  if(G.state==='race'||G.state==='countdown') update(dt);
  render();
  // keep menu kart preview? no
  requestAnimationFrame(loop);
}

/* boot */
buildMenu();
G.pal=PALETTES[COURSES[0].palette];
buildTrack(0);        // so menu background can render a track preview
G.position=0;
requestAnimationFrame(loop);

})();
