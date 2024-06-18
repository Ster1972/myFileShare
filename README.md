//server side //
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

// sender block //

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
                    <div class="progress">0%</div>
                    <div class="filename">${file.name}</div>
                `;
                document.querySelector(".files-list").appendChild(el);

                shareFile(file, el.querySelector(".progress"));
            });

            async function shareFile(file, progressNode) {
                const bufferSize = 128 * 1024; 
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

                socket.on("fs-share-ack", async () => {
                    while (offset < fileSize) {
                        const blob = file.slice(offset, Math.min(offset + bufferSize, fileSize));
                        const buffer = await readFileAsArrayBuffer(blob);
                        socket.emit("file-raw", {
                            uid: receiverID,
                            buffer: buffer
                        });
                        offset += bufferSize;
                        progressNode.innerText = Math.min(Math.trunc((offset / fileSize) * 100), 100) + "%";
                        await new Promise(resolve => setTimeout(resolve, 0)); // Prevent blocking the event loop
                    }
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

// receiver block //

        (function() {
            let senderID;
            const socket = io();

            document.querySelector("#receiver-start-con-btn").addEventListener("click", function() {
                senderID = document.querySelector("#join-id").value;
                if (senderID.length === 0) {
                    return;
                }
                socket.emit("receiver-join", {
                    uid: socket.id,
                    sender_uid: senderID
                });
                document.querySelector(".join-screen").classList.remove("active");
                document.querySelector(".fs-screen").classList.add("active");
            });

            let fileShare = {};

            socket.on("fs-meta", function(metadata) {
                fileShare.metadata = metadata.metadata;
                fileShare.transmitted = 0;
                fileShare.buffer = [];

                let el = document.createElement("div");
                el.classList.add("item");
                el.innerHTML = `
                    <div class="progress">0%</div>
                    <div class="filename">${metadata.metadata.filename}</div>
                `;
                document.querySelector(".files-list").appendChild(el);

                fileShare.progress_node = el.querySelector(".progress");

                socket.emit("fs-start", { uid: senderID });
            });

            socket.on("fs-share", function(data) {
                fileShare.buffer.push(data.buffer);
                fileShare.transmitted += data.buffer.byteLength;
                let progressPercentage = Math.min(Math.trunc(fileShare.transmitted / fileShare.metadata.total_buffer_size * 100), 100);
                fileShare.progress_node.innerHTML = progressPercentage + "%"
                if (fileShare.transmitted >= fileShare.metadata.total_buffer_size) {
                    download(new Blob(fileShare.buffer), fileShare.metadata.filename);
                    fileShare = {};
                } else {
                    socket.emit("fs-start", { uid: senderID });
                }
            });

            function download(blob, filename) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                }, 100);
            }
        })();

