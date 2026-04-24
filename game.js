// ============================================
//  NEXUS MAZE — Cyberpunk Labyrinth Engine
//  Complete rewrite with enhanced mechanics
// ============================================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ─── CONFIG ──────────────────────────────────
const BASE_ROWS = 15;
const BASE_COLS = 15;
let rows = BASE_ROWS, cols = BASE_COLS;
let size = 28;
let playerRadius, enemyRadius;

// ─── STATE ───────────────────────────────────
let maze = null;
let keys = {};
let player, endCell, enemies = [], powerups = [];
let particles = [];
let playerTrail = [];
let running = false;

// Level & score
let currentLevel = 1;
let score = 0;
let lives = 3;
let timerSeconds = 0;
let timerInterval = null;

// Shield
let shieldCharge = 1.0;       // 0..1
let shieldActive = false;
let shieldCooldown = false;
let shieldCooldownTimer = 0;
const SHIELD_MAX_DURATION = 3.0;
const SHIELD_COOLDOWN = 5.0;
let shieldRemaining = 0;

// Power-up effects
let speedBoost = 0;
let freezeEnemies = 0;
let fogOfWar = false;
let fogRadius = 0;

// Touch
let touchActive = false;
let touchDx = 0, touchDy = 0;
const touchpad = document.getElementById('touchpad');

// Delta time
let lastTime = 0;
let animFrame;

// Fog revealed cells
let revealedCells = null;

// Audio context
let audioCtx = null;

// Highscores
let bestTimeSeconds = Infinity;
let savedMaxLevel = 1;
loadRecords();

// ─── AUDIO ───────────────────────────────────
function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return null; }
  }
  return audioCtx;
}

function playTone(freq, type='sine', duration=0.1, vol=0.15, delay=0) {
  const ac = getAudio(); if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain); gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
  gain.gain.setValueAtTime(0, ac.currentTime + delay);
  gain.gain.linearRampToValueAtTime(vol, ac.currentTime + delay + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + delay + duration);
  osc.start(ac.currentTime + delay);
  osc.stop(ac.currentTime + delay + duration + 0.05);
}

function sfxCollect() {
  playTone(600, 'sine', 0.08, 0.12);
  playTone(900, 'sine', 0.08, 0.12, 0.07);
}
function sfxShieldHit() {
  playTone(200, 'sawtooth', 0.15, 0.18);
  playTone(150, 'square', 0.1, 0.12, 0.1);
}
function sfxWin() {
  [523, 659, 784, 1047].forEach((f,i) => playTone(f,'sine',0.2,0.15,i*0.1));
}
function sfxDeath() {
  playTone(300, 'sawtooth', 0.1, 0.2);
  playTone(200, 'sawtooth', 0.15, 0.2, 0.1);
  playTone(100, 'square', 0.25, 0.2, 0.2);
}
function sfxMove() { /* subtle click */ }
function sfxShieldOn() {
  playTone(440, 'sine', 0.08, 0.1);
  playTone(880, 'sine', 0.08, 0.08, 0.06);
}

// ─── RESPONSIVE ──────────────────────────────
function resizeCanvas() {
  const hud = document.getElementById('hud');
  const tc = document.getElementById('touchControls');
  const hudH = hud ? hud.offsetHeight : 48;
  const tcH = (window.innerWidth < 768 && tc) ? tc.offsetHeight : 0;
  const maxW = window.innerWidth - 4;
  const maxH = window.innerHeight - hudH - tcH - 4;
  size = Math.floor(Math.min(maxW / cols, maxH / rows));
  size = Math.max(12, Math.min(size, 36));
  canvas.width = size * cols;
  canvas.height = size * rows;
  playerRadius = Math.max(3, Math.floor(size * 0.22));
  enemyRadius = Math.max(3, Math.floor(size * 0.22));
  if (fogRadius === 0 && fogOfWar) fogRadius = size * 3.5;
}
window.addEventListener('resize', () => { resizeCanvas(); });

// ─── INPUT ───────────────────────────────────
document.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') { e.preventDefault(); activateShield(); }
  if (['arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
});
document.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// ─── TOUCH CONTROLS ──────────────────────────
function updateTouchDirection(clientX, clientY) {
  const rect = touchpad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx, dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  const maxR = rect.width / 2 - 14;
  const clamped = Math.min(dist, maxR);
  const angle = Math.atan2(dy, dx);
  const ix = Math.cos(angle) * clamped;
  const iy = Math.sin(angle) * clamped;
  document.getElementById('touchIndicator').style.transform =
    `translate(calc(-50% + ${ix}px), calc(-50% + ${iy}px))`;
  if (dist > 8) {
    const spd = 130;
    touchDx = Math.cos(angle) * spd;
    touchDy = Math.sin(angle) * spd;
  } else { touchDx = 0; touchDy = 0; }
}
touchpad.addEventListener('touchstart', e => { e.preventDefault(); touchActive = true; updateTouchDirection(e.touches[0].clientX, e.touches[0].clientY); });
touchpad.addEventListener('touchmove', e => { e.preventDefault(); if(touchActive) updateTouchDirection(e.touches[0].clientX, e.touches[0].clientY); });
touchpad.addEventListener('touchend', e => {
  e.preventDefault(); touchActive = false; touchDx = 0; touchDy = 0;
  document.getElementById('touchIndicator').style.transform = 'translate(-50%, -50%)';
});

