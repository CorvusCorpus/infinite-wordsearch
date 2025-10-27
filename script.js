const canvas = document.getElementById('gameCanvas');
const wordDisplay = document.getElementById("wordText");
const ctx = canvas.getContext('2d');

const GRID_SIZE = 10;
const CELL_SIZE = canvas.width / GRID_SIZE;
const HIT_RADIUS = CELL_SIZE * 0.4;
let grid = [];

let shufflePoints = 0;
const shuffleThreshold = 3000;

const shuffleBarOuter = document.getElementById("shuffleBarOuter");
const shuffleBarInner = document.getElementById("shuffleBarInner");
const shuffleLabel = document.getElementById("shuffleLabel");

let pointerCanvasPos = null;        // real pointer position relative to canvas
let smoothedPointer = null;         // current animated position relative to canvas
let animating = false;
const SMOOTH_FACTOR = 0.18;

let fallingTiles = []; // { x, fromY, toY, letter, progress, duration, currentY }
let movingTiles = [];
let lastAnimTime = null;

const letterValues = {
  E: 1, A: 1, I: 1, O: 1, N: 1, R: 1, T: 1, L: 1, S: 1, U: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10
};

const letterProbabilities = Object.entries(letterValues).map(([letter, value]) => ({
  letter,
  weight: 1 / value
}));
function randomLetter() {
  const totalWeight = letterProbabilities.reduce((sum, l) => sum + l.weight, 0);
  let r = Math.random() * totalWeight;
  for (const l of letterProbabilities) {
    r -= l.weight;
    if (r <= 0) return l.letter;
  }
  return letterProbabilities[letterProbabilities.length - 1].letter; // fallback
}

let totalScore = 0;
let displayedScore = 0; 
let dictionaryData = {}; 

function addPoints(points) {
  totalScore += points;
  animateScore();
}

function animateScore() {
  const start = displayedScore;
  const end = totalScore;
  const duration = 600; // milliseconds
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    displayedScore = Math.floor(start + (end - start) * progress);
    document.getElementById("scoreDisplay").textContent = displayedScore;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      displayedScore = end;
    }
  }

  requestAnimationFrame(update);
}

function calculateScore(word) {
  const base = word.length * 10;
  const letterBonus = [...word].reduce((sum, ch) => sum + (letterValues[ch.toUpperCase()] || 1), 0);
  const rarityMultiplier = 1 + (letterBonus / (word.length * 10)); // more rare letters, higher multiplier
  const firstTimeBonus = (word in dictionaryData) ? 1 : 2; // 2x if new word
  const score = Math.floor(base * rarityMultiplier);
  dictionaryData[word] = {score: score, timestamp: Date.now()};
  return score * firstTimeBonus;
}


function initGrid() {
  grid = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    let row = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      row.push(randomLetter());
    }
    grid.push(row);
  }
}

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // build a Set of destination keys (spread the arrays so Set contains strings, not arrays)
  const animatingDest = new Set([
    ...fallingTiles.map(t => `${t.x},${t.toY}`),
    ...movingTiles.map(t => `${t.toX},${t.toY}`)
  ]);

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = `${x},${y}`;
      const isSelected = selectedCells.some(c => c.x === x && c.y === y);

      // draw cell background and border
      ctx.fillStyle = isSelected ? "#333" : "#222";
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

      // only draw the static letter if this destination is not being animated
      if (!animatingDest.has(key) && grid[y][x]) {
        ctx.fillStyle = isSelected ? "#fff" : "white";
        ctx.fillText(grid[y][x], x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2);
      }
    }
  }

  // draw falling tiles (on top)
  for (const t of fallingTiles) {
    const px = t.x * CELL_SIZE + CELL_SIZE / 2;
    const py = (t.currentY * CELL_SIZE) + CELL_SIZE / 2;
    ctx.fillStyle = "white";
    ctx.fillText(t.letter, px, py);
  }

  // draw moving tiles (shuffle) on top
  for (const t of movingTiles) {
    const px = (t.currentX * CELL_SIZE) + CELL_SIZE / 2;
    const py = (t.currentY * CELL_SIZE) + CELL_SIZE / 2;
    ctx.fillStyle = "white";
    ctx.fillText(t.letter, px, py);
  }

  // Draw connecting line
  if (selectedCells.length > 0) {
    ctx.strokeStyle = "rgba(0, 255, 0, 0.6)";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const first = selectedCells[0];
    ctx.moveTo(first.x * CELL_SIZE + CELL_SIZE / 2, first.y * CELL_SIZE + CELL_SIZE / 2);

    for (let i = 1; i < selectedCells.length; i++) {
      const c = selectedCells[i];
      ctx.lineTo(c.x * CELL_SIZE + CELL_SIZE / 2, c.y * CELL_SIZE + CELL_SIZE / 2);
    }

    if (isDragging && smoothedPointer) {
      ctx.lineTo(smoothedPointer.x, smoothedPointer.y);
    }

    ctx.stroke();
  }
}

