// ============================================
//  NEXUS MAZE — Cyberpunk Labyrinth Engine
//  Complete rewrite with enhanced mechanics
//  (con fix de resize/rotación: entidades ya no
//   quedan atrapadas en paredes al cambiar tamaño)
// ============================================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ─── QUALITY PRESETS ─────────────────────────
const QUALITY_PRESETS = {
  low: {
    label: 'LOW',
    desc: 'Max performance',
    wallGlow: false,       // no shadowBlur on walls
    entityGlow: false,     // no shadowBlur on player/enemies
    gradients: false,      // flat colors instead of radial gradients
    particles: false,      // no particle system
    trailLength: 0,        // no player trail
    powerupGlow: false,    // no glow on powerups
    endGlow: false,        // no glow on exit
    gridDots: false,       // no background grid dots
    menuAnim: false,       // static menu background
    menuNodeCount: 0,
    fpsTarget: 30,         // frame cap
    mazeCached: true,      // pre-render maze to offscreen canvas
    particleMax: 0,
    shieldPulse: false,    // shield is static, no sin pulse
  },
  medium: {
    label: 'MEDIUM',
    desc: 'Balanced',
    wallGlow: true,
    entityGlow: true,
    gradients: true,
    particles: true,
    trailLength: 8,
    powerupGlow: true,
    endGlow: true,
    gridDots: false,
    menuAnim: true,
    menuNodeCount: 25,
    fpsTarget: 60,
    mazeCached: true,
    particleMax: 30,
    shieldPulse: false,
  },
  high: {
    label: 'HIGH',
    desc: 'Full effects',
    wallGlow: true,
    entityGlow: true,
    gradients: true,
    particles: true,
    trailLength: 18,
    powerupGlow: true,
    endGlow: true,
    gridDots: true,
    menuAnim: true,
    menuNodeCount: 60,
    fpsTarget: 60,
    mazeCached: false,      // re-draw each frame (allows glow per-frame)
    particleMax: 120,
    shieldPulse: true,
  },
};

// Active quality — load from localStorage or default 'high'
let currentQuality = 'high';
try { const q = localStorage.getItem('nexus_quality'); if(QUALITY_PRESETS[q]) currentQuality = q; } catch(e){}
let GFX = QUALITY_PRESETS[currentQuality];

function setQuality(key) {
  if(!QUALITY_PRESETS[key]) return;
  if(key === currentQuality) return;
  try { localStorage.setItem('nexus_quality', key); } catch(e){}
  window.location.reload();
}

// Offscreen canvas for maze cache
let mazeCache = null;
let mazeCacheColors = null;

function invalidateMazeCache() { mazeCache = null; mazeCacheColors = null; }

