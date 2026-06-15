require('dotenv').config();
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

// WebRTC signaling helpers
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
    // notify sender that receiver has joined (exclude this socket)
    socket.to(data.sender_uid).emit("init", { receiver_uid: data.sender_uid, receiver_socket_id: socket.id });
  });

  // legacy file-relay events (kept for fallback compatibility)
  socket.on("file-meta", (data = {}) => {
    if (!validUid(data.uid) || !data.metadata) return;
    const meta = data.metadata;
    // allow very large files when using P2P; this check is minimal
    if (typeof meta.total_buffer_size !== "number") {
      return socket.emit("error", { message: "invalid file size" });
    }
    socket.to(data.uid).emit("fs-meta", data);
  });

  socket.on("fs-start", (data = {}) => {
    if (!validUid(data.uid)) return socket.emit("error", { message: "invalid uid" });
    socket.to(data.uid).emit("fs-share-ack", { uid: data.uid });
  });

  socket.on("file-raw", (data = {}) => {
    if (!validUid(data.uid) || !data.buffer) return socket.emit("error", { message: "invalid data" });
    socket.to(data.uid).emit("fs-share", data);
  });

  // WebRTC signaling: forward offer/answer/ICE to the room
  socket.on('webrtc-offer', (data = {}) => {
    if (!validUid(data.uid) || !data.sdp || typeof data.sdp !== 'string') return socket.emit('error', { message: 'invalid offer data' });
    socket.to(data.uid).emit('webrtc-offer', { sdp: data.sdp, from: socket.id });
  });

  socket.on('webrtc-answer', (data = {}) => {
    if (!validUid(data.uid) || !data.sdp || typeof data.sdp !== 'string') return socket.emit('error', { message: 'invalid answer data' });
    socket.to(data.uid).emit('webrtc-answer', { sdp: data.sdp, from: socket.id });
  });

  socket.on('webrtc-ice', (data = {}) => {
    if (!validUid(data.uid) || !data.candidate || typeof data.candidate !== 'object') return socket.emit('error', { message: 'invalid ice data' });
    socket.to(data.uid).emit('webrtc-ice', { candidate: data.candidate, from: socket.id });
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Simple cache for Xirsys responses
let xirsysCache = null;
let xirsysFetchPromise = null;
const XIRSYS_CACHE_TTL = 60 * 1000; // 60s
let xirsysCacheTs = 0;

// Helper to fetch ICE servers from Xirsys
async function fetchXirsysIce() {
  const url = process.env.XIRSYS_URL;
  const user = process.env.XIRSYS_USERNAME;
  const secret = process.env.XIRSYS_SECRET || process.env.XIRSYS_CREDENTIAL;
  if (!url || !user || !secret) throw new Error('XIRSYS not configured');

  // cache
  const now = Date.now();
  if (xirsysCache && (now - xirsysCacheTs) < XIRSYS_CACHE_TTL) return xirsysCache;

  // prevent concurrent fetches
  if (xirsysFetchPromise) return xirsysFetchPromise;

  xirsysFetchPromise = (async () => {
    try {
      const auth = Buffer.from(`${user}:${secret}`).toString('base64');
      const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, method: 'GET' });
      if (!resp.ok) throw new Error(`Xirsys fetch failed: ${resp.status}`);
      const json = await resp.json();
      // Xirsys returns various shapes; try common paths
      const ice = json?.v?.iceServers || json?.iceServers || json?.s?.iceServers || json?.d?.iceServers || null;
      if (!ice) throw new Error('No iceServers in Xirsys response');
      xirsysCache = ice;
      xirsysCacheTs = now;
      return ice;
    } finally {
      xirsysFetchPromise = null;
    }
  })();

  return xirsysFetchPromise;
}

// Endpoint to return ICE servers configuration (STUN/TURN)
app.get('/rtc-config', async (req, res) => {
  try {
    // prefer Xirsys if explicitly enabled
    if (process.env.XIRSYS_ENABLED === 'true') {
      const iceServers = await fetchXirsysIce();
      console.log('Returning Xirsys ICE servers');
      return res.json({ iceServers });
    }

    throw new Error('XIRSYS_ENABLED must be true and XIRSYS credentials must be configured');
  } catch (e) {
    console.error('rtc-config error', e);
    res.status(500).json({ error: e.message || 'rtc-config unavailable' });
  }
});
