const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const rows = 25;
const cols = 25;
const baseSize = 25;
let size = baseSize;

let maze = null;
let keys = {};
let player, end, enemies = [];
let timer = 0;
let interval;
let running = false;

// Ajuste responsive
function resizeCanvas() {
    const maxWidth = window.innerWidth - 20;
    const maxHeight = window.innerHeight - 240;
    size = Math.floor(Math.min(maxWidth / cols, maxHeight / rows));
    canvas.width = size * cols;
    canvas.height = size * rows;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// INPUT teclado
document.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
document.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// INPUT táctil - Touchpad
let touchActive = false;
let touchCenterX, touchCenterY;
const touchpad = document.getElementById('touchpad');

function updateTouchDirection(clientX, clientY) {
    const rect = touchpad.getBoundingClientRect();
    touchCenterX = rect.left + rect.width / 2;
    touchCenterY = rect.top + rect.height / 2;
    const dx = clientX - touchCenterX;
    const dy = clientY - touchCenterY;
    const distance = Math.hypot(dx, dy);
    const maxDistance = rect.width / 2 - 15; // para no salir del borde

    const clampedDistance = Math.min(distance, maxDistance);
    const angle = Math.atan2(dy, dx);
    const indicatorX = Math.cos(angle) * clampedDistance;
    const indicatorY = Math.sin(angle) * clampedDistance;

    const indicator = document.getElementById('touchIndicator');
    indicator.style.transform = `translate(${indicatorX - 15}px, ${indicatorY - 15}px)`; // -15 para centrar

    if (distance > 10) { // threshold para evitar movimientos pequeños
        const angleDeg = angle * 180 / Math.PI;
        // Reset keys
        keys["arrowup"] = false;
        keys["arrowdown"] = false;
        keys["arrowleft"] = false;
        keys["arrowright"] = false;

        if (angleDeg >= -45 && angleDeg < 45) keys["arrowright"] = true; // right
        else if (angleDeg >= 45 && angleDeg < 135) keys["arrowdown"] = true; // down
        else if (angleDeg >= 135 || angleDeg < -135) keys["arrowleft"] = true; // left
        else keys["arrowup"] = true; // up
    } else {
        // Si cerca del centro, no mover
        keys["arrowup"] = false;
        keys["arrowdown"] = false;
        keys["arrowleft"] = false;
        keys["arrowright"] = false;
    }
}

touchpad.addEventListener('touchstart', e => {
    e.preventDefault();
    touchActive = true;
    const touch = e.touches[0];
    updateTouchDirection(touch.clientX, touch.clientY);
});

touchpad.addEventListener('touchmove', e => {
    e.preventDefault();
    if (touchActive) {
        const touch = e.touches[0];
        updateTouchDirection(touch.clientX, touch.clientY);
    }
});

touchpad.addEventListener('touchend', e => {
    e.preventDefault();
    touchActive = false;
    keys["arrowup"] = false;
    keys["arrowdown"] = false;
    keys["arrowleft"] = false;
    keys["arrowright"] = false;
    const indicator = document.getElementById('touchIndicator');
    indicator.style.transform = 'translate(-50%, -50%)';
});

// Genera laberinto
function generateMaze() {
    let grid = [];
    for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
            grid[r][c] = { visited: false, walls: [true,true,true,true] };
        }
    }
    function shuffle(a){ return a.sort(()=>Math.random()-0.5); }
    function carve(r,c){
        grid[r][c].visited = true;
        let dirs = shuffle([[-1,0,0],[0,1,1],[1,0,2],[0,-1,3]]);
        for (let [dr,dc,w] of dirs){
            let nr = r + dr, nc = c + dc;
            if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&!grid[nr][nc].visited){
                grid[r][c].walls[w] = false;
                grid[nr][nc].walls[(w+2)%4] = false;
                carve(nr,nc);
            }
        }
    }
    carve(0,0);
    return grid;
}

// Vecinos válidos
function getNeighbors(cx, cy) {
    let cell = maze[cy][cx];
    let neighbors = [];
    if(!cell.walls[0] && cy>0) neighbors.push({x:cx,y:cy-1,dir:0});
    if(!cell.walls[1] && cx<cols-1) neighbors.push({x:cx+1,y:cy,dir:1});
    if(!cell.walls[2] && cy<rows-1) neighbors.push({x:cx,y:cy+1,dir:2});
    if(!cell.walls[3] && cx>0) neighbors.push({x:cx-1,y:cy,dir:3});
    return neighbors;
}

// Colisiones
function isColliding(x,y){
    if(!maze) return true;
    let c=Math.floor(x/size), r=Math.floor(y/size);
    if(c<0||r<0||c>=cols||r>=rows) return true;
    let cell = maze[r][c], offsetX=x%size, offsetY=y%size;
    if(cell.walls[0] && offsetY<2) return true;
    if(cell.walls[2] && offsetY>size-2) return true;
    if(cell.walls[3] && offsetX<2) return true;
    if(cell.walls[1] && offsetX>size-2) return true;
    return false;
}

