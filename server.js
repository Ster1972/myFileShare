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
        socket.join(data.uid);
        io.to(data.sender_uid).emit("init", data.uid);
    });

    socket.on("file-meta", function(data) {
        io.to(data.uid).emit("fs-meta", data.metadata);
    });

    socket.on("fs-start", function(data) {
        if (data && data.uid) {
            io.to(data.uid).emit("fs-share");
        } else {
            console.error("Invalid fs-start event data:", data);
        }
    });

    socket.on("file-raw", function(data) {
        io.to(data.uid).emit("fs-share", data.buffer);
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});
