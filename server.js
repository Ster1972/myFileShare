const express = require("express");
const path = require("path");
const http = require("http");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

const PORT = process.env.PORT || 5056;

// Increase payload limit to handle larger chunks
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
    console.log("New client connected");

    socket.on("sender-join", (data) => {
        socket.join(data.uid);
    });

    socket.on("receiver-join", (data) => {
        socket.join(data.sender_uid);
        io.to(data.sender_uid).emit("init", { receiver_uid: socket.id });
    });

    socket.on("file-meta", (data) => {
        io.to(data.uid).emit("fs-meta", data);
    });

    socket.on("fs-start", (data) => {
        io.to(data.uid).emit("fs-share-ack", { uid: data.uid });
    });

    socket.on("file-raw", (data) => {
        io.to(data.uid).emit("fs-share", data);
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});
