document.addEventListener("DOMContentLoaded", () => {
  const socket = io();

  // --- DOM ELEMENTS ---
  const dom = {
    lobby: document.getElementById("lobby-container"),
    game: document.getElementById("game-container"),
    createRoomBtn: document.getElementById("create-room-btn"),
    joinRoomBtn: document.getElementById("join-room-btn"),
    roomCodeInput: document.getElementById("room-code-input"),
    roomCodeDisplay: document.getElementById("room-code-display"),
    infoPanel: document.getElementById("info-panel"),
    myPlaceBoard: document.getElementById("my-place-board"),
    opponentShootBoard: document.getElementById("opponent-shoot-board"),
    rotateButton: document.getElementById("rotate-button"),
    readyButton: document.getElementById("ready-button"),
    controlsArea: document.getElementById("controls-area"),
    transition: {
      overlay: document.getElementById("transition-overlay"),
      title: document.getElementById("transition-title"),
      message: document.getElementById("transition-message"),
      button: document.getElementById("transition-button"),
    },
  };

  // --- GAME CONSTANTS ---
  const ROWS = 10;
  const COLS = 10;
  const PLANES_PER_PLAYER = 3;
  const DIRECTIONS = ["down", "left", "up", "right"];
  const BASE_PLANE_SHAPE = [
    [0, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
    [-1, 3],
    [0, 3],
    [1, 3],
  ];

  // --- GAME STATE ---
  let state;

  function resetGame() {
    state = {
      roomCode: null,
      playerIndex: -1,
      placeBoard: Array.from({ length: ROWS }, () => Array(COLS).fill(0)),
      shootBoard: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      planesPlaced: 0,
      phase: "LOBBY", // LOBBY, PLACE, SHOOT, GAMEOVER
      currentDirection: "down",
      lastHoveredCell: null,
      isMyTurn: false,
    };
    dom.lobby.style.display = "block";
    dom.game.style.display = "none";
    dom.roomCodeDisplay.textContent = "";
    dom.roomCodeInput.value = "";
  }

  // --- LOBBY LOGIC ---
  dom.createRoomBtn.addEventListener("click", () => socket.emit("createRoom"));
  dom.joinRoomBtn.addEventListener("click", () => {
    const roomCode = dom.roomCodeInput.value.toUpperCase();
    if (roomCode) socket.emit("joinRoom", roomCode);
  });

  socket.on("roomCreated", (roomCode) => {
    state.roomCode = roomCode;
    state.playerIndex = 0;
    dom.roomCodeDisplay.textContent = `Mã phòng: ${roomCode}. Đang chờ đối thủ...`;
  });

  socket.on("gameStart", () => {
    dom.lobby.style.display = "none";
    dom.game.style.display = "flex";
    state.phase = "PLACE";
    initGameBoards();
    updateUI();
  });

  socket.on("error", (message) => showTransition("Lỗi", message));

  // --- BOARD CREATION ---
  function initGameBoards() {
    createBoard(dom.myPlaceBoard, "place");
    createBoard(dom.opponentShootBoard, "shoot");
  }

  function createBoard(container, type) {
    container.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        cell.classList.add("grid-cell");
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.dataset.type = type;
        container.appendChild(cell);
      }
    }
    container.addEventListener("mouseover", handleCellHover);
    container.addEventListener("mouseout", handleCellMouseOut);
    container.addEventListener("click", handleCellClick);
  }

  // --- GAME LOGIC & HELPERS ---
  function getRotatedShape(direction) {
    switch (direction) {
      case "down":
        return BASE_PLANE_SHAPE;
      case "left":
        return BASE_PLANE_SHAPE.map(([x, y]) => [-y, x]);
      case "up":
        return BASE_PLANE_SHAPE.map(([x, y]) => [-x, -y]);
      case "right":
        return BASE_PLANE_SHAPE.map(([x, y]) => [y, -x]);
      default:
        return BASE_PLANE_SHAPE;
    }
  }

  function canPlacePlane(board, row, col, shape) {
    for (const [dx, dy] of shape) {
      const r = row + dy;
      const c = col + dx;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== 0) {
        return false;
      }
    }
    return true;
  }

  function placePlaneOnBoard(board, row, col, shape) {
    board[row + shape[0][1]][col + shape[0][0]] = "H";
    for (let i = 1; i < shape.length; i++) {
      const [dx, dy] = shape[i];
      board[row + dy][col + dx] = "B";
    }
  }

  // --- EVENT HANDLERS ---
  dom.rotateButton.addEventListener("click", () => {
    const currentIndex = DIRECTIONS.indexOf(state.currentDirection);
    state.currentDirection = DIRECTIONS[(currentIndex + 1) % DIRECTIONS.length];
    if (state.lastHoveredCell) {
      const { r, c } = state.lastHoveredCell;
      clearPreview();
      drawPreview(r, c);
    }
  });

  dom.readyButton.addEventListener("click", () => {
    state.phase = "WAITING";
    socket.emit("planesPlaced", {
      roomCode: state.roomCode,
      placeBoard: state.placeBoard,
    });
    updateUI();
  });

  dom.transition.button.addEventListener("click", () => {
    dom.transition.overlay.classList.add("hidden");
    if (state.phase === "GAMEOVER") {
      resetGame();
      location.reload(); // Easiest way to reset everything
    }
  });

  function handleCellClick(e) {
    const cell = e.target.closest(".grid-cell");
    if (!cell) return;
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    const type = cell.dataset.type;

    if (state.phase === "PLACE" && type === "place") {
      const shape = getRotatedShape(state.currentDirection);
      if (canPlacePlane(state.placeBoard, r, c, shape)) {
        placePlaneOnBoard(state.placeBoard, r, c, shape);
        state.planesPlaced++;
        clearPreview();
        updateUI();
      }
    }

    if (state.phase === "SHOOT" && type === "shoot" && state.isMyTurn) {
      if (state.shootBoard[r][c] === null) {
        socket.emit("shoot", { roomCode: state.roomCode, row: r, col: c });
      }
    }
  }

  function handleCellHover(e) {
    const cell = e.target.closest(".grid-cell");
    if (!cell || state.phase !== "PLACE" || cell.dataset.type !== "place")
      return;
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    state.lastHoveredCell = { r, c };
    drawPreview(r, c);
  }

  function handleCellMouseOut() {
    clearPreview();
    state.lastHoveredCell = null;
  }

  // --- SERVER EVENT HANDLERS ---
  socket.on("opponentReady", () => {
    showTransition(
      "Đối Thủ Đã Sẵn Sàng",
      "Đối thủ của bạn đã đặt xong máy bay. Hãy nhanh lên!"
    );
  });
  socket.on("shootingPhaseStart", () => {
    state.phase = "SHOOT";
    updateUI();
  });

  socket.on("newTurn", (playerIndex) => {
    state.isMyTurn = state.playerIndex === playerIndex;
    updateUI();
  });

  socket.on("startShooting", (startingPlayerIndex) => {
    state.phase = "SHOOT";
    state.isMyTurn = state.playerIndex === startingPlayerIndex;
    showTransition(
      "Trận Chiến Bắt Đầu!",
      `Người chơi ${startingPlayerIndex + 1} sẽ bắn trước.`
    );
    updateUI();
  });

  socket.on("shotResult", ({ shooterIndex, row, col, result }) => {
    const isMyShot = shooterIndex === state.playerIndex;
    state.isMyTurn = !isMyShot; // Đổi lượt

    if (isMyShot) {
      // Mình bắn
      state.shootBoard[row][col] = result;
    } else {
      // Đối thủ bắn vào bàn của mình
      state.placeBoard[row][col] = result;
    }
    updateUI();
  });

  socket.on("gameOver", (winnerIndex) => {
    state.phase = "GAMEOVER";
    const message =
      winnerIndex === state.playerIndex
        ? "Bạn đã chiến thắng!"
        : "Bạn đã thua cuộc.";
    showTransition("TRÒ CHƠI KẾT THÚC", message, "Chơi Lại");
    updateUI();
  });

  socket.on("opponentLeft", () => {
    if (state.phase !== "GAMEOVER") {
      showTransition(
        "Đối Thủ Đã Thoát",
        "Bạn đã thắng do đối thủ thoát giữa chừng.",
        "Về Sảnh"
      );
      state.phase = "GAMEOVER";
    }
  });

  // --- PREVIEW & UI ---
  function drawPreview(row, col) {
    const shape = getRotatedShape(state.currentDirection);
    const isValid = canPlacePlane(state.placeBoard, row, col, shape);
    for (const [dx, dy] of shape) {
      const r = row + dy,
        c = col + dx;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        const cell = dom.myPlaceBoard.querySelector(
          `[data-row='${r}'][data-col='${c}']`
        );
        if (cell)
          cell.classList.add(
            isValid ? "cell-preview-valid" : "cell-preview-invalid"
          );
      }
    }
  }
  function clearPreview() {
    document
      .querySelectorAll(".grid-cell")
      .forEach((c) =>
        c.classList.remove("cell-preview-valid", "cell-preview-invalid")
      );
  }

  function updateInfo(text) {
    dom.infoPanel.textContent = text;
    dom.infoPanel.classList.remove("fade-in");
    void dom.infoPanel.offsetWidth;
    dom.infoPanel.classList.add("fade-in");
  }

  function showTransition(title, message, buttonText = "OK") {
    dom.transition.title.textContent = title;
    dom.transition.message.textContent = message;
    dom.transition.button.textContent = buttonText;
    dom.transition.overlay.classList.remove("hidden");
    dom.transition.overlay.classList.add("flex");
  }

  function renderBoard(container, boardData, type) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = container.querySelector(
          `[data-row='${r}'][data-col='${c}']`
        );
        if (!cell) continue;
        cell.className = "grid-cell"; // Reset
        const val = boardData[r][c];

        if (type === "place") {
          if (val === "H") cell.classList.add("cell-head");
          else if (val === "B") cell.classList.add("cell-placed");
          else if (val === "D") cell.classList.add("cell-hit-head"); // Bị bắn
          else if (val === "M") cell.classList.add("cell-miss"); // Bị bắn
        } else {
          // shoot board
          if (val === "D") cell.classList.add("cell-hit-head");
          else if (val === "B") cell.classList.add("cell-hit-body");
          else if (val === "M") cell.classList.add("cell-miss");
        }
      }
    }
  }

  function updateUI() {
    renderBoard(dom.myPlaceBoard, state.placeBoard, "place");
    renderBoard(dom.opponentShootBoard, state.shootBoard, "shoot");

    dom.controlsArea.style.display = state.phase === "PLACE" ? "flex" : "none";
    dom.readyButton.style.display =
      state.planesPlaced >= PLANES_PER_PLAYER ? "block" : "none";
    dom.myPlaceBoard.style.cursor =
      state.phase === "PLACE" ? "pointer" : "default";
    dom.opponentShootBoard.style.cursor =
      state.phase === "SHOOT" && state.isMyTurn ? "pointer" : "default";

    switch (state.phase) {
      case "PLACE":
        updateInfo(
          `Hãy đặt máy bay ${state.planesPlaced}/${PLANES_PER_PLAYER}`
        );
        break;
      case "WAITING":
        updateInfo("Đang chờ đối thủ đặt máy bay...");
        break;
      case "SHOOT":
        updateInfo(
          state.isMyTurn
            ? "Lượt của bạn! Hãy tấn công."
            : "Lượt của đối thủ. Xin chờ..."
        );
        break;
      case "GAMEOVER":
        updateInfo("TRÒ CHƠI KẾT THÚC!");
        break;
    }
  }

  // --- INITIALIZE GAME ---
  resetGame();
});