// ─── MAZE GENERATION (DFS) ───────────────────
function generateMaze(r, c) {
  let grid = Array.from({length:r}, () =>
    Array.from({length:c}, () => ({ visited:false, walls:[true,true,true,true] }))
  );
  const shuffle = a => a.sort(()=>Math.random()-0.5);
  function carve(row, col) {
    grid[row][col].visited = true;
    for (let [dr,dc,w] of shuffle([[-1,0,0],[0,1,1],[1,0,2],[0,-1,3]])) {
      const nr=row+dr, nc=col+dc;
      if(nr>=0&&nr<r&&nc>=0&&nc<c&&!grid[nr][nc].visited) {
        grid[row][col].walls[w]=false;
        grid[nr][nc].walls[(w+2)%4]=false;
        carve(nr,nc);
      }
    }
  }
  carve(0,0);
  return grid;
}

// ─── BFS PATHFINDING for enemies ─────────────
function bfsPath(maze, startX, startY, endX, endY, r, c) {
  if (startX===endX && startY===endY) return [];
  const visited = Array.from({length:r}, ()=>new Array(c).fill(false));
  const parent = Array.from({length:r}, ()=>new Array(c).fill(null));
  const queue = [{x:startX,y:startY}];
  visited[startY][startX] = true;
  const dirs = [
    {dx:0,dy:-1,wall:0},{dx:1,dy:0,wall:1},
    {dx:0,dy:1,wall:2},{dx:-1,dy:0,wall:3}
  ];
  while(queue.length) {
    const {x,y} = queue.shift();
    if(x===endX && y===endY) {
      // reconstruct path
      const path=[];
      let cx=endX,cy=endY;
      while(!(cx===startX&&cy===startY)) {
        path.unshift({x:cx,y:cy});
        const p=parent[cy][cx];
        cx=p.x; cy=p.y;
      }
      return path;
    }
    for(const {dx,dy,wall} of dirs) {
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=c||ny>=r) continue;
      if(maze[y][x].walls[wall]) continue;
      if(visited[ny][nx]) continue;
      visited[ny][nx]=true;
      parent[ny][nx]={x,y};
      queue.push({x:nx,y:ny});
    }
  }
  return [];
}

// ─── COLLISION ───────────────────────────────
function isColliding(x, y, radius) {
  if (!maze) return true;
  const c = Math.floor(x / size), r = Math.floor(y / size);
  if (c<0||r<0||c>=cols||r>=rows) return true;
  const cell = maze[r][c];
  const ox=x-c*size, oy=y-r*size;

  if(cell.walls[0]&&oy-radius<0) return true;
  if(cell.walls[2]&&oy+radius>size) return true;
  if(cell.walls[3]&&ox-radius<0) return true;
  if(cell.walls[1]&&ox+radius>size) return true;
  if(oy-radius<0&&r>0&&maze[r-1][c].walls[2]) return true;
  if(oy+radius>size&&r<rows-1&&maze[r+1][c].walls[0]) return true;
  if(ox-radius<0&&c>0&&maze[r][c-1].walls[1]) return true;
  if(ox+radius>size&&c<cols-1&&maze[r][c+1].walls[3]) return true;

  const ch = Math.max(1,Math.floor(size*0.08));
  const thresh = (radius+ch)**2;
  const chk = (cx,cy,blocked) => { if(!blocked)return false; const d=x-cx,e=y-cy; return d*d+e*e<thresh; };
  const tw=cell.walls[0]||(r>0&&maze[r-1][c].walls[2]);
  const bw=cell.walls[2]||(r<rows-1&&maze[r+1][c].walls[0]);
  const lw=cell.walls[3]||(c>0&&maze[r][c-1].walls[1]);
  const rw=cell.walls[1]||(c<cols-1&&maze[r][c+1].walls[3]);
  if(chk(c*size,r*size,tw&&lw)) return true;
  if(chk((c+1)*size,r*size,tw&&rw)) return true;
  if(chk(c*size,(r+1)*size,bw&&lw)) return true;
  if(chk((c+1)*size,(r+1)*size,bw&&rw)) return true;
  return false;
}

