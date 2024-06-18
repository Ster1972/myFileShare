Below I have provided three code blocks (server side, sender and receiver).  Overall the code is functioning but i would like to improve the transfer speed and it is extremely slow for very large files.  It addition, I would like to use javascript async functionality.  Can you update the code below accordingly please.

/// server side ///
const express = require("express");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

const PORT = process.env.PORT || 5056;

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
/// sender code block ///

        (function() {
            let receiverID;
            const socket = io();

            function generateID() {
                return `${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}`;
            }

            document.querySelector("#sender-start-con-btn").addEventListener("click", function() {
                let joinID = generateID();
                document.querySelector("#join-id").innerHTML = `
                    <b> Room ID</b>
                    <span>${joinID}</span>
                    <br><br>
                    <p>Pass on this code to other participants</p>
                `;
                socket.emit("sender-join", { uid: joinID });
            });

            socket.on("init", function(data) {
                receiverID = data.receiver_uid;
                document.querySelector(".join-screen").classList.remove("active");
                document.querySelector(".fs-screen").classList.add("active");
            });

            document.querySelector("#file-input").addEventListener("change", function(e) {
                let file = e.target.files[0];
                if (!file) { return; }

                let el = document.createElement("div");
                el.classList.add("item");
                el.innerHTML = `
                    <div class="progress">0%</</div>
                    <div class="filename">${file.name}</div>
                `;
                document.querySelector(".files-list").appendChild(el);

                shareFile(file, el.querySelector(".progress"));
            });

            async function shareFile(file, progressNode) {
                const bufferSize = 256 * 1024; // 256 KB
                const fileSize = file.size;
                let offset = 0;

                socket.emit("file-meta", {
                    uid: receiverID,
                    metadata: {
                        filename: file.name,
                        total_buffer_size: fileSize,
                        buffer_size: bufferSize
                    }
                });

                socket.on("fs-share-ack", () => {
                    const sendChunk = async () => {
                        if (offset < fileSize) {
                            const blob = file.slice(offset, Math.min(offset + bufferSize, fileSize));
                            const buffer = await readFileAsArrayBuffer(blob);
                            socket.emit("file-raw", {
                                uid: receiverID,
                                buffer: buffer
                            });
                            offset += bufferSize;
                            progressNode.innerText = Math.min(Math.trunc((offset / fileSize) * 100), 100) + "%";
                            if (offset < fileSize) {
                                socket.emit("fs-start", { uid: receiverID });
                            }
                        }
                    };

                    sendChunk();
                });

                socket.emit("fs-start", { uid: receiverID });
            }

            function readFileAsArrayBuffer(blob) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(blob);
                });
            }
        })();
    
/// receiver code block ///

        (function() {
            let receiverID;
            const socket = io();

            function generateID() {
                return `${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}`;
            }

            document.querySelector("#sender-start-con-btn").addEventListener("click", function() {
                let joinID = generateID();
                document.querySelector("#join-id").innerHTML = `
                    <b> Room ID</b>
                    <span>${joinID}</span>
                    <br><br>
                    <p>Pass on this code to other participants</p>
                `;
                socket.emit("sender-join", { uid: joinID });
            });

            socket.on("init", function(data) {
                receiverID = data.receiver_uid;
                document.querySelector(".join-screen").classList.remove("active");
                document.querySelector(".fs-screen").classList.add("active");
            });

            document.querySelector("#file-input").addEventListener("change", function(e) {
                let file = e.target.files[0];
                if (!file) { return; }

                let el = document.createElement("div");
                el.classList.add("item");
                el.innerHTML = `
                    <div class="progress">0%</</div>
                    <div class="filename">${file.name}</div>
                `;
                document.querySelector(".files-list").appendChild(el);

                shareFile(file, el.querySelector(".progress"));
            });

            async function shareFile(file, progressNode) {
                const bufferSize = 256 * 1024; // 256 KB
                const fileSize = file.size;
                let offset = 0;

                socket.emit("file-meta", {
                    uid: receiverID,
                    metadata: {
                        filename: file.name,
                        total_buffer_size: fileSize,
                        buffer_size: bufferSize
                    }
                });

                socket.on("fs-share-ack", () => {
                    const sendChunk = async () => {
                        if (offset < fileSize) {
                            const blob = file.slice(offset, Math.min(offset + bufferSize, fileSize));
                            const buffer = await readFileAsArrayBuffer(blob);
                            socket.emit("file-raw", {
                                uid: receiverID,
                                buffer: buffer
                            });
                            offset += bufferSize;
                            progressNode.innerText = Math.min(Math.trunc((offset / fileSize) * 100), 100) + "%";
                            if (offset < fileSize) {
                                socket.emit("fs-start", { uid: receiverID });
                            }
                        }
                    };

                    sendChunk();
                });

                socket.emit("fs-start", { uid: receiverID });
            }

            function readFileAsArrayBuffer(blob) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(blob);
                });
            }
        })();
    