// FPS limiter state
let fpsInterval = 1000/60;
let fpsLastTime = 0;

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
let shieldActive = false;       // player pressed shield manually → full protection
let shieldBlinking = false;     // hit by enemy → 2s invincibility window, visible blink
let shieldBlinkTimer = 0;
let shieldBlinkVisible = true;
let shieldBlinkFlip = 0;
let shieldCooldown = false;
let shieldCooldownTimer = 0;
const SHIELD_MAX_DURATION = 3.0;
const SHIELD_BLINK_DURATION = 2.0;
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
// FIX: al cambiar el tamaño (resize/rotación) el tamaño de celda "size"
// cambia, pero las posiciones de jugador/enemigos/powerups estaban guardadas
// en píxeles absolutos calculados con el "size" anterior. Eso hacía que,
// tras el resize, la misma posición en píxeles cayera en una celda distinta
// (con paredes en otro lado) y las entidades quedaran "dentro" de una pared,
// trabadas para siempre porque moveEntity nunca deja avanzar desde un punto
// que ya colisiona. La solución es reescalar todas las posiciones en la
// misma proporción en que cambió "size", e invalidar el caché del laberinto
// (estaba dibujado sobre un canvas con el tamaño viejo).
function resizeCanvas() {
  const hud = document.getElementById('hud');
  const tc = document.getElementById('touchControls');
  const hudH = hud ? hud.offsetHeight : 48;
  const tcH = (window.innerWidth < 768 && tc) ? tc.offsetHeight : 0;
  const maxW = window.innerWidth - 4;
  const maxH = window.innerHeight - hudH - tcH - 4;

  const oldSize = size;
  size = Math.floor(Math.min(maxW / cols, maxH / rows));
  size = Math.max(12, Math.min(size, 36));
  canvas.width = size * cols;
  canvas.height = size * rows;
  playerRadius = Math.max(3, Math.floor(size * 0.22));
  enemyRadius = Math.max(3, Math.floor(size * 0.22));

  if (fogOfWar) {
    fogRadius = fogRadius > 0 ? (fogRadius / oldSize) * size : size * 3.5;
  }

  // Reescalar posiciones existentes para que sigan cayendo en la misma
  // celda lógica de la grilla, evitando que queden "dentro" de una pared.
  if (maze && oldSize && oldSize !== size) {
    const scale = size / oldSize;

    if (player) {
      player.x *= scale;
      player.y *= scale;
    }

    enemies.forEach(e => {
      e.x *= scale;
      e.y *= scale;
      // Se descarta el path viejo: fue calculado para la grilla anterior
      // y sus coordenadas de celda podrían ya no corresponder.
      e.path = [];
      e.pathTimer = 0;
    });

    // Los powerups guardan cx/cy (coordenadas de celda), así que se
    // recalculan directo desde ahí en vez de escalar x/y (más preciso).
    powerups.forEach(p => {
      p.x = (p.cx + 0.5) * size;
      p.y = (p.cy + 0.5) * size;
    });

    // El trail y las partículas quedan con posiciones "viejas" que ya no
    // tienen sentido visualmente tras el reescalado; se limpian.
    playerTrail = [];
    particles = [];

    // El maze estaba cacheado en un offscreen canvas con el tamaño viejo.
    invalidateMazeCache();
  }
}