// Update jugador y enemigos
function update() {
    if(!running||!maze) return;
    let speed = 2, newX = player.x, newY = player.y;
    if(keys["arrowup"]||keys["w"]) newY -= speed;
    if(keys["arrowdown"]||keys["s"]) newY += speed;
    if(keys["arrowleft"]||keys["a"]) newX -= speed;
    if(keys["arrowright"]||keys["d"]) newX += speed;

    if(!isColliding(newX, player.y)) player.x = newX;
    if(!isColliding(player.x, newY)) player.y = newY;

    player.x = Math.max(0, Math.min(canvas.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height, player.y));

    // Enemigos
    enemies.forEach(e=>{
        if(!e.target){
            let neighbors = getNeighbors(e.cx,e.cy);
            if(neighbors.length>1 && e.lastDir!==null)
                neighbors = neighbors.filter(n=>(n.dir+2)%4!==e.lastDir);
            let next = neighbors[Math.floor(Math.random()*neighbors.length)];
            if(next){ e.target=next; e.lastDir=next.dir; }
        }
        if(e.target){
            let targetX = (e.target.x + 0.5) * size;
            let targetY = (e.target.y + 0.5) * size;
            let dx = targetX - e.x, dy = targetY - e.y;
            let dist = Math.hypot(dx,dy), speedE = 1.5;
            if(dist<speedE){ e.x=targetX; e.y=targetY; e.cx=e.target.x; e.cy=e.target.y; e.target=null; }
            else { e.x += dx/dist*speedE; e.y += dy/dist*speedE; }
        }
        if(Math.hypot(player.x-e.x,player.y-e.y)<10) gameOver();
    });

    checkWin();
}

// Dibujo laberinto
function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!maze) return;
    ctx.strokeStyle="white";
    for(let r=0;r<rows;r++){
        let row = maze[r]; if(!row) continue;
        for(let c=0;c<cols;c++){
            let cell=row[c]; if(!cell) continue;
            let x=c*size, y=r*size;
            ctx.beginPath();
            if(cell.walls[0]) ctx.moveTo(x,y), ctx.lineTo(x+size,y);
            if(cell.walls[1]) ctx.moveTo(x+size,y), ctx.lineTo(x+size,y+size);
            if(cell.walls[2]) ctx.moveTo(x,y+size), ctx.lineTo(x+size,y+size);
            if(cell.walls[3]) ctx.moveTo(x,y), ctx.lineTo(x,y+size);
            ctx.stroke();
        }
    }
    ctx.fillStyle="green"; ctx.fillRect(end.x-6,end.y-6,12,12);
    ctx.fillStyle="red"; ctx.beginPath(); ctx.arc(player.x,player.y,6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="yellow"; enemies.forEach(e=>{ ctx.beginPath(); ctx.arc(e.x,e.y,6,0,Math.PI*2); ctx.fill(); });
}

// LOOP
function loop(){ update(); draw(); requestAnimationFrame(loop); }

// FUNCIONES DEL JUEGO
function startGame(){
    maze = generateMaze();
    player = {x: size/2, y: size/2};
    end = {x: (cols*size)-size/2, y: (rows*size)-size/2};

    enemies = [];
    for(let i=0;i<5;i++){
        let cx = Math.floor(Math.random()*cols);
        let cy = Math.floor(Math.random()*rows);
        enemies.push({cx, cy, x:(cx+0.5)*size, y:(cy+0.5)*size, target:null, lastDir:null});
    }

    timer=0; document.getElementById("timer").textContent=0;
    clearInterval(interval);
    interval = setInterval(()=>{ timer++; document.getElementById("timer").textContent=timer; },1000);

    document.getElementById("menu").classList.remove("active");
    document.getElementById("victory").classList.remove("active");
    document.getElementById("gameover").classList.remove("active");
    document.getElementById("game").classList.add("active");

    resizeCanvas();
    running = true;
}

function checkWin(){
    if(Math.hypot(player.x-end.x, player.y-end.y)<10){
        running=false; clearInterval(interval);
        document.getElementById("finalTime").textContent = timer;
        document.getElementById("game").classList.remove("active");
        document.getElementById("victory").classList.add("active");
    }
}

function gameOver(){
    running=false; clearInterval(interval);
    document.getElementById("game").classList.remove("active");
    document.getElementById("gameover").classList.add("active");
}

function goMenu(){
    running=false; maze=null; clearInterval(interval);
    document.getElementById("game").classList.remove("active");
    document.getElementById("victory").classList.remove("active");
    document.getElementById("gameover").classList.remove("active");
    document.getElementById("menu").classList.add("active");
}

loop();