function isValidWord(word) {
  return wordbank[word.toLowerCase()] === 1;
}

function setPointerFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  pointerCanvasPos = { x: relX, y: relY };
  if (!smoothedPointer) smoothedPointer = { x: relX, y: relY };
  startAnimationLoop();
}

let wordbank = {};

fetch('words_dictionary.json')
  .then(r => r.json())
  .then(data => {
    wordbank = data;
    console.log("Loaded", Object.keys(wordbank).length, "words");
  })
  .catch(err => console.error("Wordbank load error:", err));

let isDragging = false;
let selectedCells = []; // array of {x, y}
let currentWord = "";

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup', onPointerUp);

// For mobile/touch
canvas.addEventListener('touchstart', e => onPointerDown(e.touches[0]));
canvas.addEventListener('touchmove', e => onPointerMove(e.touches[0]));
canvas.addEventListener('touchend', onPointerUp);

function getCellFromCoords(x, y) {
  const rect = canvas.getBoundingClientRect();
  const relX = x - rect.left;
  const relY = y - rect.top;

  // Compute grid indices based on coarse location
  const cx = Math.floor(relX / CELL_SIZE);
  const cy = Math.floor(relY / CELL_SIZE);

  // Check surrounding cells (to handle edge cases near boundaries)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) continue;

      const centerX = gx * CELL_SIZE + CELL_SIZE / 2;
      const centerY = gy * CELL_SIZE + CELL_SIZE / 2;
      const dist = Math.hypot(centerX - relX, centerY - relY);

      if (dist <= HIT_RADIUS) {
        return { x: gx, y: gy };
      }
    }
  }

  return null;
}

function onPointerDown(e) {
  isDragging = true;
  selectedCells = [];
  currentWord = "";

  setPointerFromClient(e.clientX, e.clientY);

  const cell = getCellFromCoords(e.clientX, e.clientY);
  if (cell) selectCell(cell);
}

function onPointerMove(e) {
  if (!isDragging) return;

  setPointerFromClient(e.clientX, e.clientY);

  const cell = getCellFromCoords(e.clientX, e.clientY);
  if (!cell) return;

  // Only add if new and adjacent
  const last = selectedCells[selectedCells.length - 1];
  if (!last || isAdjacent(last, cell)) selectCell(cell);
}

function onPointerUp() {
  if (!isDragging) return;
  isDragging = false;

  pointerCanvasPos = null;

  const word = currentWord.toLowerCase();

  if (wordbank[word] && word.length >= 4) {
    const isNew = !(word in dictionaryData);
    const points = calculateScore(word);
    addPoints(points);

    showWordPopup(word, points, isNew);

    if (isNew && !dictionaryData[word]) {
      dictionaryData[word] = {
        score: points,
        timestamp: Date.now()
      };
    }

    shufflePoints += points;
    if (shufflePoints > shuffleThreshold) shufflePoints = shuffleThreshold;
    
    updateShuffleMeter();
    clearSelectedLetters();
    animateGravityAndRefill();
    refillGrid();
    drawGrid();
    updateDictionaryDisplay();
    saveGame();
  } else {
    if(word.length > 0)
        showFailedWordPopup(word);
  }

  selectedCells = [];
  currentWord = "";
  updateWordDisplay();
  drawGrid();
}
function isAdjacent(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
}

function selectCell(cell) {
  const last = selectedCells[selectedCells.length - 2];
  if (last && last.x === cell.x && last.y === cell.y) {
    selectedCells.pop();
    currentWord = currentWord.slice(0, -1);
    updateWordDisplay();
    drawGrid();
    return;
  }
  if (selectedCells.some(c => c.x === cell.x && c.y === cell.y)) return;
  selectedCells.push(cell);
  currentWord += grid[cell.y][cell.x];
  updateWordDisplay();
  drawGrid();
}

function startAnimationLoop() {
  if (animating) return;
  animating = true;
  requestAnimationFrame(animationStep);
}

