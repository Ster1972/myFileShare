

To ensure we are working with the same code I have enclosed the server side code, sender code and receiver code below. When I send a file, the sender progress bar progress fairly quickly to 100% but the receiver progress bar takes much longer to reach 100%. When the receiver progress bar reaches 100% i then get an indicator that the file is being download to the computer which took another few second. Overall the file transfer was successful and much quicker that ever before. I would like to maintain the asynchronous nature of the file transfer process but mitigate the discrepancy between the sender and receiver progress bars.
/* const express = require("express");
const path = require("path");

const app = express();
const server = require("http").createServer(app);

const io = require("socket.io")(server);

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", function(socket) {
    socket.on("sender-join", function(data){
        socket.join(data.uid);
    });

    socket.on("receiver-join", function(data){
        socket.join(data.uid);
        socket.to(data.sender_uid).emit("init", data.uid);
    });

    socket.on("file-meta", function(data){
        socket.to(data.uid).emit("fs-meta", data.metadata);
    });

    socket.on("fs-start", function(data){
        socket.to(data.uid).emit("fs-share", {});
    });

    socket.on("file-raw", function(data){
        socket.to(data.uid).emit("fs-share", data.buffer);
    });
});

server.listen(5056, () => {
    console.log("Server is running on port 5056");
}); */

//server side code
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
        io.to(data.uid).emit("fs-share");
    });

    socket.on("file-raw", function(data) {
        io.to(data.uid).emit("fs-share", data.buffer);
        //console.log(`File chunk sent to room ${data.uid}, size: ${data.buffer.byteLength}`);
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});

//sender code
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

    socket.on("init", function(uid) {
        receiverID = uid;
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
        const bufferSize = 512 * 1024; // 256 KB
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

        socket.on("fs-share", async function() {
            while (offset < fileSize) {
                const blob = file.slice(offset, Math.min(offset + bufferSize, fileSize));
                const buffer = await readFileAsArrayBuffer(blob);
                socket.emit("file-raw", {
                    uid: receiverID,
                    buffer: new Uint8Array(buffer)
                });
                offset += bufferSize;
                progressNode.innerText = Math.min(Math.trunc((offset / fileSize) * 100), 100) + "%";
                if (offset < fileSize) {
                    socket.emit("fs-share");
                }
            }
        });
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

// reciever code

(function() {
    let senderID;
    const socket = io();

    function generateID() {
        return `${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}`;
    }

    document.querySelector("#receiver-start-con-btn").addEventListener("click", function() {
        senderID = document.querySelector("#join-id").value;
        if (senderID.length === 0) {
            return;
        }
        let joinID = generateID();

        socket.emit("receiver-join", {
            uid: joinID,
            sender_uid: senderID
        });
        document.querySelector(".join-screen").classList.remove("active");
        document.querySelector(".fs-screen").classList.add("active");
    });

    let fileShare = {};
    socket.on("fs-meta", function(metadata) {
        fileShare.metadata = metadata;
        fileShare.transmitted = 0;
        fileShare.buffer = [];

        let el = document.createElement("div");
        el.classList.add("item");
        el.innerHTML = `
            <div class="progress">0%</div>
            <div class="filename">${metadata.filename}</div>
        `;
        document.querySelector(".files-list").appendChild(el);

        fileShare.progress_node = el.querySelector(".progress");

        socket.emit("fs-start", { uid: senderID });
    });

    socket.on("fs-share", function(buffer) {
        fileShare.buffer.push(buffer);
        fileShare.transmitted += buffer.byteLength;
        fileShare.progress_node.innerHTML = Math.min(Math.trunc(fileShare.transmitted / fileShare.metadata.total_buffer_size * 100), 100) + "%";
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



