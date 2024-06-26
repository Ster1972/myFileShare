
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
        const bufferSize = 64 * 1024; 
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
