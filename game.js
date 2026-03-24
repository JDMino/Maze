const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const rows = 25;
const cols = 25;
let size = 25;

let maze = null;
let keys = {};
let player, end, enemies = [];
let timer = 0;
let interval;
let running = false;

// 🛡️ ESCUDO
let shieldActive = true;
let shieldBlinking = false;
let shieldVisible = true;
let shieldTimer = 0;

// 📱 TOUCH
let touchActive = false;
let touchDx = 0, touchDy = 0;
const touchpad = document.getElementById('touchpad');

// ⏱️ DELTA
let lastTime = 0;

// RESPONSIVE
function resizeCanvas() {
    const maxWidth = window.innerWidth - 20;
    const maxHeight = window.innerHeight - 240;
    size = Math.floor(Math.min(maxWidth / cols, maxHeight / rows));
    canvas.width = size * cols;
    canvas.height = size * rows;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// INPUT
document.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
document.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// TOUCHPAD
function updateTouchDirection(clientX, clientY) {
    const rect = touchpad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = clientX - cx;
    const dy = clientY - cy;

    const dist = Math.hypot(dx, dy);
    const max = rect.width / 2 - 15;

    const clamped = Math.min(dist, max);
    const angle = Math.atan2(dy, dx);

    const ix = Math.cos(angle) * clamped;
    const iy = Math.sin(angle) * clamped;

    document.getElementById('touchIndicator').style.transform =
        `translate(${ix - 15}px, ${iy - 15}px)`;

    if (dist > 10) {
        const speed = 120;
        touchDx = Math.cos(angle) * speed;
        touchDy = Math.sin(angle) * speed;
    } else {
        touchDx = 0;
        touchDy = 0;
    }
}

touchpad.addEventListener('touchstart', e => {
    e.preventDefault();
    touchActive = true;
    const t = e.touches[0];
    updateTouchDirection(t.clientX, t.clientY);
});

touchpad.addEventListener('touchmove', e => {
    e.preventDefault();
    if (touchActive) {
        const t = e.touches[0];
        updateTouchDirection(t.clientX, t.clientY);
    }
});

touchpad.addEventListener('touchend', e => {
    e.preventDefault();
    touchActive = false;
    touchDx = 0;
    touchDy = 0;
    document.getElementById('touchIndicator').style.transform =
        'translate(-50%, -50%)';
});

// LABERINTO
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

// VECINOS
function getNeighbors(cx, cy) {
    let cell = maze[cy][cx];
    let n = [];
    if(!cell.walls[0] && cy>0) n.push({x:cx,y:cy-1,dir:0});
    if(!cell.walls[1] && cx<cols-1) n.push({x:cx+1,y:cy,dir:1});
    if(!cell.walls[2] && cy<rows-1) n.push({x:cx,y:cy+1,dir:2});
    if(!cell.walls[3] && cx>0) n.push({x:cx-1,y:cy,dir:3});
    return n;
}

// COLISIONES
function isColliding(x,y){
    if(!maze) return true;
    let c=Math.floor(x/size), r=Math.floor(y/size);
    if(c<0||r<0||c>=cols||r>=rows) return true;

    let cell = maze[r][c];
    let ox=x%size, oy=y%size;

    if(cell.walls[0] && oy<2) return true;
    if(cell.walls[2] && oy>size-2) return true;
    if(cell.walls[3] && ox<2) return true;
    if(cell.walls[1] && ox>size-2) return true;

    return false;
}

// 🧠 MOVIMIENTO SEGURO (FIX REAL)
function movePlayer(dx, dy, delta) {
    let steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * delta / 4);
    steps = Math.max(1, steps);

    let stepX = (dx * delta) / steps;
    let stepY = (dy * delta) / steps;

    for(let i=0;i<steps;i++){
        let nx = player.x + stepX;
        let ny = player.y + stepY;

        if(!isColliding(nx, ny)){
            player.x = nx;
            player.y = ny;
        } else {
            if(!isColliding(nx, player.y)) player.x = nx;
            if(!isColliding(player.x, ny)) player.y = ny;
        }
    }
}

