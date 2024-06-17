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

    let fileShare = {
        buffer: [],
        transmitted: 0,
        metadata: null,
        progress_node: null,
    };

    socket.on("fs-meta", function(data) {
        fileShare.metadata = data.metadata;
        fileShare.transmitted = 0;  // Reset transmitted bytes
        fileShare.buffer = [];  // Clear buffer

        // Create a new progress node
        let el = document.createElement("div");
        el.classList.add("item");
        fileShare.progress_node = document.createElement("div");
        fileShare.progress_node.classList.add("progress");
        fileShare.progress_node.innerText = "0%";
        el.appendChild(fileShare.progress_node);
        el.innerHTML += `<div class="filename">${fileShare.metadata.filename}</div>`;
        document.querySelector(".files-list").appendChild(el);

        // Emit the acknowledgment
        socket.emit("fs-share-ack", { sender_uid: senderID });
    });
socket.on("fs-share", function(buffer) {
    fileShare.buffer.push(new Uint8Array(buffer));
    fileShare.transmitted += buffer.byteLength;

    // Update the progress node text
    const progress = Math.min(Math.trunc(fileShare.transmitted / fileShare.metadata.total_buffer_size * 100), 100) + "%";
    console.log('Progress:', progress);
    fileShare.progress_node.innerText = progress;


    if (fileShare.transmitted >= fileShare.metadata.total_buffer_size) {
        download(new Blob(fileShare.buffer), fileShare.metadata.filename);
        fileShare.buffer = []; // Clear buffer after download
    } else {
        socket.emit("fs-share-ack", { sender_uid: senderID });
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