function moveEntity(entity, dx, dy, delta, radius) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))*delta/4));
  const sx = dx*delta/steps, sy = dy*delta/steps;
  for(let i=0;i<steps;i++) {
    const nx=entity.x+sx, ny=entity.y+sy;
    if(!isColliding(nx,ny,radius)) { entity.x=nx; entity.y=ny; }
    else {
      if(!isColliding(nx,entity.y,radius)) entity.x=nx;
      if(!isColliding(entity.x,ny,radius)) entity.y=ny;
    }
  }
}

// ─── PARTICLES ───────────────────────────────
function spawnParticles(x,y,color,count=8,speed=80,life=0.6) {
  for(let i=0;i<count;i++) {
    const angle = Math.random()*Math.PI*2;
    const spd = speed*(0.4+Math.random()*0.6);
    particles.push({
      x,y,
      vx: Math.cos(angle)*spd,
      vy: Math.sin(angle)*spd,
      life, maxLife:life,
      color,
      size: 2+Math.random()*3
    });
  }
}

function updateParticles(delta) {
  for(let i=particles.length-1;i>=0;i--) {
    const p=particles[i];
    p.x+=p.vx*delta; p.y+=p.vy*delta;
    p.vx*=0.92; p.vy*=0.92;
    p.life-=delta;
    if(p.life<=0) particles.splice(i,1);
  }
}