// UPDATE
function update(delta) {
    if(!running||!maze) return;

    let dx = 0, dy = 0;
    const speed = 120;

    if(keys["arrowup"]||keys["w"]) dy -= speed;
    if(keys["arrowdown"]||keys["s"]) dy += speed;
    if(keys["arrowleft"]||keys["a"]) dx -= speed;
    if(keys["arrowright"]||keys["d"]) dx += speed;

    dx += touchDx;
    dy += touchDy;

    movePlayer(dx, dy, delta);

    // ESCUDO
    if (shieldBlinking) {
        shieldTimer -= delta;
        shieldVisible = !shieldVisible;

        if (shieldTimer <= 0) {
            shieldActive = false;
            shieldBlinking = false;
            shieldVisible = false;
        }
    }

    // ENEMIGOS
    enemies.forEach(e=>{
        if(!e.target){
            let n = getNeighbors(e.cx,e.cy);
            if(n.length>1 && e.lastDir!==null)
                n = n.filter(x=>(x.dir+2)%4!==e.lastDir);
            let next = n[Math.floor(Math.random()*n.length)];
            if(next){ e.target=next; e.lastDir=next.dir; }
        }

        if(e.target){
            let tx=(e.target.x+0.5)*size;
            let ty=(e.target.y+0.5)*size;

            let dx=tx-e.x, dy=ty-e.y;
            let dist=Math.hypot(dx,dy);

            const speedE=90;

            if(dist < speedE * delta){
                e.x=tx; e.y=ty;
                e.cx=e.target.x; e.cy=e.target.y;
                e.target=null;
            } else {
                e.x += dx/dist*speedE*delta;
                e.y += dy/dist*speedE*delta;
            }
        }

        if(Math.hypot(player.x-e.x,player.y-e.y)<10){
            if(shieldActive){
                if(!shieldBlinking){
                    shieldBlinking=true;
                    shieldTimer=3;
                }
            } else gameOver();
        }
    });

    checkWin();
}

// DRAW
function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!maze) return;

    ctx.strokeStyle="white";

    for(let r=0;r<rows;r++){
        for(let c=0;c<cols;c++){
            let cell=maze[r][c];
            let x=c*size, y=r*size;

            ctx.beginPath();
            if(cell.walls[0]) ctx.moveTo(x,y), ctx.lineTo(x+size,y);
            if(cell.walls[1]) ctx.moveTo(x+size,y), ctx.lineTo(x+size,y+size);
            if(cell.walls[2]) ctx.moveTo(x,y+size), ctx.lineTo(x+size,y+size);
            if(cell.walls[3]) ctx.moveTo(x,y), ctx.lineTo(x,y+size);
            ctx.stroke();
        }
    }

    ctx.fillStyle="green";
    ctx.fillRect(end.x-6,end.y-6,12,12);

    ctx.fillStyle="red";
    ctx.beginPath();
    ctx.arc(player.x,player.y,6,0,Math.PI*2);
    ctx.fill();

    if(shieldActive && shieldVisible){
        ctx.strokeStyle="cyan";
        ctx.lineWidth=2;
        ctx.beginPath();
        ctx.arc(player.x,player.y,12,0,Math.PI*2);
        ctx.stroke();
    }

    ctx.fillStyle="yellow";
    enemies.forEach(e=>{
        ctx.beginPath();
        ctx.arc(e.x,e.y,6,0,Math.PI*2);
        ctx.fill();
    });
}

// LOOP
function loop(t){
    let delta=(t-lastTime)/1000;
    lastTime=t;

    update(delta);
    draw();
    requestAnimationFrame(loop);
}

// START
function startGame(){
    maze = generateMaze();

    player = {x: size/2, y: size/2};
    end = {x:(cols*size)-size/2, y:(rows*size)-size/2};

    enemies=[];
    for(let i=0;i<5;i++){
        let cx=Math.floor(Math.random()*cols);
        let cy=Math.floor(Math.random()*rows);
        enemies.push({
            cx,cy,
            x:(cx+0.5)*size,
            y:(cy+0.5)*size,
            target:null,
            lastDir:null
        });
    }

    shieldActive=true;
    shieldBlinking=false;
    shieldVisible=true;

    timer=0;
    document.getElementById("timer").textContent=0;

    clearInterval(interval);
    interval=setInterval(()=>{
        timer++;
        document.getElementById("timer").textContent=timer;
    },1000);

    document.getElementById("menu").classList.remove("active");
    document.getElementById("game").classList.add("active");

    resizeCanvas();
    running=true;
}

function checkWin(){
    if(Math.hypot(player.x-end.x,player.y-end.y)<10){
        running=false;
        clearInterval(interval);
        document.getElementById("finalTime").textContent=timer;
        document.getElementById("game").classList.remove("active");
        document.getElementById("victory").classList.add("active");
    }
}

function gameOver(){
    running=false;
    clearInterval(interval);
    document.getElementById("game").classList.remove("active");
    document.getElementById("gameover").classList.add("active");
}

function goMenu(){
    running=false;
    maze=null;
    clearInterval(interval);
    document.getElementById("game").classList.remove("active");
    document.getElementById("victory").classList.remove("active");
    document.getElementById("gameover").classList.remove("active");
    document.getElementById("menu").classList.add("active");
}

requestAnimationFrame(loop);