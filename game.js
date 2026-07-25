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

// Hunter enemies (desde nivel 3): deambulan al azar y sólo persiguen
// cuando ven al jugador delante suyo (campo de visión + línea de visión
// sin paredes de por medio). Si dejan de verte por HUNTER_LOSE_SIGHT_TIME
// segundos, abandonan la persecución y vuelven a deambular.
const HUNTER_VISION_CELLS = 6;                 // alcance de visión, en celdas
const HUNTER_FOV_HALF_DEG = 50;                // medio ángulo del cono de visión (100° total)
const HUNTER_FOV_COS = Math.cos(HUNTER_FOV_HALF_DEG * Math.PI / 180);
const HUNTER_LOSE_SIGHT_TIME = 4.0;            // segundos sin verte antes de abandonar

// Power-up effects
let speedBoost = 0;
let freezeEnemies = 0;
let fogOfWar = false;
let fogRadius = 0;

// Señuelo: distrae a los hunters que te estén persiguiendo
let decoyActive = false;
let decoyTimer = 0;
let decoyX = 0, decoyY = 0;
const DECOY_DURATION = 4.0;

// Puntaje doble
let doubleScoreTimer = 0;
const DOUBLE_SCORE_DURATION = 8.0;

// Visión de rayos X: revela el camino hacia la salida por unos segundos
let xrayTimer = 0;
let xrayPath = null;
const XRAY_DURATION = 6.0;

// Trampas, teletransportadores y llave (aparecen desde ciertos niveles)
let traps = [];
let teleporters = [];
let keyItem = null;
let hasKey = true;              // true si el nivel no requiere llave, o ya se recolectó
let trapInvulnTimer = 0;        // breve invulnerabilidad tras pisar una trampa
let teleportCooldownTimer = 0;  // evita rebotar de un teleportador al otro sin parar
let lockedToastTimer = 0;       // rate-limit del aviso "necesitás la llave"
const TELEPORTER_COLORS = ['#00ffea', '#ff00ea', '#eaff00'];

// Racha de niveles completados sin perder ninguna vida
let winStreak = 0;
let levelHitOccurred = false;

// Se actualiza cada frame en update(): usado por drawEnemies() para pintar
// a las estatuas de otro color mientras el jugador está en movimiento.
let playerMoved = false;

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

    // Trampas, teletransportadores y llave también guardan cx/cy: se
    // recalculan directo desde ahí, igual que los powerups.
    traps.forEach(t => { t.x=(t.cx+0.5)*size; t.y=(t.cy+0.5)*size; });
    teleporters.forEach(tp => { tp.x=(tp.cx+0.5)*size; tp.y=(tp.cy+0.5)*size; });
    if (keyItem) { keyItem.x=(keyItem.cx+0.5)*size; keyItem.y=(keyItem.cy+0.5)*size; }

    // El señuelo no tiene cx/cy propio (se dropea en una posición libre de
    // píxeles, no en el centro de una celda), así que se reescala directo.
    if (decoyActive) { decoyX *= scale; decoyY *= scale; }

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