function animationStep(timestamp) {
  // handle delta time
  if (!lastAnimTime) lastAnimTime = timestamp;
  const dt = Math.min(40, timestamp - lastAnimTime); // cap to avoid big jumps
  lastAnimTime = timestamp;

  // determine pointer target (same as before)
  let target = null;
  if (pointerCanvasPos) {
    target = pointerCanvasPos;
  } else if (selectedCells.length > 0) {
    const last = selectedCells[selectedCells.length - 1];
    target = {
      x: last.x * CELL_SIZE + CELL_SIZE / 2,
      y: last.y * CELL_SIZE + CELL_SIZE / 2
    };
  }

  if (!smoothedPointer && target) smoothedPointer = { x: target.x, y: target.y };
  if (smoothedPointer && target) {
    smoothedPointer.x += (target.x - smoothedPointer.x) * SMOOTH_FACTOR;
    smoothedPointer.y += (target.y - smoothedPointer.y) * SMOOTH_FACTOR;
  }

  // update falling tiles
  let anyFalling = false;
  for (let i = fallingTiles.length - 1; i >= 0; i--) {
    const t = fallingTiles[i];
    t.progress += dt / t.duration;
    if (t.progress > 1) t.progress = 1;
    // ease out cubic for nicer feel
    const p = 1 - Math.pow(1 - t.progress, 3);
    t.currentY = t.fromY + (t.toY - t.fromY) * p;
    if (t.progress >= 1) {
      // finished - ensure final position is exact and remove
      t.currentY = t.toY;
      fallingTiles.splice(i, 1);
    } else {
      anyFalling = true;
    }
  }

  // update moving (shuffle) tiles
  let anyMoving = false;
  for (let i = movingTiles.length - 1; i >= 0; i--) {
    const t = movingTiles[i];
    t.progress += dt / t.duration;
    if (t.progress > 1) t.progress = 1;
    const p = 1 - Math.pow(1 - t.progress, 3);
    t.currentX = t.fromX + (t.toX - t.fromX) * p;
    t.currentY = t.fromY + (t.toY - t.fromY) * p;
    if (t.progress >= 1) {
      t.currentX = t.toX;
      t.currentY = t.toY;
      movingTiles.splice(i, 1);
    } else {
      anyMoving = true;
    }
  }

  // existing per-cell scale animations (if any)
  let anyScaling = false;
  if (typeof selectedVisuals !== "undefined") {
    for (const key of Object.keys(selectedVisuals)) {
      const v = selectedVisuals[key];
      const diff = v.target - v.scale;
      if (Math.abs(diff) > 0.001) {
        v.scale += diff * SCALE_SMOOTH;
        anyScaling = true;
      } else {
        v.scale = v.target;
        if (v.scale === 1) delete selectedVisuals[key];
      }
    }
  }

  drawGrid();

  // continue while pointer active, smoothed pointer not yet at target, scaling or falling/moving still active
  let continueLoop = false;
  if (pointerCanvasPos) continueLoop = true;
  if (target && smoothedPointer) {
    const dx = Math.abs(smoothedPointer.x - target.x);
    const dy = Math.abs(smoothedPointer.y - target.y);
    if (dx * dx + dy * dy > 0.5) continueLoop = true;
  }
  if (anyScaling || anyFalling || anyMoving) continueLoop = true;

  if (continueLoop) {
    requestAnimationFrame(animationStep);
  } else {
    animating = false;
    smoothedPointer = null;
    lastAnimTime = null;
  }
}

function updateWordDisplay() {
  if (currentWord.length === 0) {
    wordDisplay.textContent = "—";
  } else {
    wordDisplay.textContent = currentWord;
  }
}

function clearSelectedLetters() {
  for (const {x, y} of selectedCells) {
    grid[y][x] = null;
  }
}

