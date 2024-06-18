
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