// ─── HUNTER PERCEPTION (línea de visión + campo de visión) ──
// Recorre el segmento enemigo→jugador en pasos pequeños y, cada vez que
// cruza a una celda distinta, verifica que la pared entre ambas celdas
// esté abierta. Si en algún punto hay una pared bloqueando, no hay
// línea de visión.
function hasLineOfSight(x1, y1, x2, y2) {
  if (!maze) return false;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist < 1) return true;
  const step = Math.max(2, size * 0.2);
  const steps = Math.ceil(dist / step);
  let cx = Math.floor(x1 / size), cy = Math.floor(y1 / size);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    const ncx = Math.floor(px / size), ncy = Math.floor(py / size);
    if (ncx < 0 || ncy < 0 || ncx >= cols || ncy >= rows) return false;
    if (ncx !== cx || ncy !== cy) {
      if (ncx === cx + 1 && ncy === cy) { if (maze[cy][cx].walls[1]) return false; }
      else if (ncx === cx - 1 && ncy === cy) { if (maze[cy][cx].walls[3]) return false; }
      else if (ncy === cy + 1 && ncx === cx) { if (maze[cy][cx].walls[2]) return false; }
      else if (ncy === cy - 1 && ncx === cx) { if (maze[cy][cx].walls[0]) return false; }
      else {
        // Salto diagonal entre celdas (paso grande cruzó una esquina):
        // se considera bloqueado sólo si ambas paredes adyacentes lo están,
        // ya que si alguna está abierta se puede "ver" a través de esa esquina.
        const dx = ncx - cx, dy = ncy - cy;
        const wallH = dx > 0 ? maze[cy][cx].walls[1] : maze[cy][cx].walls[3];
        const wallV = dy > 0 ? maze[cy][cx].walls[2] : maze[cy][cx].walls[0];
        if (wallH && wallV) return false;
      }
      cx = ncx; cy = ncy;
    }
  }
  return true;
}

// Un hunter "ve" al jugador si está dentro del alcance, dentro de su cono
// de visión frontal (según hacia dónde se está moviendo) y hay línea de
// visión directa (sin paredes de por medio).
function canHunterSeePlayer(e) {
  const dx = player.x - e.x, dy = player.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist > size * HUNTER_VISION_CELLS) return false;
  if (dist > 1) {
    const nx = dx / dist, ny = dy / dist;
    const fx = e.facingX || 1, fy = e.facingY || 0;
    const dot = fx * nx + fy * ny;
    if (dot < HUNTER_FOV_COS) return false;
  }
  return hasLineOfSight(e.x, e.y, player.x, player.y);
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
  { id:'speed',       color:'#ffe600', glyph:'⚡',  label:'SPEED BOOST',    duration:5 },
  { id:'freeze',      color:'#00aaff', glyph:'❄',  label:'FREEZE ENEMIES', duration:4 },
  { id:'shield',      color:'#00f5ff', glyph:'🛡',  label:'SHIELD RESTORE', duration:0 },
  { id:'xray',        color:'#00ff88', glyph:'👁',  label:'VISIÓN RAYOS X', duration:XRAY_DURATION },
  { id:'decoy',       color:'#ff66ff', glyph:'👥',  label:'SEÑUELO',        duration:DECOY_DURATION },
  { id:'doublescore', color:'#ffaa00', glyph:'2×', label:'PUNTAJE DOBLE',  duration:DOUBLE_SCORE_DURATION },
];

// Suma puntaje respetando el multiplicador de "puntaje doble" si está activo.
function addScore(n) {
  score += doubleScoreTimer > 0 ? Math.round(n * 2) : n;
}

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