function animateGravityAndRefill() {
  fallingTiles = [];
  // For each column compute compacted column and final grid column
  for (let x = 0; x < GRID_SIZE; x++) {
    // collect existing letters in this column (top -> bottom)
    const col = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      if (grid[y][x] !== null && grid[y][x] !== undefined) col.push({letter: grid[y][x], y});
    }

    const finalStart = GRID_SIZE - col.length; // index where existing letters start
    // clear column in logical grid first
    for (let y = 0; y < GRID_SIZE; y++) grid[y][x] = null;

    // place existing letters into final positions and create falling tiles if moved
    for (let i = 0; i < col.length; i++) {
      const letter = col[i].letter;
      const oldY = col[i].y;
      const newY = finalStart + i;
      grid[newY][x] = letter; // logical final location

      if (oldY !== newY) {
        const dropDistance = Math.abs(newY - oldY);
        const duration = 160 + dropDistance * 60;
        fallingTiles.push({
          x,
          fromY: oldY,
          toY: newY,
          letter,
          progress: 0,
          duration,
          currentY: oldY
        });
      } else {
        // stationary letter remains; no falling tile needed
      }
    }

    // now add new letters at the top for empty slots and animate them falling from above
    const numNew = finalStart;
    for (let i = 0; i < numNew; i++) {
      const targetY = i;
      const newLetter = randomLetter();
      grid[targetY][x] = newLetter; // logical final location
      // animate from above (start off-screen at - (numNew - i) so grouping looks natural)
      const fromY = - (numNew - i);
      const duration = 220 + (targetY + 1) * 40;
      fallingTiles.push({
        x,
        fromY,
        toY: targetY,
        letter: newLetter,
        progress: 0,
        duration,
        currentY: fromY
      });
    }
  }

  // start animation loop
  lastAnimTime = null;
  startAnimationLoop();
}

function applyGravity() {
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = GRID_SIZE - 1; y >= 0; y--) {
      if (grid[y][x] === null) {
        // find nearest non-null above
        for (let k = y - 1; k >= 0; k--) {
          if (grid[k][x] !== null) {
            grid[y][x] = grid[k][x];
            grid[k][x] = null;
            break;
          }
        }
      }
    }
  }
}

function refillGrid() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x] === null) {
        grid[y][x] = randomLetter();
      }
    }
  }
}

function showWordPopup(word, points, isNew) {
  const container = document.getElementById("wordPopups");

  const popup = document.createElement("div");
  popup.style.top = `${-160}px`;
  popup.className = "wordPopup" + (isNew ? " newWord" : "");
  if (word === "SHUFFLE!") {
    popup.textContent = `🔀 SHUFFLE!`;
  } else {
    popup.textContent = `✅ ${word.toUpperCase()}  +${points} pts` + (isNew ? "  (NEW!)" : "");
  }

  container.appendChild(popup);

  // Auto-remove after animation
  setTimeout(() => popup.remove(), 2400);
}

function showFailedWordPopup(word) {
  const container = document.getElementById("wordPopups");

  const popup = document.createElement("div");
  popup.style.top = `${-140}px`;
  popup.className = "wordPopup invalidWord";
  popup.textContent = `❌ ${word.toUpperCase()}` + (word.length >=4 ? " is not valid!" : " is too short!");

  container.appendChild(popup);

  // Auto-remove after animation
  setTimeout(() => popup.remove(), 2400);
}


let sortMode = "alphabetical";

function updateDictionaryDisplay() {
  const listContainer = document.getElementById("dictionaryList");
  listContainer.innerHTML = "";

  const entries = Object.entries(dictionaryData);

  if (sortMode === "alphabetical") {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  } else if (sortMode === "recent") {
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
  } else if (sortMode === "score") {
    entries.sort((a, b) => b[1].score - a[1].score);
  }

  for (const [word, data] of entries) {
    const div = document.createElement("div");
    div.className = "dictionaryEntry";

    const wordSpan = document.createElement("span");
    wordSpan.className = "wordText";
    wordSpan.textContent = word.toUpperCase();

    const scoreSpan = document.createElement("span");
    scoreSpan.className = "scoreText";
    scoreSpan.textContent = `${data.score} pts`;
    
    document.getElementById("dictionaryCount").textContent = Object.keys(dictionaryData).length > 0 ? `Dictionary (${ Object.keys(dictionaryData).length})` : "Dictionary";
    div.appendChild(wordSpan);
    div.appendChild(scoreSpan);

    listContainer.appendChild(div);
  }
}

const toggleButton = document.getElementById("toggleOrder");
toggleButton.addEventListener("click", () => {
  if (sortMode === "alphabetical") {
    sortMode = "recent";
    toggleButton.textContent = "Sort: Recent";
  } else if (sortMode === "recent") {
    sortMode = "score";
    toggleButton.textContent = "Sort: Score";
  } else { // score
    sortMode = "alphabetical";
    toggleButton.textContent = "Sort: Alphabetical";
  }

  updateDictionaryDisplay();
});

