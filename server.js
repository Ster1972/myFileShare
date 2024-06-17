const express = require("express");
const path = require("path");

const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);

const PORT = process.env.PORT || 5056;

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", function(socket) {
    socket.on("sender-join", function(data) {
        socket.join(data.uid);
    });

    socket.on("receiver-join", function(data) {
        socket.join(data.sender_uid);
        io.to(data.sender_uid).emit("init", data.sender_uid);
    });

    socket.on("file-meta", function(data) {
        io.to(data.uid).emit("fs-meta", data);
    });

    socket.on("fs-start", function(data) {
        io.to(data.uid).emit("fs-share-ack", { uid: data.uid });
    });

    socket.on("file-raw", function(data) {
        io.to(data.uid).emit("fs-share", data.buffer);
    });

    socket.on("fs-share-ack", function(data) {
        io.to(data.sender_uid).emit("fs-share-proceed");
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});