function drawParticles() {
  particles.forEach(p=>{
    const alpha=(p.life/p.maxLife);
    ctx.globalAlpha=alpha;
    ctx.fillStyle=p.color;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.size*alpha,0,Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha=1;
}

// ─── TRAIL ───────────────────────────────────
function updateTrail() {
  playerTrail.unshift({x:player.x,y:player.y,life:1});
  if(playerTrail.length>18) playerTrail.pop();
  for(const t of playerTrail) t.life-=0.06;
}

function drawTrail() {
  playerTrail.forEach((t,i)=>{
    const a = Math.max(0,t.life)*0.35;
    ctx.globalAlpha=a;
    ctx.fillStyle='#00f5ff';
    const r=playerRadius*(0.2+0.5*(1-i/playerTrail.length));
    ctx.beginPath();
    ctx.arc(t.x,t.y,r,0,Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha=1;
}

// ─── FOG OF WAR ──────────────────────────────
function revealAround(px,py) {
  if (!fogOfWar || !revealedCells) return;
  const pc=Math.floor(px/size), pr=Math.floor(py/size);
  const range=4;
  for(let r=pr-range;r<=pr+range;r++) {
    for(let c=pc-range;c<=pc+range;c++) {
      if(r>=0&&r<rows&&c>=0&&c<cols) {
        if(Math.hypot(c-pc,r-pr)<=range) revealedCells[r][c]=true;
      }
    }
  }
}

// ─── POWER-UPS ───────────────────────────────
const POWERUP_TYPES = [
  { id:'speed',  color:'#ffe600', glyph:'⚡', label:'SPEED BOOST',   duration:5 },
  { id:'freeze', color:'#00aaff', glyph:'❄',  label:'FREEZE ENEMIES',duration:4 },
  { id:'shield', color:'#00f5ff', glyph:'🛡', label:'SHIELD RESTORE',duration:0 },
];

function spawnPowerups() {
  powerups = [];
  const count = 1 + Math.floor(currentLevel/3);
  const used = new Set();
  for(let i=0;i<count;i++) {
    let cx,cy,key;
    do { cx=Math.floor(Math.random()*cols); cy=Math.floor(Math.random()*rows); key=cy*cols+cx; }
    while(used.has(key)||(cx<2&&cy<2)||(cx>=cols-2&&cy>=rows-2));
    used.add(key);
    const type=POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
    powerups.push({
      cx,cy,
      x:(cx+0.5)*size, y:(cy+0.5)*size,
      type, collected:false,
      pulse:Math.random()*Math.PI*2
    });
  }
}

function showToast(msg) {
  const toast=document.getElementById('powerupToast');
  toast.textContent=msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer=setTimeout(()=>toast.classList.remove('show'),1800);
}

// ─── HUD UPDATE ──────────────────────────────
function updateHUD() {
  document.getElementById('levelDisplay').textContent = String(currentLevel).padStart(2,'0');
  document.getElementById('scoreDisplay').textContent = String(score).padStart(5,'0');
  const mins=Math.floor(timerSeconds/60);
  const secs=timerSeconds%60;
  document.getElementById('timer').textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

  // Lives
  const lc=document.getElementById('livesDisplay');
  lc.innerHTML='';
  for(let i=0;i<3;i++) {
    const d=document.createElement('div');
    d.className='life-icon'+(i>=lives?' lost':'');
    lc.appendChild(d);
  }

  // Shield bar
  const sb=document.getElementById('shieldBar');
  if(shieldCooldown) {
    sb.style.background='rgba(255,0,100,0.6)';
    sb.style.width=(1-shieldCooldownTimer/SHIELD_COOLDOWN)*100+'%';
  } else if(shieldActive) {
    sb.style.background='#00f5ff';
    sb.style.width=(shieldRemaining/SHIELD_MAX_DURATION)*100+'%';
  } else {
    sb.style.background='#00f5ff';
    sb.style.width='100%';
  }
}

// ─── SHIELD ACTIVATE ─────────────────────────
function activateShield() {
  if (!running||shieldActive||shieldCooldown) return;
  shieldActive=true;
  shieldRemaining=SHIELD_MAX_DURATION;
  sfxShieldOn();
  spawnParticles(player.x,player.y,'#00f5ff',12,60,0.5);
}

// ─── UPDATE ──────────────────────────────────
function update(delta) {
  if(!running||!maze) return;
  delta = Math.min(delta, 0.1); // cap delta

  // Player movement
  let dx=0,dy=0;
  const baseSpeed = 110 + (currentLevel-1)*3;
  const speed = speedBoost>0 ? baseSpeed*1.7 : baseSpeed;

  if(keys["arrowup"]||keys["w"]) dy-=speed;
  if(keys["arrowdown"]||keys["s"]) dy+=speed;
  if(keys["arrowleft"]||keys["a"]) dx-=speed;
  if(keys["arrowright"]||keys["d"]) dx+=speed;
  dx+=touchDx; dy+=touchDy;

  const wasAt={x:player.x,y:player.y};
  moveEntity(player,dx,dy,delta,playerRadius);
  const moved=Math.hypot(player.x-wasAt.x,player.y-wasAt.y)>0.5;
  if(moved) updateTrail();

  // Reveal fog
  revealAround(player.x,player.y);

  // Shield
  if(shieldActive) {
    shieldRemaining-=delta;
    if(shieldRemaining<=0) {
      shieldActive=false;
      shieldCooldown=true;
      shieldCooldownTimer=SHIELD_COOLDOWN;
    }
  }
  if(shieldCooldown) {
    shieldCooldownTimer-=delta;
    if(shieldCooldownTimer<=0) {
      shieldCooldown=false;
      shieldCooldownTimer=0;
    }
  }

  // Speed / freeze timers
  if(speedBoost>0) speedBoost-=delta;
  if(freezeEnemies>0) freezeEnemies-=delta;

  // Powerup pulse & collect
  powerups.forEach(p=>{ p.pulse+=delta*3; });
  for(let i=powerups.length-1;i>=0;i--) {
    const p=powerups[i];
    if(p.collected) continue;
    if(Math.hypot(player.x-p.x,player.y-p.y)<playerRadius+10) {
      p.collected=true;
      sfxCollect();
      score+=200;
      spawnParticles(p.x,p.y,p.type.color,16,100,0.7);
      showToast(p.type.glyph+' '+p.type.label);
      if(p.type.id==='speed') speedBoost=p.type.duration;
      else if(p.type.id==='freeze') freezeEnemies=p.type.duration;
      else if(p.type.id==='shield') { shieldActive=false; shieldCooldown=false; shieldCooldownTimer=0; shieldRemaining=SHIELD_MAX_DURATION; }
    }
  }

  // Enemies
  const enemySpeed = Math.min(50+currentLevel*8, 130);
  enemies.forEach(e=>{
    if(freezeEnemies>0) return;

    if(!e.path||e.path.length===0||e.pathTimer<=0) {
      // Recalc path every ~1.5s or when done
      const pc=Math.floor(player.x/size), pr=Math.floor(player.y/size);
      const ec=Math.floor(e.x/size), er=Math.floor(e.y/size);
      if(e.smart) {
        e.path=bfsPath(maze,ec,er,pc,pr,rows,cols);
      } else {
        // Dumb: random neighbor
        const nb=getNeighbors(maze,ec,er);
        e.path=nb.length?[{x:nb[Math.floor(Math.random()*nb.length)].x,y:nb[Math.floor(Math.random()*nb.length)].y}]:[];
      }
      e.pathTimer=0.8+Math.random()*0.8;
    }
    e.pathTimer-=delta;

    if(e.path&&e.path.length>0) {
      const next=e.path[0];
      const tx=(next.x+0.5)*size, ty=(next.y+0.5)*size;
      const ddx=tx-e.x, ddy=ty-e.y;
      const dist=Math.hypot(ddx,ddy);
      if(dist<2) {
        e.x=tx; e.y=ty;
        e.path.shift();
      } else {
        const mvx=ddx/dist*enemySpeed, mvy=ddy/dist*enemySpeed;
        moveEntity(e,mvx,mvy,delta,enemyRadius);
      }
    }

    // Spawn particles when near player
    if(Math.hypot(player.x-e.x,player.y-e.y)<size*1.5) {
      if(Math.random()<0.05) spawnParticles(e.x,e.y,'#ff2244',2,30,0.3);
    }

    // Collision
    if(Math.hypot(player.x-e.x,player.y-e.y)<playerRadius+enemyRadius) {
      if(shieldActive) {
        sfxShieldHit();
        shieldActive=false;
        shieldCooldown=true;
        shieldCooldownTimer=SHIELD_COOLDOWN;
        shieldRemaining=0;
        spawnParticles(player.x,player.y,'#00f5ff',20,120,0.6);
        // Push enemy away
        const ang=Math.atan2(e.y-player.y,e.x-player.x);
        e.x+=Math.cos(ang)*size*0.8;
        e.y+=Math.sin(ang)*size*0.8;
        e.path=[];
        score+=50;
      } else {
        handleDeath();
      }
    }
  });

  updateParticles(delta);
  checkWin();
  updateHUD();
}

function handleDeath() {
  sfxDeath();
  spawnParticles(player.x,player.y,'#ff2244',30,140,0.8);
  lives--;
  if(lives<=0) {
    running=false;
    clearInterval(timerInterval);
    setTimeout(()=>triggerGameOver(),600);
  } else {
    // Respawn
    player.x=size/2; player.y=size/2;
    playerTrail=[];
    spawnParticles(player.x,player.y,'#ff6600',20,100,0.6);
  }
}

// ─── NEIGHBOR HELPER ─────────────────────────
function getNeighbors(mz,cx,cy) {
  const cell=mz[cy][cx], n=[];
  if(!cell.walls[0]&&cy>0) n.push({x:cx,y:cy-1});
  if(!cell.walls[1]&&cx<cols-1) n.push({x:cx+1,y:cy});
  if(!cell.walls[2]&&cy<rows-1) n.push({x:cx,y:cy+1});
  if(!cell.walls[3]&&cx>0) n.push({x:cx-1,y:cy});
  return n;
}

// ─── DRAW ────────────────────────────────────
// Color palettes per level group
function getLevelColors() {
  const palettes=[
    {wall:'#00f5ff',bg:'#000d14',end:'#00ff88',endGlow:'#00ff88'},
    {wall:'#ff00aa',bg:'#14000e',end:'#ffe600',endGlow:'#ffe600'},
    {wall:'#ffe600',bg:'#141000',end:'#00f5ff',endGlow:'#00f5ff'},
    {wall:'#00ff88',bg:'#001410',end:'#ff00aa',endGlow:'#ff00aa'},
  ];
  return palettes[(currentLevel-1)%palettes.length];
}

function drawMaze(colors) {
  ctx.strokeStyle=colors.wall;
  ctx.lineWidth=1.5;
  // Glow on walls
  ctx.shadowColor=colors.wall;
  ctx.shadowBlur=3;

  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      // Fog of war
      if(fogOfWar&&revealedCells&&!revealedCells[r][c]) continue;
      const cell=maze[r][c];
      const x=c*size, y=r*size;
      ctx.beginPath();
      if(cell.walls[0]){ctx.moveTo(x,y);ctx.lineTo(x+size,y);}
      if(cell.walls[1]){ctx.moveTo(x+size,y);ctx.lineTo(x+size,y+size);}
      if(cell.walls[2]){ctx.moveTo(x,y+size);ctx.lineTo(x+size,y+size);}
      if(cell.walls[3]){ctx.moveTo(x,y);ctx.lineTo(x,y+size);}
      ctx.stroke();
    }
  }
  ctx.shadowBlur=0;
}

function drawEnd(colors) {
  const ex=endCell.x*size+size/2, ey=endCell.y*size+size/2;
  const t=Date.now()/1000;
  const pulse=Math.sin(t*3)*0.2+0.8;
  const outerR=size*0.4*pulse;

  ctx.shadowColor=colors.endGlow;
  ctx.shadowBlur=20*pulse;

  // Outer ring
  ctx.strokeStyle=colors.end;
  ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.arc(ex,ey,outerR,0,Math.PI*2);
  ctx.stroke();

  // Inner fill
  ctx.fillStyle=colors.end;
  ctx.globalAlpha=0.3*pulse;
  ctx.beginPath();
  ctx.arc(ex,ey,outerR*0.6,0,Math.PI*2);
  ctx.fill();
  ctx.globalAlpha=1;

  // Diamond
  ctx.fillStyle=colors.end;
  ctx.beginPath();
  const s=size*0.18;
  ctx.moveTo(ex,ey-s);ctx.lineTo(ex+s,ey);ctx.lineTo(ex,ey+s);ctx.lineTo(ex-s,ey);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur=0;
}

function drawPlayer() {
  drawTrail();
  const t=Date.now()/1000;

  // Shield ring
  if(shieldActive) {
    const alpha=0.6+Math.sin(t*8)*0.2;
    ctx.globalAlpha=alpha;
    ctx.strokeStyle='#00f5ff';
    ctx.lineWidth=2;
    ctx.shadowColor='#00f5ff';
    ctx.shadowBlur=15;
    ctx.beginPath();
    ctx.arc(player.x,player.y,playerRadius+7,0,Math.PI*2);
    ctx.stroke();
    ctx.shadowBlur=0;
    ctx.globalAlpha=1;
  }

  // Player body
  const grad=ctx.createRadialGradient(player.x-2,player.y-2,0,player.x,player.y,playerRadius);
  grad.addColorStop(0,'#ff6688');
  grad.addColorStop(1,'#cc0033');
  ctx.shadowColor='#ff2244';
  ctx.shadowBlur=12;
  ctx.fillStyle=grad;
  ctx.beginPath();
  ctx.arc(player.x,player.y,playerRadius,0,Math.PI*2);
  ctx.fill();
  ctx.shadowBlur=0;

  // Speed boost aura
  if(speedBoost>0) {
    ctx.globalAlpha=0.5+Math.sin(t*10)*0.2;
    ctx.strokeStyle='#ffe600';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(player.x,player.y,playerRadius+4,0,Math.PI*2);
    ctx.stroke();
    ctx.globalAlpha=1;
  }
}

function drawEnemies() {
  const t=Date.now()/1000;
  enemies.forEach((e,i)=>{
    const frozen=freezeEnemies>0;
    const color=frozen?'#00aaff':(e.smart?'#ffaa00':'#ff4400');
    const glowColor=frozen?'#00aaff':(e.smart?'#ff6600':'#ff2200');

    ctx.shadowColor=glowColor;
    ctx.shadowBlur=frozen?8:12;

    const pulse=Math.sin(t*4+i)*0.15+0.85;
    const grad=ctx.createRadialGradient(e.x-1,e.y-2,0,e.x,e.y,enemyRadius);
    grad.addColorStop(0,frozen?'#44ccff':e.smart?'#ffdd44':'#ff8866');
    grad.addColorStop(1,color);
    ctx.fillStyle=grad;
    ctx.beginPath();
    ctx.arc(e.x,e.y,enemyRadius*pulse,0,Math.PI*2);
    ctx.fill();

    // Eye
    ctx.shadowBlur=0;
    ctx.fillStyle='white';
    ctx.beginPath();
    const eyeX=e.x+(player.x-e.x>0?2:-2);
    const eyeY=e.y+(player.y-e.y>0?2:-2)*0.5;
    ctx.arc(eyeX,eyeY,1.5,0,Math.PI*2);
    ctx.fill();

    // Smart enemy crown
    if(e.smart&&!frozen) {
      ctx.strokeStyle='#ffdd00';
      ctx.lineWidth=1;
      ctx.shadowColor='#ffdd00';
      ctx.shadowBlur=4;
      ctx.beginPath();
      ctx.arc(e.x,e.y,enemyRadius+3,Math.PI+0.3,Math.PI*2-0.3);
      ctx.stroke();
      ctx.shadowBlur=0;
    }
  });
  ctx.shadowBlur=0;
}

function drawPowerups() {
  const t=Date.now()/1000;
  powerups.forEach(p=>{
    if(p.collected) return;
    // fog check
    if(fogOfWar&&revealedCells&&!revealedCells[p.cy][p.cx]) return;

    const pulse=Math.sin(p.pulse)*0.25+0.75;
    const r=size*0.28*pulse;
    const x=p.x, y=p.y;

    ctx.shadowColor=p.type.color;
    ctx.shadowBlur=16*pulse;
    ctx.strokeStyle=p.type.color;
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.arc(x,y,r*1.3,0,Math.PI*2);
    ctx.stroke();

    ctx.fillStyle=p.type.color+'44';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.shadowBlur=0;
    ctx.fillStyle='white';
    ctx.font=`${Math.floor(r*1.2)}px Arial`;
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(p.type.glyph,x,y+1);
  });
  ctx.shadowBlur=0;
}

function drawFog(colors) {
  if(!fogOfWar||!revealedCells) return;
  for(let r=0;r<rows;r++) {
    for(let c=0;c<cols;c++) {
      if(!revealedCells[r][c]) {
        ctx.fillStyle=colors.bg+'ee';
        ctx.fillRect(c*size,r*size,size,size);
      }
    }
  }
}

function draw() {
  const colors=getLevelColors();
  ctx.fillStyle=colors.bg;
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if(!maze) return;

  // Grid dots
  ctx.fillStyle='rgba(255,255,255,0.04)';
  for(let r=0;r<=rows;r++) for(let c=0;c<=cols;c++) {
    ctx.fillRect(c*size-0.5,r*size-0.5,1,1);
  }

  drawMaze(colors);
  drawEnd(colors);
  drawPowerups();
  drawTrail();
  drawPlayer();
  drawEnemies();
  drawParticles();
  drawFog(colors);
}

// ─── LOOP ────────────────────────────────────
function loop(t) {
  const delta=(t-lastTime)/1000;
  lastTime=t;
  update(delta);
  draw();
  animFrame=requestAnimationFrame(loop);
}

// ─── LEVEL CONFIG ────────────────────────────
function getLevelConfig(lvl) {
  const mazeSize = Math.min(BASE_ROWS+Math.floor(lvl/2)*2, 33);
  const enemyCount = Math.min(2+Math.floor(lvl*0.8), 10);
  const smartEnemies = Math.floor(lvl*0.4);
  const hasFog = lvl>=5;
  return { mazeSize, enemyCount, smartEnemies, hasFog };
}

// ─── START GAME ──────────────────────────────
function startGame() {
  currentLevel=1;
  score=0;
  lives=3;
  timerSeconds=0;
  initLevel();
}

function nextLevel() {
  currentLevel++;
  score+=Math.max(0, 1000 - timerSeconds*5);
  initLevel();
}

function initLevel() {
  // Resume audio context
  getAudio();
  if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();

  const cfg=getLevelConfig(currentLevel);
  rows=cfg.mazeSize; cols=cfg.mazeSize;
  fogOfWar=cfg.hasFog;

  resizeCanvas();

  maze=generateMaze(rows,cols);
  player={x:size/2,y:size/2};
  endCell={x:cols-1,y:rows-1};
  playerTrail=[];
  particles=[];

  // Revealed cells for fog
  revealedCells=fogOfWar
    ? Array.from({length:rows},()=>new Array(cols).fill(false))
    : null;
  revealAround(player.x,player.y);

  // Shield
  shieldActive=false;
  shieldCooldown=false;
  shieldCooldownTimer=0;
  shieldRemaining=0;
  speedBoost=0;
  freezeEnemies=0;

  // Enemies
  enemies=[];
  for(let i=0;i<cfg.enemyCount;i++) {
    let cx,cy;
    do {
      cx=Math.floor(Math.random()*cols);
      cy=Math.floor(Math.random()*rows);
    } while(cx<3&&cy<3); // not near start
    const smart=i<cfg.smartEnemies;
    enemies.push({cx,cy,x:(cx+0.5)*size,y:(cy+0.5)*size,path:[],pathTimer:0,smart});
  }

  spawnPowerups();

  // Timer
  clearInterval(timerInterval);
  if(currentLevel===1) timerSeconds=0;
  timerInterval=setInterval(()=>{ timerSeconds++; }, 1000);

  // Show game screen
  document.getElementById('menu').classList.remove('active');
  document.getElementById('victory').classList.remove('active');
  document.getElementById('gameover').classList.remove('active');
  document.getElementById('game').classList.add('active');

  running=true;
  updateHUD();
}

// ─── WIN / LOSE ──────────────────────────────
function checkWin() {
  const ex=(endCell.x+0.5)*size, ey=(endCell.y+0.5)*size;
  if(Math.hypot(player.x-ex,player.y-ey)<playerRadius+8) {
    running=false;
    clearInterval(timerInterval);
    sfxWin();
    spawnParticles(player.x,player.y,'#00ff88',30,150,1);

    // Bonus
    const bonus=Math.max(0,1000-timerSeconds*5);
    score+=bonus+currentLevel*100;

    const mins=Math.floor(timerSeconds/60);
    const secs=timerSeconds%60;
    const timeStr=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

    // Check record
    let isRecord=false;
    if(timerSeconds<bestTimeSeconds) { bestTimeSeconds=timerSeconds; isRecord=true; }
    if(currentLevel>savedMaxLevel) savedMaxLevel=currentLevel;
    saveRecords();

    document.getElementById('finalTime').textContent=timeStr;
    document.getElementById('finalScore').textContent=String(score).padStart(5,'0');
    document.getElementById('finalLevel').textContent=String(currentLevel).padStart(2,'0');
    document.getElementById('newRecord').classList.toggle('hidden',!isRecord);

    setTimeout(()=>{
      document.getElementById('game').classList.remove('active');
      document.getElementById('victory').classList.add('active');
    }, 800);
  }
}

function triggerGameOver() {
  document.getElementById('goLevel').textContent=String(currentLevel).padStart(2,'0');
  document.getElementById('goScore').textContent=String(score).padStart(5,'0');
  document.getElementById('game').classList.remove('active');
  document.getElementById('gameover').classList.add('active');
}

function goMenu() {
  running=false;
  clearInterval(timerInterval);
  cancelAnimationFrame(animFrame);
  maze=null;
  document.getElementById('game').classList.remove('active');
  document.getElementById('victory').classList.remove('active');
  document.getElementById('gameover').classList.remove('active');
  document.getElementById('menu').classList.add('active');
  updateMenuStats();
  startMenuAnimation();
}

// ─── RECORDS ─────────────────────────────────
function saveRecords() {
  try {
    localStorage.setItem('nexus_best', bestTimeSeconds===Infinity?'':bestTimeSeconds);
    localStorage.setItem('nexus_lvl', savedMaxLevel);
  } catch(e){}
}
function loadRecords() {
  try {
    const b=localStorage.getItem('nexus_best');
    bestTimeSeconds=b&&b!==''?parseInt(b):Infinity;
    savedMaxLevel=parseInt(localStorage.getItem('nexus_lvl')||'1');
  } catch(e){}
}
function updateMenuStats() {
  if(bestTimeSeconds!==Infinity) {
    const m=Math.floor(bestTimeSeconds/60), s=bestTimeSeconds%60;
    document.getElementById('bestTime').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  document.getElementById('maxLevel').textContent=String(savedMaxLevel).padStart(2,'0');
}

// ─── MENU BACKGROUND ANIMATION ───────────────
let bgAnimFrame;
function startMenuAnimation() {
  const bgCanvas=document.getElementById('bgCanvas');
  if(!bgCanvas) return;
  const bgCtx=bgCanvas.getContext('2d');
  cancelAnimationFrame(bgAnimFrame);

  const nodes=[];
  function resizeBg() {
    bgCanvas.width=window.innerWidth;
    bgCanvas.height=window.innerHeight;
  }
  resizeBg();
  window.addEventListener('resize',resizeBg);

  // Floating nodes
  for(let i=0;i<60;i++) nodes.push({
    x:Math.random()*bgCanvas.width,
    y:Math.random()*bgCanvas.height,
    vx:(Math.random()-0.5)*15,
    vy:(Math.random()-0.5)*15,
    r:Math.random()*2+0.5,
    color:Math.random()<0.5?'#00f5ff':'#ff00aa'
  });

  function animBg(t) {
    bgAnimFrame=requestAnimationFrame(animBg);
    bgCtx.fillStyle='rgba(5,8,16,0.12)';
    bgCtx.fillRect(0,0,bgCanvas.width,bgCanvas.height);

    nodes.forEach(n=>{
      n.x+=n.vx*(1/60); n.y+=n.vy*(1/60);
      if(n.x<0||n.x>bgCanvas.width) n.vx*=-1;
      if(n.y<0||n.y>bgCanvas.height) n.vy*=-1;
    });

    // Draw connections
    bgCtx.lineWidth=0.4;
    for(let i=0;i<nodes.length;i++) {
      for(let j=i+1;j<nodes.length;j++) {
        const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y);
        if(d<120) {
          bgCtx.globalAlpha=(1-d/120)*0.25;
          bgCtx.strokeStyle=nodes[i].color;
          bgCtx.beginPath();
          bgCtx.moveTo(nodes[i].x,nodes[i].y);
          bgCtx.lineTo(nodes[j].x,nodes[j].y);
          bgCtx.stroke();
        }
      }
    }

    nodes.forEach(n=>{
      bgCtx.globalAlpha=0.8;
      bgCtx.fillStyle=n.color;
      bgCtx.shadowColor=n.color;
      bgCtx.shadowBlur=8;
      bgCtx.beginPath();
      bgCtx.arc(n.x,n.y,n.r,0,Math.PI*2);
      bgCtx.fill();
    });
    bgCtx.globalAlpha=1;
    bgCtx.shadowBlur=0;
  }
  animBg(0);
}

// ─── INIT ────────────────────────────────────
updateMenuStats();
startMenuAnimation();
lastTime=performance.now();
requestAnimationFrame(t=>{
  lastTime=t;
  animFrame=requestAnimationFrame(loop);
});
