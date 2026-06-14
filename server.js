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
    io.to(data.sender_uid).emit("init", { receiver_uid: data.sender_uid });
  });

  // legacy file-relay events (kept for fallback compatibility)
  socket.on("file-meta", (data = {}) => {
    if (!validUid(data.uid) || !data.metadata) return;
    const meta = data.metadata;
    // allow very large files when using P2P; this check is minimal
    if (typeof meta.total_buffer_size !== "number") {
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

  // WebRTC signaling: forward offer/answer/ICE to the room
  socket.on('webrtc-offer', (data = {}) => {
    if (!validUid(data.uid) || !data.sdp) return;
    io.to(data.uid).emit('webrtc-offer', { sdp: data.sdp, from: socket.id });
  });

  socket.on('webrtc-answer', (data = {}) => {
    if (!validUid(data.uid) || !data.sdp) return;
    io.to(data.uid).emit('webrtc-answer', { sdp: data.sdp, from: socket.id });
  });

  socket.on('webrtc-ice', (data = {}) => {
    if (!validUid(data.uid) || !data.candidate) return;
    io.to(data.uid).emit('webrtc-ice', { candidate: data.candidate, from: socket.id });
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

// Simple cache for Xirsys responses
let xirsysCache = null;
let xirsysCacheTs = 0;
const XIRSYS_CACHE_TTL = 60 * 1000; // 60s

// Helper to fetch ICE servers from Xirsys
async function fetchXirsysIce() {
  const url = process.env.XIRSYS_URL;
  const user = process.env.XIRSYS_USERNAME;
  const secret = process.env.XIRSYS_SECRET;
  if (!url || !user || !secret) throw new Error('XIRSYS not configured');

  // cache
  const now = Date.now();
  if (xirsysCache && (now - xirsysCacheTs) < XIRSYS_CACHE_TTL) return xirsysCache;

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
}

// Endpoint to return ICE servers configuration (STUN/TURN)
app.get('/rtc-config', async (req, res) => {
  try {
    // prefer Xirsys if explicitly enabled
    if (process.env.XIRSYS_ENABLED === 'true') {
      try {
        const iceServers = await fetchXirsysIce();
        return res.json({ iceServers });
      } catch (err) {
        console.error('XIRSYS fetch failed, falling back to static TURN/STUN:', err.message);
        // continue to fallback
      }
    }

    const iceServers = [];
    // public Google STUN as fallback
    iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
    // append static TURN if configured via env
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
      iceServers.push(iceServers: [{   urls: [ "stun:us-turn9.xirsys.com" ]}, {   username: process.env.USERNAME,   credential: process.env.CREDENTIAL,   urls: [       "turn:us-turn9.xirsys.com:80?transport=udp",       "turn:us-turn9.xirsys.com:3478?transport=udp",       "turn:us-turn9.xirsys.com:80?transport=tcp",       "turn:us-turn9.xirsys.com:3478?transport=tcp",       "turns:us-turn9.xirsys.com:443?transport=tcp",       "turns:us-turn9.xirsys.com:5349?transport=tcp"   ]}]);
    }
    res.json({ iceServers });
  } catch (e) {
    console.error('rtc-config error', e);
    res.status(500).json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  }
});
