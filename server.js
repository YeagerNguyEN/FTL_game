const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// --- SỬA LỖI QUAN TRỌNG ---
// Thêm cấu hình CORS để cho phép kết nối từ trang web trên Render
const io = new Server(server, {
  cors: {
    origin: "*", // Cho phép tất cả các tên miền, an toàn cho Render
    methods: ["GET", "POST"],
  },
});

// Phục vụ tệp index.html duy nhất
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = {};
const PLACEMENT_TIME_LIMIT = 30000; // 30 giây

const startShootingPhase = (roomCode) => {
  const room = rooms[roomCode];
  if (!room || room.state !== "placing") return;

  if (room.placementTimer) {
    clearTimeout(room.placementTimer);
    room.placementTimer = null;
  }

  room.state = "shooting";
  // Gửi sự kiện để client biết giai đoạn bắn bắt đầu
  io.to(roomCode).emit("shootingPhaseStart");
  // Gửi sự kiện lượt chơi đầu tiên
  io.to(roomCode).emit("newTurn", room.currentTurnIndex);
  console.log(
    `Phòng ${roomCode}: Bắt đầu bắn. Lượt của người chơi ${room.currentTurnIndex}.`
  );
};

io.on("connection", (socket) => {
  console.log(`Người dùng đã kết nối: ${socket.id}`);

  socket.on("createRoom", () => {
    let roomCode;
    do {
      roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      players: [
        { id: socket.id, playerIndex: 0, ready: false, placeBoard: null },
      ],
      state: "waiting",
      currentTurnIndex: 0,
    };

    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    console.log(`Phòng ${roomCode} đã được tạo bởi ${socket.id}`);
  });

  socket.on("joinRoom", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return socket.emit("error", "Phòng không tồn tại.");
    }
    if (room.players.length >= 2) {
      return socket.emit("error", "Phòng đã đầy.");
    }

    socket.join(roomCode);
    room.players.push({
      id: socket.id,
      playerIndex: 1,
      ready: false,
      placeBoard: null,
    });
    room.state = "placing";
    console.log(`${socket.id} đã tham gia phòng ${roomCode}`);

    const playerInfo = room.players.map((p) => ({
      id: p.id,
      playerIndex: p.playerIndex,
    }));
    io.to(roomCode).emit("gameStart", { players: playerInfo });
    console.log(`Phòng ${roomCode}: Trò chơi bắt đầu.`);

    io.to(roomCode).emit("placementTimerStarted", PLACEMENT_TIME_LIMIT);
    room.placementTimer = setTimeout(() => {
      console.log(`Phòng ${roomCode}: Hết giờ đặt máy bay.`);
      startShootingPhase(roomCode);
    }, PLACEMENT_TIME_LIMIT);
  });

  socket.on("planesPlaced", ({ roomCode, placeBoard }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "placing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const headCount = placeBoard.flat().filter((cell) => cell === "H").length;
    if (headCount !== 3) {
      return socket.emit("error", `Bạn phải đặt đúng 3 máy bay.`);
    }

    player.placeBoard = placeBoard;
    player.ready = true;
    console.log(
      `Phòng ${roomCode}: Người chơi ${player.playerIndex} đã sẵn sàng.`
    );

    const opponent = room.players.find((p) => p.id !== socket.id);
    if (opponent) {
      io.to(opponent.id).emit("opponentReady");
    }

    if (room.players.every((p) => p.ready)) {
      startShootingPhase(roomCode);
    }
  });

  socket.on("shoot", ({ roomCode, row, col }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "shooting") return;

    const shooter = room.players.find((p) => p.id === socket.id);
    if (!shooter || shooter.playerIndex !== room.currentTurnIndex) {
      return; // Không phải lượt của bạn
    }

    const targetPlayer = room.players.find((p) => p.id !== socket.id);
    if (!targetPlayer || !targetPlayer.placeBoard) return;

    // Tránh bắn lại vào ô đã bắn
    const currentShotValue = targetPlayer.placeBoard[row][col];
    if (["D", "I", "M"].includes(currentShotValue)) {
      return; // Ô này đã được bắn, không xử lý
    }

    let result = "M"; // Miss (Trượt)
    if (currentShotValue === "H") {
      result = "D"; // Destroyed (Phá hủy đầu)
    } else if (currentShotValue === "B") {
      result = "I"; // Hit Body (Trúng thân)
    }

    targetPlayer.placeBoard[row][col] = result; // Cập nhật trạng thái trên bàn cờ của server

    io.to(roomCode).emit("shotResult", {
      shooterIndex: shooter.playerIndex,
      row,
      col,
      result,
    });

    if (result === "D") {
      const headsLeft = targetPlayer.placeBoard
        .flat()
        .filter((cell) => cell === "H").length;
      if (headsLeft === 0) {
        room.state = "finished";
        io.to(roomCode).emit("gameOver", shooter.playerIndex);
        delete rooms[roomCode];
        console.log(
          `Phòng ${roomCode}: Kết thúc. Thắng: ${shooter.playerIndex}`
        );
        return;
      }
    }

    room.currentTurnIndex = (room.currentTurnIndex + 1) % 2;
    io.to(roomCode).emit("newTurn", room.currentTurnIndex);
  });

  socket.on("disconnect", () => {
    console.log(`Người dùng đã ngắt kết nối: ${socket.id}`);
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== -1) {
        io.to(roomCode).emit("opponentLeft");
        if (room.placementTimer) {
          clearTimeout(room.placementTimer);
        }
        delete rooms[roomCode];
        console.log(`Đã xóa phòng ${roomCode} do người chơi thoát.`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Máy chủ đang lắng nghe tại cổng ${PORT}`);
});