const STORAGE_KEY = 'infinite_wordsearch_game_state_v0.1';
// Save the current game state
function saveGame() {
    const state = {
        totalScore: totalScore,
        dictionaryData: {},
        grid: grid,
        shufflePoints: shufflePoints ? shufflePoints : 0
    };

    for (const word in dictionaryData) {
        let timestamp = dictionaryData[word].timestamp;
        // Ensure it's a Date before calling toISOString
        if (!(timestamp instanceof Date)) {
            timestamp = new Date(timestamp);
        }
        state.dictionaryData[word] = {
            score: dictionaryData[word].score,
            timestamp: timestamp.toISOString()
        };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Load the game state
function loadGame() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return; // Nothing saved yet

    const state = JSON.parse(saved);
    totalScore = state.totalScore;
    displayedScore = totalScore;
    grid = state.grid;
    shufflePoints = state.shufflePoints;

    dictionaryData = {};
    for (const word in state.dictionaryData) {
        dictionaryData[word] = {
            score: state.dictionaryData[word].score,
            timestamp: new Date(state.dictionaryData[word].timestamp)
        };
    }

    document.getElementById("scoreDisplay").textContent = totalScore;
    updateDictionaryDisplay();
    updateShuffleMeter();
}

function resetGame() {
    localStorage.removeItem(STORAGE_KEY);
    totalScore = 0;
    displayedScore = 0;
    document.getElementById("scoreDisplay").textContent = 0;
    dictionaryData = {};
    shufflePoints = 0;
    document.getElementById("dictionaryCount").textContent = "Dictionary (0)";
    grid = [];
    initGrid();
    updateDictionaryDisplay();
    updateShuffleMeter();
    drawGrid();
}

function updateShuffleMeter() {
  const progress = (shufflePoints / shuffleThreshold) * 100;
  shuffleBarInner.style.width = `${progress}%`;
  if (shuffleLabel) shuffleLabel.textContent = `Shuffle (${shufflePoints} / ${shuffleThreshold})`;

  if (shufflePoints >= shuffleThreshold) {
    shuffleBarOuter.classList.add("ready");
    shuffleBarOuter.setAttribute('aria-disabled', 'false');
  } else {
    shuffleBarOuter.classList.remove("ready");
    shuffleBarOuter.setAttribute('aria-disabled', 'true');
  }
}

shuffleBarOuter.addEventListener("click", () => {
  if (shufflePoints < shuffleThreshold) return;

  // create identity list so duplicates are preserved
  const flat = grid.flat();
  const original = flat.map((letter, idx) => ({ letter, fromIndex: idx }));
  // shuffle a copy
  const shuffled = original.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // build final logical grid and moving tiles
  movingTiles = [];
  const finalGrid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

  for (let toIdx = 0; toIdx < shuffled.length; toIdx++) {
    const obj = shuffled[toIdx];
    const fromIdx = obj.fromIndex;
    const toX = toIdx % GRID_SIZE;
    const toY = Math.floor(toIdx / GRID_SIZE);
    finalGrid[toY][toX] = obj.letter;

    const fromX = fromIdx % GRID_SIZE;
    const fromY = Math.floor(fromIdx / GRID_SIZE);

    if (fromX !== toX || fromY !== toY) {
      const dist = Math.hypot(toX - fromX, toY - fromY);
      const duration = Math.max(220, 160 + dist * 90);
      movingTiles.push({
        fromX, fromY, toX, toY,
        letter: obj.letter,
        progress: 0,
        duration,
        currentX: fromX,
        currentY: fromY
      });
    }
  }

  // set logical grid to final state immediately so game logic sees final configuration
  grid = finalGrid;

  // Reset the meter
  shufflePoints = 0;
  updateShuffleMeter();

  // start animation loop to animate moving tiles
  lastAnimTime = null;
  startAnimationLoop();

  // Optional visual feedback
  showWordPopup("SHUFFLE!", 0, false);
});

const resetBtn = document.getElementById("resetButton");
const modal = document.getElementById("resetConfirm");
const confirmBtn = document.getElementById("confirmReset");
const cancelBtn = document.getElementById("cancelReset");

resetBtn.addEventListener("click", () => {
  modal.classList.remove("hidden");
});

confirmBtn.addEventListener("click", () => {
  resetGame();
  modal.classList.add("hidden");
});

cancelBtn.addEventListener("click", () => {
  modal.classList.add("hidden");
});

initGrid();
loadGame();
drawGrid();