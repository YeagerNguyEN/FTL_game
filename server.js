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

io.on("connection", (socket) => {
  console.log(`Người dùng đã kết nối: ${socket.id}`);

  // Tạo phòng mới
  socket.on("createRoom", () => {
    let roomCode;
    do {
      roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      players: [{ id: socket.id, playerIndex: 0 }],
      state: null, // Trạng thái game sẽ được khởi tạo khi đủ 2 người
    };

    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    console.log(`Phòng ${roomCode} đã được tạo bởi ${socket.id}`);
  });

  // Tham gia phòng
  socket.on("joinRoom", (roomCode) => {
    if (!rooms[roomCode]) {
      socket.emit("error", "Phòng không tồn tại.");
      return;
    }
    if (rooms[roomCode].players.length >= 2) {
      socket.emit("error", "Phòng đã đầy.");
      return;
    }

    socket.join(roomCode);
    rooms[roomCode].players.push({ id: socket.id, playerIndex: 1 });
    console.log(`${socket.id} đã tham gia phòng ${roomCode}`);

    // Khi đủ 2 người, bắt đầu game
    io.to(roomCode).emit("gameStart", {
      playerIndex: 0,
      opponentIndex: 1,
    });
    io.to(roomCode).emit("gameStart", {
      playerIndex: 1,
      opponentIndex: 0,
    });
  });

  // Người chơi đã đặt xong máy bay
  socket.on("planesPlaced", ({ roomCode, placeBoard }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.placeBoard = placeBoard;
    }

    const opponent = room.players.find((p) => p.id !== socket.id);

    // Nếu cả hai người chơi đã sẵn sàng, bắt đầu lượt bắn
    if (room.players.every((p) => p.placeBoard)) {
      io.to(room.players[0].id).emit("startShooting", 0); // Người chơi 1 bắt đầu
      io.to(room.players[1].id).emit("startShooting", 0); // Báo cho người chơi 2 biết lượt của P1
    } else {
      // Ngược lại, báo cho đối thủ biết bạn đã sẵn sàng
      if (opponent) {
        io.to(opponent.id).emit("opponentReady");
      }
    }
  });

  // Xử lý một lượt bắn
  socket.on("shoot", ({ roomCode, row, col }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const shooter = room.players.find((p) => p.id === socket.id);
    const targetPlayer = room.players.find((p) => p.id !== socket.id);

    if (!shooter || !targetPlayer || !targetPlayer.placeBoard) return;

    const targetCell = targetPlayer.placeBoard[row][col];
    let result = "M"; // Miss
    if (targetCell === "H") {
      result = "D"; // Destroyed
    } else if (targetCell === "B") {
      result = "B"; // Hit Body
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
      let headsLeft = 0;
      targetPlayer.placeBoard.forEach((r) =>
        r.forEach((cell) => {
          if (cell === "H") headsLeft++;
        })
      );

      // Do kết quả bắn trúng đầu vừa được xác định, ta trừ đi 1
      if (headsLeft === 1) {
        // Tức là vừa bắn hạ cái cuối cùng
        io.to(roomCode).emit("gameOver", shooter.playerIndex);
      }
    }
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
