const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" }
});

const PORT = process.env.PORT || 5056;

// Built-in body parsers with limits
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200
  })
);

app.use(express.static(path.join(__dirname, "public")));

// avoid 404 for favicon requests
app.get('/favicon.ico', (req, res) => res.sendStatus(204));

// Basic helper: validate UID
function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128;
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("sender-join", (data = {}) => {
    if (!validUid(data.uid)) return socket.emit("error", { message: "invalid uid" });
    socket.join(data.uid);
    console.log("sender joins", data.uid);
  });

  socket.on("receiver-join", (data = {}) => {
    if (!validUid(data.sender_uid)) return socket.emit("error", { message: "invalid uid" });
    socket.join(data.sender_uid);
    console.log("receiver joins", data.sender_uid);
    io.to(data.sender_uid).emit("init", { receiver_uid: data.sender_uid });
  });

  socket.on("file-meta", (data = {}) => {
    if (!validUid(data.uid) || !data.metadata) return;
    const meta = data.metadata;
    if (typeof meta.total_buffer_size !== "number" || meta.total_buffer_size > (1 << 30)) {
      return socket.emit("error", { message: "invalid file size" });
    }
    io.to(data.uid).emit("fs-meta", data);
  });

  socket.on("fs-start", (data = {}) => {
    if (!validUid(data.uid)) return;
    io.to(data.uid).emit("fs-share-ack", { uid: data.uid });
  });

  socket.on("file-raw", (data = {}) => {
    if (!validUid(data.uid) || !data.buffer) return;
    io.to(data.uid).emit("fs-share", data);
  });

  socket.on("disconnect", (reason) => {
    console.log("Client disconnected", socket.id, reason);
  });

  socket.on("error", (err) => {
    console.error("Socket error", err);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port: ${PORT}`);
});
