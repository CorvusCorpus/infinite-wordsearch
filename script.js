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

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const isSelected = selectedCells.some(c => c.x === x && c.y === y);
      ctx.fillStyle = isSelected ? "#777" : "white";
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.fillText(grid[y][x], x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2);
    }
  }

  // Draw connecting line
  if (selectedCells.length > 1) {
    ctx.strokeStyle = "rgba(0, 255, 0, 0.6)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    const first = selectedCells[0];
    ctx.moveTo(first.x * CELL_SIZE + CELL_SIZE / 2, first.y * CELL_SIZE + CELL_SIZE / 2);
    for (let i = 1; i < selectedCells.length; i++) {
      const c = selectedCells[i];
      ctx.lineTo(c.x * CELL_SIZE + CELL_SIZE / 2, c.y * CELL_SIZE + CELL_SIZE / 2);
    }
    ctx.stroke();
  }
}

function isValidWord(word) {
  return wordbank[word.toLowerCase()] === 1;
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

  const cell = getCellFromCoords(e.clientX, e.clientY);
  if (cell) selectCell(cell);
}

function onPointerMove(e) {
  if (!isDragging) return;

  const cell = getCellFromCoords(e.clientX, e.clientY);
  if (!cell) return;

  // Only add if new and adjacent
  const last = selectedCells[selectedCells.length - 1];
  if (!last || isAdjacent(last, cell)) selectCell(cell);
}

function onPointerUp() {
  if (!isDragging) return;
  isDragging = false;

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
    applyGravity();
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
    
    document.getElementById("dictionaryCount").textContent =  Object.keys(dictionaryData).length > 0 ? `Dictionary (${ Object.keys(dictionaryData).length})` : "Dictionary";
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

  // Randomly shuffle all letter positions
  const flat = grid.flat();
  for (let i = flat.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [flat[i], flat[j]] = [flat[j], flat[i]];
  }

  // Rebuild the grid
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      grid[y][x] = flat[y * GRID_SIZE + x];
    }
  }

  // Reset the meter
  shufflePoints = 0;
  updateShuffleMeter();
  drawGrid();

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