// ─── TRAMPAS / TELETRANSPORTADORES / LLAVE ───
// Genera los hazards del mapa para el nivel actual. Se llama junto con
// spawnPowerups() al iniciar cada nivel.
function spawnHazards(cfg) {
  traps = [];
  teleporters = [];
  keyItem = null;
  hasKey = !cfg.needsKey;

  const used = new Set();
  const isFree = (cx,cy) => {
    if(used.has(cy*cols+cx)) return false;
    if((cx<2&&cy<2)||(cx>=cols-2&&cy>=rows-2)) return false; // lejos del inicio y la salida
    return true;
  };
  const pickFreeCell = () => {
    let cx,cy,attempts=0;
    do { cx=Math.floor(Math.random()*cols); cy=Math.floor(Math.random()*rows); attempts++; }
    while(!isFree(cx,cy) && attempts<300);
    used.add(cy*cols+cx);
    return {cx,cy};
  };

  for(let i=0;i<cfg.trapCount;i++) {
    const {cx,cy}=pickFreeCell();
    traps.push({ cx, cy, x:(cx+0.5)*size, y:(cy+0.5)*size });
  }

  for(let i=0;i<cfg.teleporterPairs;i++) {
    const a=pickFreeCell(), b=pickFreeCell();
    const color = TELEPORTER_COLORS[i % TELEPORTER_COLORS.length];
    teleporters.push({ cx:a.cx, cy:a.cy, x:(a.cx+0.5)*size, y:(a.cy+0.5)*size, pairId:i, color });
    teleporters.push({ cx:b.cx, cy:b.cy, x:(b.cx+0.5)*size, y:(b.cy+0.5)*size, pairId:i, color });
  }

  if(cfg.needsKey) {
    const {cx,cy}=pickFreeCell();
    keyItem = { cx, cy, x:(cx+0.5)*size, y:(cy+0.5)*size, collected:false };
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

  // Llave (sólo se muestra en niveles que la requieren)
  const keyHud=document.getElementById('keyHudItem');
  if(keyHud) {
    if(!keyItem) {
      keyHud.style.display='none';
    } else {
      keyHud.style.display='flex';
      document.getElementById('keyDisplay').textContent = hasKey ? '🔓' : '🔒';
    }
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
  if(doubleScoreTimer>0) doubleScoreTimer-=delta;
  if(xrayTimer>0) xrayTimer-=delta;
  if(decoyActive) {
    decoyTimer-=delta;
    if(decoyTimer<=0) decoyActive=false;
  }
  if(trapInvulnTimer>0) trapInvulnTimer-=delta;
  if(teleportCooldownTimer>0) teleportCooldownTimer-=delta;
  if(lockedToastTimer>0) lockedToastTimer-=delta;

  // Guarda si el jugador se movió este frame: lo usan las estatuas (drawEnemies)
  playerMoved = moved;

  // Powerup pulse & collect
  powerups.forEach(p=>{ p.pulse+=delta*3; });
  for(let i=powerups.length-1;i>=0;i--) {
    const p=powerups[i];
    if(p.collected) continue;
    if(Math.hypot(player.x-p.x,player.y-p.y)<playerRadius+10) {
      p.collected=true;
      sfxCollect();
      addScore(200);
      spawnParticles(p.x,p.y,p.type.color,16,100,0.7);
      showToast(p.type.glyph+' '+p.type.label);
      if(p.type.id==='speed') speedBoost=p.type.duration;
      else if(p.type.id==='freeze') freezeEnemies=p.type.duration;
      else if(p.type.id==='shield') { shieldActive=false; shieldCooldown=false; shieldCooldownTimer=0; shieldRemaining=SHIELD_MAX_DURATION; }
      else if(p.type.id==='xray') {
        xrayTimer=p.type.duration;
        const pc=Math.max(0,Math.min(cols-1,Math.floor(player.x/size)));
        const pr=Math.max(0,Math.min(rows-1,Math.floor(player.y/size)));
        xrayPath=bfsPath(maze,pc,pr,endCell.x,endCell.y,rows,cols);
      }
      else if(p.type.id==='decoy') { decoyActive=true; decoyTimer=p.type.duration; decoyX=player.x; decoyY=player.y; }
      else if(p.type.id==='doublescore') { doubleScoreTimer=p.type.duration; }
    }
  }

  // Trampas: pierden una vida si las tocás, con breve invulnerabilidad para
  // no perder varias vidas de golpe si te quedás parado sobre una.
  if(trapInvulnTimer<=0 && !shieldActive && !shieldBlinking) {
    for(const trap of traps) {
      if(Math.hypot(player.x-trap.x,player.y-trap.y)<playerRadius+8) {
        trapInvulnTimer=1.2;
        spawnParticles(trap.x,trap.y,'#ff2244',18,110,0.6);
        handleDeath();
        break;
      }
    }
  }

  // Teletransportadores: te mandan al par vinculado, con cooldown para que
  // no rebotes instantáneamente de un lado al otro.
  if(teleportCooldownTimer<=0) {
    for(const tp of teleporters) {
      if(Math.hypot(player.x-tp.x,player.y-tp.y)<playerRadius+8) {
        const dest=teleporters.find(o=>o.pairId===tp.pairId && o!==tp);
        if(dest) {
          spawnParticles(player.x,player.y,tp.color,16,90,0.5);
          player.x=dest.x; player.y=dest.y;
          spawnParticles(player.x,player.y,tp.color,16,90,0.5);
          teleportCooldownTimer=1.0;
          playerTrail=[];
        }
        break;
      }
    }
  }

  // Llave
  if(keyItem && !keyItem.collected && Math.hypot(player.x-keyItem.x,player.y-keyItem.y)<playerRadius+10) {
    keyItem.collected=true;
    hasKey=true;
    sfxCollect();
    addScore(100);
    spawnParticles(keyItem.x,keyItem.y,'#ffe600',18,100,0.6);
    showToast('🔑 LLAVE OBTENIDA');
  }

  // Enemies
  const enemySpeed = Math.min(50+currentLevel*8, 130);
  enemies.forEach(e=>{
    if(freezeEnemies>0) return;

    if (e.patrol) {
      // Patrulla: recorre una ruta fija en ida y vuelta, sin perseguir jamás.
      const target=e.patrolRoute[e.patrolIndex];
      const tx=(target.x+0.5)*size, ty=(target.y+0.5)*size;
      const ddx=tx-e.x, ddy=ty-e.y;
      const dist=Math.hypot(ddx,ddy);
      if(dist<2) {
        e.x=tx; e.y=ty;
        e.patrolIndex=(e.patrolIndex+1)%e.patrolRoute.length;
      } else {
        const pSpeed=enemySpeed*0.65;
        moveEntity(e,ddx/dist*pSpeed,ddy/dist*pSpeed,delta,enemyRadius);
      }
    } else if (e.statue) {
      // Estatua: siempre "sabe" el camino hacia vos (recalcula BFS como un
      // hunter en persecución), pero sólo puede avanzar en los frames en que
      // el jugador también se está moviendo — si estás quieto, se congela.
      if(!e.path||e.path.length===0||e.pathTimer<=0) {
        const pc=Math.max(0,Math.min(cols-1,Math.floor(player.x/size)));
        const pr=Math.max(0,Math.min(rows-1,Math.floor(player.y/size)));
        const ec=Math.max(0,Math.min(cols-1,Math.floor(e.x/size)));
        const er=Math.max(0,Math.min(rows-1,Math.floor(e.y/size)));
        e.path=bfsPath(maze,ec,er,pc,pr,rows,cols);
        e.pathTimer=0.6+Math.random()*0.4;
      }
      e.pathTimer-=delta;
      if(moved && e.path && e.path.length>0) {
        const next=e.path[0];
        const tx=(next.x+0.5)*size, ty=(next.y+0.5)*size;
        const ddx=tx-e.x, ddy=ty-e.y;
        const dist=Math.hypot(ddx,ddy);
        if(dist<2) { e.x=tx; e.y=ty; e.path.shift(); }
        else {
          const sSpeed=enemySpeed*0.9;
          moveEntity(e,ddx/dist*sSpeed,ddy/dist*sSpeed,delta,enemyRadius);
        }
      }
    } else {
      // Hunter / enemigo común: percepción + persecución, o deambular al azar.

      // Percepción del hunter: se evalúa TODOS los frames (no sólo cuando
      // toca recalcular camino), porque tanto ver al jugador como el conteo
      // de los 4 segundos sin verlo dependen del tiempo real transcurrido.
      // Mientras el señuelo está activo y ya te estaba persiguiendo, no
      // vuelve a chequear si te ve de verdad: queda distraído con el señuelo.
      if (e.hunter) {
        if (decoyActive && e.huntState === 'chase') {
          // Distraído por el señuelo.
        } else {
          const canSee = canHunterSeePlayer(e);
          if (canSee) {
            e.lostSightTimer = 0;
            if (e.huntState !== 'chase') {
              e.huntState = 'chase';
              e.path = []; e.pathTimer = 0;
            }
          } else if (e.huntState === 'chase') {
            e.lostSightTimer += delta;
            if (e.lostSightTimer >= HUNTER_LOSE_SIGHT_TIME) {
              e.huntState = 'wander';
              e.path = []; e.pathTimer = 0;
            }
          }
        }
      }

      if(!e.path||e.path.length===0||e.pathTimer<=0) {
        const pc=Math.max(0,Math.min(cols-1,Math.floor(player.x/size)));
        const pr=Math.max(0,Math.min(rows-1,Math.floor(player.y/size)));
        const ec=Math.max(0,Math.min(cols-1,Math.floor(e.x/size)));
        const er=Math.max(0,Math.min(rows-1,Math.floor(e.y/size)));
        const chasing = e.hunter && e.huntState==='chase';
        if(chasing) {
          const tgtX = decoyActive ? Math.max(0,Math.min(cols-1,Math.floor(decoyX/size))) : pc;
          const tgtY = decoyActive ? Math.max(0,Math.min(rows-1,Math.floor(decoyY/size))) : pr;
          e.path=bfsPath(maze,ec,er,tgtX,tgtY,rows,cols);
          e.pathTimer=0.5+Math.random()*0.3; // recalcula más seguido mientras persigue
        } else {
          const nb=getNeighbors(maze,ec,er);
          e.path=nb.length?[nb[Math.floor(Math.random()*nb.length)]]:[];
          e.pathTimer=0.8+Math.random()*0.8;
        }
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
          // El hunter actualiza hacia dónde "mira" según hacia dónde se mueve,
          // eso define su cono de visión frontal.
          if (e.hunter) { e.facingX = ddx/dist; e.facingY = ddy/dist; }
        }
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
          addScore(50);
        } else if(!shieldActive && !shieldBlinking) {
          // Shield powerup restored shield but wasn't manually active — treat as hit
          sfxShieldHit();
          shieldBlinking=true;
          shieldBlinkTimer=SHIELD_BLINK_DURATION;
          shieldBlinkVisible=true;
          shieldBlinkFlip=0;
          spawnParticles(player.x,player.y,'#00f5ff',20,120,0.6);
          addScore(50);
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
  levelHitOccurred=true; // rompe la racha de "nivel sin perder vidas"
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

// Genera una ruta fija para un enemigo "patrulla": un recorrido al azar de
// `length` pasos evitando retroceder inmediatamente sobre sus pasos, y
// luego arma un ciclo ida-y-vuelta para que la recorra en loop para siempre.
function generatePatrolRoute(startCx, startCy, length) {
  const route=[{x:startCx,y:startCy}];
  let cx=startCx, cy=startCy;
  let prevCx=-1, prevCy=-1;
  for(let i=0;i<length;i++) {
    const nb=getNeighbors(maze,cx,cy);
    const filtered=nb.filter(n=>!(n.x===prevCx&&n.y===prevCy));
    const options=filtered.length?filtered:nb;
    if(!options.length) break;
    const next=options[Math.floor(Math.random()*options.length)];
    prevCx=cx; prevCy=cy;
    route.push(next);
    cx=next.x; cy=next.y;
  }
  // Ida y vuelta: A,B,C,D,C,B,(vuelve a A) sin duplicar los extremos.
  return route.concat(route.slice(1,-1).reverse());
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
  const locked = !hasKey;
  const pulse = GFX.endGlow ? Math.sin(t*3)*0.2+0.8 : 1.0;
  const outerR=size*0.4*pulse;
  const endColor = locked ? '#777788' : colors.end;
  const endGlowColor = locked ? '#777788' : colors.endGlow;

  if(GFX.endGlow) { ctx.shadowColor=endGlowColor; ctx.shadowBlur=20*pulse; }

  ctx.strokeStyle=endColor;
  ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.arc(ex,ey,outerR,0,Math.PI*2);
  ctx.stroke();

  if(GFX.endGlow) {
    ctx.fillStyle=endColor;
    ctx.globalAlpha=0.3*pulse;
    ctx.beginPath();
    ctx.arc(ex,ey,outerR*0.6,0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=1;
  }

  if(locked) {
    // Bloqueada: ícono de candado en vez del diamante habitual.
    ctx.shadowBlur=0;
    ctx.fillStyle='#ff6677';
    ctx.font=`${Math.floor(size*0.4)}px Arial`;
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText('🔒', ex, ey+1);
  } else {
    ctx.fillStyle=endColor;
    ctx.beginPath();
    const s=size*0.18;
    ctx.moveTo(ex,ey-s);ctx.lineTo(ex+s,ey);ctx.lineTo(ex,ey+s);ctx.lineTo(ex-s,ey);
    ctx.closePath();
    ctx.fill();
  }

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
    const hunterChasing = e.hunter && e.huntState==='chase';
    const statueActive = e.statue && playerMoved;
    let color, glowColor;
    if (frozen) { color='#00aaff'; glowColor='#00aaff'; }
    else if (e.patrol) { color='#00ffcc'; glowColor='#00ffcc'; }
    else if (e.statue) {
      color = statueActive ? '#ff4466' : '#9999aa';
      glowColor = statueActive ? '#ff4466' : '#7777aa';
    }
    else if (e.hunter) {
      color = hunterChasing ? '#ff0044' : '#aa44ff';
      glowColor = hunterChasing ? '#ff0066' : '#8822ff';
    }
    else { color='#ff4400'; glowColor='#ff2200'; }

    if(GFX.entityGlow) { ctx.shadowColor=glowColor; ctx.shadowBlur=frozen?8:12; }

    if(GFX.gradients) {
      const pulse=Math.sin(t*4+i)*0.15+0.85;
      const grad=ctx.createRadialGradient(e.x-1,e.y-2,0,e.x,e.y,enemyRadius);
      const stop0 = frozen?'#44ccff'
        : e.patrol?'#66ffee'
        : e.statue?(statueActive?'#ff8899':'#bbbbdd')
        : e.hunter?(hunterChasing?'#ff6688':'#cc88ff')
        : '#ff8866';
      grad.addColorStop(0,stop0);
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

    // Eye (always draw, cheap) — la estatua tiene ojos rojos, más inquietante
    ctx.shadowBlur=0;
    ctx.fillStyle= e.statue ? '#ff2244' : 'white';
    ctx.beginPath();
    const eyeX=e.x+(player.x-e.x>0?2:-2);
    const eyeY=e.y+(player.y-e.y>0?2:-2)*0.5;
    ctx.arc(eyeX,eyeY,1.5,0,Math.PI*2);
    ctx.fill();

    // Hunter: ícono de alerta "!" mientras está persiguiendo al jugador
    if(hunterChasing&&!frozen) {
      ctx.fillStyle='#ff0044';
      if(GFX.entityGlow) { ctx.shadowColor='#ff0044'; ctx.shadowBlur=6; }
      ctx.font=`bold ${Math.max(8,Math.floor(enemyRadius*1.6))}px Arial`;
      ctx.textAlign='center';
      ctx.textBaseline='bottom';
      ctx.fillText('!',e.x,e.y-enemyRadius-3);
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

// ─── HAZARDS: TRAMPAS / TELETRANSPORTADORES / LLAVE ──
function drawTraps() {
  traps.forEach(trap=>{
    if(fogOfWar&&revealedCells&&!revealedCells[trap.cy][trap.cx]) return;
    const s=size*0.32;
    if(GFX.entityGlow) { ctx.shadowColor='#ff2244'; ctx.shadowBlur=8; }
    ctx.strokeStyle='#ff2244';
    ctx.fillStyle='#ff224466';
    ctx.lineWidth=1.3;
    for(let k=-1;k<=1;k++) {
      const bx=trap.x+k*s*0.7;
      ctx.beginPath();
      ctx.moveTo(bx-s*0.28, trap.y+s*0.55);
      ctx.lineTo(bx, trap.y-s*0.55);
      ctx.lineTo(bx+s*0.28, trap.y+s*0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.shadowBlur=0;
  });
}

function drawTeleporters() {
  const t=Date.now()/1000;
  teleporters.forEach(tp=>{
    if(fogOfWar&&revealedCells&&!revealedCells[tp.cy][tp.cx]) return;
    const pulse=Math.sin(t*4+tp.pairId)*0.2+0.8;
    const r=size*0.32*pulse;
    if(GFX.entityGlow) { ctx.shadowColor=tp.color; ctx.shadowBlur=14*pulse; }
    ctx.strokeStyle=tp.color;
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(tp.x,tp.y,r,0,Math.PI*2);
    ctx.stroke();
    ctx.fillStyle=tp.color+'55';
    ctx.beginPath();
    ctx.arc(tp.x,tp.y,r*0.5,0,Math.PI*2);
    ctx.fill();
    ctx.shadowBlur=0;
  });
}

function drawKey() {
  if(!keyItem||keyItem.collected) return;
  if(fogOfWar&&revealedCells&&!revealedCells[keyItem.cy][keyItem.cx]) return;
  const t=Date.now()/1000;
  const bob=Math.sin(t*3)*3;
  if(GFX.powerupGlow) { ctx.shadowColor='#ffe600'; ctx.shadowBlur=16; }
  ctx.fillStyle='white';
  ctx.font=`${Math.floor(size*0.5)}px Arial`;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText('🔑', keyItem.x, keyItem.y+bob);
  ctx.shadowBlur=0;
}

function drawDecoy() {
  if(!decoyActive) return;
  const t=Date.now()/1000;
  if(GFX.entityGlow) { ctx.shadowColor='#ff66ff'; ctx.shadowBlur=14; }
  ctx.globalAlpha=0.55+Math.sin(t*10)*0.15;
  ctx.fillStyle='#ff66ff';
  ctx.beginPath();
  ctx.arc(decoyX,decoyY,playerRadius,0,Math.PI*2);
  ctx.fill();
  ctx.shadowBlur=0;
  ctx.globalAlpha=1;
}

function drawXrayPath() {
  if(xrayTimer<=0||!xrayPath||!xrayPath.length) return;
  const t=Date.now()/1000;
  ctx.globalAlpha=0.5+Math.sin(t*6)*0.15;
  ctx.fillStyle='#00ff88';
  xrayPath.forEach(c=>{
    const x=(c.x+0.5)*size, y=(c.y+0.5)*size;
    ctx.beginPath();
    ctx.arc(x,y,Math.max(2,size*0.08),0,Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha=1;
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
  drawTraps();
  drawTeleporters();
  drawKey();
  drawXrayPath();
  drawEnd(colors);
  drawPowerups();
  drawDecoy();
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
  // Desde el nivel 3 aparecen los "hunters": arrancan deambulando al azar
  // y persiguen sólo cuando te ven. 1 desde nivel 3, sumando uno más cada
  // 2 niveles, hasta un máximo de 5 (absorbe la curva de dificultad que
  // antes tenía el enemigo "smart", ya eliminado).
  const hunterEnemies = lvl>=3 ? Math.min(1+Math.floor((lvl-3)/2), 5) : 0;
  // Patrulla: ronda fija predecible, útil para vigilar pasillos. Desde nivel 2.
  const patrolEnemies = lvl>=2 ? Math.min(1+Math.floor((lvl-2)/3), 3) : 0;
  // Estatua: sólo se mueve cuando vos te movés. Desde nivel 4.
  const statueEnemies = lvl>=4 ? Math.min(1+Math.floor((lvl-4)/3), 2) : 0;
  const hasFog = lvl>=5;
  // Trampas desde nivel 2, teletransportadores y llave desde nivel 4.
  const trapCount = lvl>=2 ? Math.min(1+Math.floor(lvl/3), 6) : 0;
  const teleporterPairs = lvl>=4 ? Math.min(1+Math.floor((lvl-4)/4), 2) : 0;
  const needsKey = lvl>=4;
  return { mazeSize, enemyCount, hunterEnemies, patrolEnemies, statueEnemies, hasFog, trapCount, teleporterPairs, needsKey };
}

// ─── START GAME ──────────────────────────────
function startGame() {
  currentLevel=1;
  score=0;
  lives=3;
  timerSeconds=0;
  winStreak=0;
  initLevel();
}

function nextLevel() {
  currentLevel++;
  addScore(Math.max(0, 1000 - timerSeconds*5));
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

  // Power-ups / hazards nuevos: se resetean en cada nivel
  decoyActive=false;
  decoyTimer=0;
  doubleScoreTimer=0;
  xrayTimer=0;
  xrayPath=null;
  trapInvulnTimer=0;
  teleportCooldownTimer=0;
  lockedToastTimer=0;
  levelHitOccurred=false;

  // Enemies — spawn at cell centers, well away from player start
  enemies=[];
  const hunterCount = Math.min(cfg.hunterEnemies, cfg.enemyCount);
  const patrolCount = Math.min(cfg.patrolEnemies, Math.max(0, cfg.enemyCount-hunterCount));
  const statueCount = Math.min(cfg.statueEnemies, Math.max(0, cfg.enemyCount-hunterCount-patrolCount));
  const HUNTER_DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
  for(let i=0;i<cfg.enemyCount;i++) {
    let cx,cy;
    let attempts=0;
    do {
      cx=Math.floor(Math.random()*cols);
      cy=Math.floor(Math.random()*rows);
      attempts++;
    } while(attempts<200 && (cx+cy)<6); // Manhattan dist from (0,0) >= 6
    const hunter = i<hunterCount;
    const patrol = !hunter && i<hunterCount+patrolCount;
    const statue = !hunter && !patrol && i<hunterCount+patrolCount+statueCount;
    // Snap pixel position to exact cell center using current size
    const enemy = {
      cx, cy,
      x:(cx+0.5)*size,
      y:(cy+0.5)*size,
      path:[], pathTimer:0, hunter, patrol, statue
    };
    if (hunter) {
      // Arranca deambulando, sin haber visto al jugador todavía.
      const dir = HUNTER_DIRS[Math.floor(Math.random()*HUNTER_DIRS.length)];
      enemy.facingX = dir.x;
      enemy.facingY = dir.y;
      enemy.huntState = 'wander';
      enemy.lostSightTimer = HUNTER_LOSE_SIGHT_TIME;
    } else if (patrol) {
      // Ruta fija de patrulla: entre 8 y 13 pasos, recorrida en loop.
      enemy.patrolRoute = generatePatrolRoute(cx, cy, 8+Math.floor(Math.random()*6));
      enemy.patrolIndex = 0;
    }
    enemies.push(enemy);
  }

  spawnPowerups();
  spawnHazards(cfg);

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
    if(!hasKey) {
      // Salida bloqueada: falta encontrar la llave. Avisa con un toast
      // limitado en frecuencia para no spamear mientras estás parado ahí.
      if(lockedToastTimer<=0) {
        showToast('🔒 NECESITÁS LA LLAVE');
        lockedToastTimer=2.0;
      }
      return;
    }

    running=false;
    clearInterval(timerInterval);
    sfxWin();
    spawnParticles(player.x,player.y,'#00ff88',30,150,1);

    // Bonus
    const bonus=Math.max(0,1000-timerSeconds*5);
    addScore(bonus+currentLevel*100);

    // Racha sin perder vidas: si este nivel se completó sin ningún golpe,
    // suma a la racha y otorga un bonus creciente a partir del 2do nivel seguido.
    if(!levelHitOccurred) { winStreak++; } else { winStreak=0; }
    const streakBonus = winStreak>1 ? (winStreak-1)*150 : 0;
    if(streakBonus>0) addScore(streakBonus);

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
    const streakEl=document.getElementById('finalStreak');
    if(streakEl) streakEl.textContent=String(winStreak).padStart(2,'0');
    const streakNote=document.getElementById('streakBonusNote');
    if(streakNote) streakNote.classList.toggle('hidden', streakBonus<=0);

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
