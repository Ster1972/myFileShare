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
    let metadataReceived = false;

    socket.on("fs-meta", function(metadata) {
        console.log('fs-meta', metadata)
        let object = metadata
        fileShare.metadata = object.metadata;
        console.log('fileshare.metadata = ', fileShare.metadata)
        fileShare.transmitted = 0;
        fileShare.buffer = [];
        metadataReceived = true;

        let el = document.createElement("div");
        el.classList.add("item");
        el.innerHTML = `
            <div class="progress">0%</div>
            <div class="filename">${metadata.filename}</div>
        `;
        document.querySelector(".files-list").appendChild(el);

        fileShare.progress_node = el.querySelector(".progress");

        if (metadataReceived) {
            socket.emit("fs-share-ack", { sender_uid: senderID });
        } else {
            console.error("Metadata is missing or incomplete.");
        }
    });

    socket.on("fs-share", function(buffer) {
        console.log('xxxxx', buffer, fileShare.metadata.total_buffer_size);
        fileShare.buffer.push(buffer);
        fileShare.transmitted += buffer.byteLength;

        const progress = Math.min(Math.trunc((fileShare.transmitted / fileShare.metadata.total_buffer_size) * 100), 100);
        fileShare.progress_node.innerText = progress + "%";

        if (fileShare.transmitted >= fileShare.metadata.total_buffer_size) {
            console.log('download ready');
            const concatenatedBuffer = concatenateArrayBuffers(fileShare.buffer);
            download(concatenatedBuffer, fileShare.metadata.filename);
            fileShare = {}; // Reset fileShare object
        } else {
            socket.emit("fs-share-ack", { sender_uid: senderID });
        }
    });

    function concatenateArrayBuffers(buffers) {
        let totalLength = buffers.reduce((acc, value) => acc + value.byteLength, 0);
        let result = new Uint8Array(totalLength);
        let offset = 0;
        buffers.forEach((buffer) => {
            result.set(new Uint8Array(buffer), offset);
            offset += buffer.byteLength;
        });
        return result.buffer;
    }

    function download(buffer, filename) {
        const blob = new Blob([buffer]);
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
