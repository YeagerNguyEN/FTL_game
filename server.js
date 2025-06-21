const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phục vụ các file tĩnh từ thư mục 'public'
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = {};
const PLACEMENT_TIME_LIMIT = 30000; // 30 giây

// Hàm bắt đầu giai đoạn bắn
const startShootingPhase = (roomCode) => {
  const room = rooms[roomCode];
  // Chỉ bắt đầu nếu game đang ở trạng thái 'placing'
  if (!room || room.state !== "placing") return;

  // Xóa bộ đếm thời gian nếu có
  if (room.placementTimer) {
    clearTimeout(room.placementTimer);
    room.placementTimer = null;
  }

  room.state = "shooting"; // Cập nhật trạng thái game
  io.to(roomCode).emit("shootingPhaseStart"); // Báo cho client biết màn bắn bắt đầu

  // Báo cho client biết lượt của ai (người chơi 0 bắt đầu)
  io.to(roomCode).emit("newTurn", room.currentTurnIndex);
  console.log(
    `Phòng ${roomCode}: Bắt đầu giai đoạn bắn. Lượt của người chơi ${room.currentTurnIndex}.`
  );
};

io.on("connection", (socket) => {
  console.log(`Người dùng đã kết nối: ${socket.id}`);

  // Tạo phòng mới
  socket.on("createRoom", () => {
    let roomCode;
    do {
      roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      players: [
        { id: socket.id, playerIndex: 0, ready: false, placeBoard: null },
      ],
      state: "waiting", // Trạng thái: chờ người chơi thứ 2
      currentTurnIndex: 0, // Người chơi 0 sẽ bắt đầu trước
    };

    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    console.log(`Phòng ${roomCode} đã được tạo bởi ${socket.id}`);
  });

  // Tham gia phòng
  socket.on("joinRoom", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("error", "Phòng không tồn tại.");
      return;
    }
    if (room.players.length >= 2) {
      socket.emit("error", "Phòng đã đầy.");
      return;
    }

    socket.join(roomCode);
    room.players.push({
      id: socket.id,
      playerIndex: 1,
      ready: false,
      placeBoard: null,
    });
    room.state = "placing"; // Cập nhật trạng thái: đang đặt máy bay
    console.log(`${socket.id} đã tham gia phòng ${roomCode}`);

    // Khi đủ 2 người, gửi thông tin bắt đầu và bộ đếm thời gian
    const playerInfo = room.players.map((p) => ({
      id: p.id,
      playerIndex: p.playerIndex,
    }));
    io.to(roomCode).emit("gameStart", { players: playerInfo });
    console.log(`Phòng ${roomCode}: Trò chơi bắt đầu.`);

    // Bắt đầu đếm ngược 30 giây
    io.to(roomCode).emit("placementTimerStarted", PLACEMENT_TIME_LIMIT);
    room.placementTimer = setTimeout(() => {
      console.log(`Phòng ${roomCode}: Hết giờ đặt máy bay.`);
      startShootingPhase(roomCode);
    }, PLACEMENT_TIME_LIMIT);
  });

  // Người chơi đã đặt xong máy bay
  socket.on("planesPlaced", ({ roomCode, placeBoard }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "placing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    // Xác thực số lượng máy bay (phải có đúng 3 đầu 'H')
    const headCount = placeBoard.flat().filter((cell) => cell === "H").length;
    if (headCount !== 3) {
      socket.emit(
        "error",
        `Bạn phải đặt đúng 3 máy bay. Hiện tại có ${headCount}.`
      );
      return;
    }

    player.placeBoard = placeBoard;
    player.ready = true;
    console.log(
      `Phòng ${roomCode}: Người chơi ${player.playerIndex} đã sẵn sàng.`
    );

    // Báo cho đối thủ biết bạn đã sẵn sàng
    const opponent = room.players.find((p) => p.id !== socket.id);
    if (opponent) {
      io.to(opponent.id).emit("opponentReady");
    }

    // Nếu cả hai người chơi đã sẵn sàng, bắt đầu lượt bắn ngay lập tức
    if (room.players.every((p) => p.ready)) {
      startShootingPhase(roomCode);
    }
  });

  // Xử lý một lượt bắn
  socket.on("shoot", ({ roomCode, row, col }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "shooting") return;

    const shooter = room.players.find((p) => p.id === socket.id);
    // Kiểm tra xem có phải lượt của người bắn không
    if (!shooter || shooter.playerIndex !== room.currentTurnIndex) {
      return; // Không phải lượt của bạn
    }

    const targetPlayer = room.players.find((p) => p.id !== socket.id);
    if (!targetPlayer || !targetPlayer.placeBoard) return;

    const targetCell = targetPlayer.placeBoard[row][col];
    let result = "M"; // Miss (Trượt)
    if (targetCell === "H") {
      result = "D"; // Destroyed (Phá hủy đầu)
      targetPlayer.placeBoard[row][col] = "D"; // Cập nhật trạng thái trên bàn cờ của server
    } else if (targetCell === "B") {
      result = "I"; // Hit Body (Trúng thân)
      targetPlayer.placeBoard[row][col] = "I"; // Cập nhật trạng thái trên bàn cờ của server
    }

    // Gửi kết quả cho cả hai người chơi
    io.to(roomCode).emit("shotResult", {
      shooterIndex: shooter.playerIndex,
      row,
      col,
      result,
    });

    // Kiểm tra điều kiện thắng
    if (result === "D") {
      const headsLeft = targetPlayer.placeBoard
        .flat()
        .filter((cell) => cell === "H").length;
      if (headsLeft === 0) {
        // Người bắn đã thắng
        room.state = "finished";
        io.to(roomCode).emit("gameOver", shooter.playerIndex);
        delete rooms[roomCode]; // Dọn dẹp phòng sau khi game kết thúc
        console.log(
          `Phòng ${roomCode}: Trò chơi kết thúc. Người thắng: ${shooter.playerIndex}`
        );
        return; // Dừng thực thi để không chuyển lượt
      }
    }

    // Chuyển lượt cho người chơi tiếp theo
    room.currentTurnIndex = (room.currentTurnIndex + 1) % 2;
    io.to(roomCode).emit("newTurn", room.currentTurnIndex);
  });

  // Xử lý khi người dùng ngắt kết nối
  socket.on("disconnect", () => {
    console.log(`Người dùng đã ngắt kết nối: ${socket.id}`);
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== -1) {
        // Báo cho người chơi còn lại biết đối thủ đã thoát
        io.to(roomCode).emit("opponentLeft");

        // Dọn dẹp phòng
        if (room.placementTimer) {
          clearTimeout(room.placementTimer);
        }
        delete rooms[roomCode];
        console.log(`Đã xóa phòng ${roomCode} do người chơi ngắt kết nối.`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Máy chủ đang lắng nghe tại cổng ${PORT}`);
});