// Debounce del resize: en mobile, al rotar la pantalla el navegador puede
// disparar varios eventos de resize seguidos mientras ajusta la UI
// (barra de direcciones, etc.). Sin debounce, resizeCanvas() se ejecuta
// varias veces con valores intermedios inestables, provocando saltos
// visuales. Se espera un pequeño margen antes de aplicar el resize final.
let resizeDebounceTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => { resizeCanvas(); }, 120);
});

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
  if(!GFX.particles) return;
  const allowed = Math.min(count, GFX.particleMax - particles.length);
  if(allowed <= 0) return;
  count = allowed;
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
  if(GFX.trailLength === 0) { playerTrail = []; return; }
  playerTrail.unshift({x:player.x,y:player.y,life:1});
  if(playerTrail.length > GFX.trailLength) playerTrail.pop();
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
  } else if(shieldBlinking) {
    sb.style.background='#ff9900';
    sb.style.width=(shieldBlinkTimer/SHIELD_BLINK_DURATION)*100+'%';
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

  // Shield: manual activation countdown
  if(shieldActive) {
    shieldRemaining-=delta;
    if(shieldRemaining<=0) {
      shieldActive=false;
      shieldCooldown=true;
      shieldCooldownTimer=SHIELD_COOLDOWN;
    }
  }

  // Shield: blinking invincibility window after being hit
  if(shieldBlinking) {
    shieldBlinkTimer-=delta;
    shieldBlinkFlip+=delta;
    if(shieldBlinkFlip>=0.12) { shieldBlinkFlip=0; shieldBlinkVisible=!shieldBlinkVisible; }
    if(shieldBlinkTimer<=0) {
      shieldBlinking=false;
      shieldBlinkVisible=true;
      shieldCooldown=true;
      shieldCooldownTimer=SHIELD_COOLDOWN;
    }
  }

  if(shieldCooldown) {
    shieldCooldownTimer-=delta;
    if(shieldCooldownTimer<=0) { shieldCooldown=false; shieldCooldownTimer=0; }
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
      const pc=Math.max(0,Math.min(cols-1,Math.floor(player.x/size)));
      const pr=Math.max(0,Math.min(rows-1,Math.floor(player.y/size)));
      const ec=Math.max(0,Math.min(cols-1,Math.floor(e.x/size)));
      const er=Math.max(0,Math.min(rows-1,Math.floor(e.y/size)));
      if(e.smart) {
        e.path=bfsPath(maze,ec,er,pc,pr,rows,cols);
      } else {
        const nb=getNeighbors(maze,ec,er);
        e.path=nb.length?[nb[Math.floor(Math.random()*nb.length)]]:[];
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

    // Collision with player
    if(Math.hypot(player.x-e.x,player.y-e.y)<playerRadius+enemyRadius) {
      const protected_ = shieldActive || shieldBlinking;
      if(protected_) {
        // Only react once per hit: when shield is active (not already blinking)
        if(shieldActive && !shieldBlinking) {
          sfxShieldHit();
          shieldActive=false;
          shieldBlinking=true;
          shieldBlinkTimer=SHIELD_BLINK_DURATION;
          shieldBlinkVisible=true;
          shieldBlinkFlip=0;
          shieldRemaining=0;
          spawnParticles(player.x,player.y,'#00f5ff',20,120,0.6);
          score+=50;
        } else if(!shieldActive && !shieldBlinking) {
          // Shield powerup restored shield but wasn't manually active — treat as hit
          sfxShieldHit();
          shieldBlinking=true;
          shieldBlinkTimer=SHIELD_BLINK_DURATION;
          shieldBlinkVisible=true;
          shieldBlinkFlip=0;
          spawnParticles(player.x,player.y,'#00f5ff',20,120,0.6);
          score+=50;
        }
        // Snap enemy back to nearest cell center so it doesn't get stuck
        const ec2=Math.round((e.x/size)-0.5), er2=Math.round((e.y/size)-0.5);
        const sc=Math.max(0,Math.min(cols-1,ec2)), sr=Math.max(0,Math.min(rows-1,er2));
        e.x=(sc+0.5)*size; e.y=(sr+0.5)*size;
        e.path=[]; e.pathTimer=0;
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

function buildMazeCache(colors) {
  const oc = document.createElement('canvas');
  oc.width = canvas.width; oc.height = canvas.height;
  const octx = oc.getContext('2d');
  octx.strokeStyle = colors.wall;
  octx.lineWidth = 1.5;
  if(GFX.wallGlow) { octx.shadowColor = colors.wall; octx.shadowBlur = 3; }
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const cell=maze[r][c];
      const x=c*size, y=r*size;
      octx.beginPath();
      if(cell.walls[0]){octx.moveTo(x,y);octx.lineTo(x+size,y);}
      if(cell.walls[1]){octx.moveTo(x+size,y);octx.lineTo(x+size,y+size);}
      if(cell.walls[2]){octx.moveTo(x,y+size);octx.lineTo(x+size,y+size);}
      if(cell.walls[3]){octx.moveTo(x,y);octx.lineTo(x,y+size);}
      octx.stroke();
    }
  }
  octx.shadowBlur = 0;
  return oc;
}

function drawMaze(colors) {
  // Fog always needs per-frame draw (cells revealed dynamically)
  if(GFX.mazeCached && !fogOfWar) {
    // Rebuild cache if stale or colors changed
    if(!mazeCache || mazeCacheColors !== colors.wall) {
      mazeCache = buildMazeCache(colors);
      mazeCacheColors = colors.wall;
    }
    ctx.drawImage(mazeCache, 0, 0);
    return;
  }

  ctx.strokeStyle=colors.wall;
  ctx.lineWidth=1.5;
  if(GFX.wallGlow) { ctx.shadowColor=colors.wall; ctx.shadowBlur=3; }

  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
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
  const pulse = GFX.endGlow ? Math.sin(t*3)*0.2+0.8 : 1.0;
  const outerR=size*0.4*pulse;

  if(GFX.endGlow) { ctx.shadowColor=colors.endGlow; ctx.shadowBlur=20*pulse; }

  ctx.strokeStyle=colors.end;
  ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.arc(ex,ey,outerR,0,Math.PI*2);
  ctx.stroke();

  if(GFX.endGlow) {
    ctx.fillStyle=colors.end;
    ctx.globalAlpha=0.3*pulse;
    ctx.beginPath();
    ctx.arc(ex,ey,outerR*0.6,0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=1;
  }

  ctx.fillStyle=colors.end;
  ctx.beginPath();
  const s=size*0.18;
  ctx.moveTo(ex,ey-s);ctx.lineTo(ex+s,ey);ctx.lineTo(ex,ey+s);ctx.lineTo(ex-s,ey);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur=0;
}

function drawPlayer() {
  if(GFX.trailLength > 0) drawTrail();
  const t=Date.now()/1000;

  // Shield ring
  const showShield = shieldActive || (shieldBlinking && shieldBlinkVisible);
  if(showShield) {
    const isBlinking = shieldBlinking;
    const alpha = (GFX.shieldPulse && !isBlinking) ? 0.6+Math.sin(t*8)*0.2 : 0.75;
    ctx.globalAlpha=alpha;
    ctx.strokeStyle = isBlinking ? '#ff9900' : '#00f5ff';
    ctx.lineWidth=2;
    if(GFX.entityGlow) { ctx.shadowColor= isBlinking ? '#ff9900' : '#00f5ff'; ctx.shadowBlur=15; }
    ctx.beginPath();
    ctx.arc(player.x,player.y,playerRadius+7,0,Math.PI*2);
    ctx.stroke();
    ctx.shadowBlur=0;
    ctx.globalAlpha=1;
  }

  // Player body
  if(GFX.gradients) {
    const grad=ctx.createRadialGradient(player.x-2,player.y-2,0,player.x,player.y,playerRadius);
    grad.addColorStop(0,'#ff6688');
    grad.addColorStop(1,'#cc0033');
    ctx.fillStyle=grad;
  } else {
    ctx.fillStyle='#dd1133';
  }
  if(GFX.entityGlow) { ctx.shadowColor='#ff2244'; ctx.shadowBlur=12; }
  ctx.beginPath();
  ctx.arc(player.x,player.y,playerRadius,0,Math.PI*2);
  ctx.fill();
  ctx.shadowBlur=0;

  // Speed boost aura
  if(speedBoost>0 && GFX.entityGlow) {
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

    if(GFX.entityGlow) { ctx.shadowColor=glowColor; ctx.shadowBlur=frozen?8:12; }

    if(GFX.gradients) {
      const pulse=Math.sin(t*4+i)*0.15+0.85;
      const grad=ctx.createRadialGradient(e.x-1,e.y-2,0,e.x,e.y,enemyRadius);
      grad.addColorStop(0,frozen?'#44ccff':e.smart?'#ffdd44':'#ff8866');
      grad.addColorStop(1,color);
      ctx.fillStyle=grad;
      ctx.beginPath();
      ctx.arc(e.x,e.y,enemyRadius*pulse,0,Math.PI*2);
    } else {
      ctx.fillStyle=color;
      ctx.beginPath();
      ctx.arc(e.x,e.y,enemyRadius,0,Math.PI*2);
    }
    ctx.fill();

    // Eye (always draw, cheap)
    ctx.shadowBlur=0;
    ctx.fillStyle='white';
    ctx.beginPath();
    const eyeX=e.x+(player.x-e.x>0?2:-2);
    const eyeY=e.y+(player.y-e.y>0?2:-2)*0.5;
    ctx.arc(eyeX,eyeY,1.5,0,Math.PI*2);
    ctx.fill();

    // Smart crown — only in medium/high
    if(e.smart&&!frozen&&GFX.entityGlow) {
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
  powerups.forEach(p=>{
    if(p.collected) return;
    if(fogOfWar&&revealedCells&&!revealedCells[p.cy][p.cx]) return;

    const pulse = GFX.powerupGlow ? Math.sin(p.pulse)*0.25+0.75 : 1.0;
    const r=size*0.28*pulse;
    const x=p.x, y=p.y;

    if(GFX.powerupGlow) { ctx.shadowColor=p.type.color; ctx.shadowBlur=16*pulse; }
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

  // Grid dots — high quality only
  if(GFX.gridDots) {
    ctx.fillStyle='rgba(255,255,255,0.04)';
    for(let r=0;r<=rows;r++) for(let c=0;c<=cols;c++) {
      ctx.fillRect(c*size-0.5,r*size-0.5,1,1);
    }
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
  animFrame = requestAnimationFrame(loop);

  // FPS limiter for LOW quality
  if(GFX.fpsTarget < 60) {
    fpsInterval = 1000 / GFX.fpsTarget;
    const elapsed = t - fpsLastTime;
    if(elapsed < fpsInterval) return;
    fpsLastTime = t - (elapsed % fpsInterval);
  } else {
    fpsLastTime = t;
  }

  const delta=(t-lastTime)/1000;
  lastTime=t;
  update(delta);
  draw();
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
  invalidateMazeCache();
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
  shieldBlinking=false;
  shieldBlinkTimer=0;
  shieldBlinkVisible=true;
  shieldBlinkFlip=0;
  shieldCooldown=false;
  shieldCooldownTimer=0;
  shieldRemaining=0;
  speedBoost=0;
  freezeEnemies=0;

  // Enemies — spawn at cell centers, well away from player start
  enemies=[];
  for(let i=0;i<cfg.enemyCount;i++) {
    let cx,cy;
    let attempts=0;
    do {
      cx=Math.floor(Math.random()*cols);
      cy=Math.floor(Math.random()*rows);
      attempts++;
    } while(attempts<200 && (cx+cy)<6); // Manhattan dist from (0,0) >= 6
    const smart=i<cfg.smartEnemies;
    // Snap pixel position to exact cell center using current size
    enemies.push({
      cx, cy,
      x:(cx+0.5)*size,
      y:(cy+0.5)*size,
      path:[], pathTimer:0, smart
    });
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
  lastTime=performance.now(); // reset delta to avoid a multi-second first frame
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
  cancelAnimationFrame(bgAnimFrame);

  // LOW quality: just paint a solid dark gradient, no animation
  if(!GFX.menuAnim || GFX.menuNodeCount === 0) {
    const bgCtx=bgCanvas.getContext('2d');
    bgCanvas.width=window.innerWidth;
    bgCanvas.height=window.innerHeight;
    bgCtx.fillStyle='#050810';
    bgCtx.fillRect(0,0,bgCanvas.width,bgCanvas.height);
    return;
  }

  const bgCtx=bgCanvas.getContext('2d');
  const nodes=[];
  function resizeBg() {
    bgCanvas.width=window.innerWidth;
    bgCanvas.height=window.innerHeight;
  }
  resizeBg();
  window.addEventListener('resize',resizeBg);

  const nodeCount = GFX.menuNodeCount;
  for(let i=0;i<nodeCount;i++) nodes.push({
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
      if(GFX.menuNodeCount > 30) { bgCtx.shadowColor=n.color; bgCtx.shadowBlur=8; }
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
document.querySelectorAll('.quality-btn').forEach(b => {
  b.classList.toggle('active', b.dataset.q === currentQuality);
});
startMenuAnimation();
lastTime = performance.now();
fpsLastTime = lastTime;
animFrame = requestAnimationFrame(loop);
