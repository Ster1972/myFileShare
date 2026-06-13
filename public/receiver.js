(function () {
  let senderID;
  const socket = io();

  document.querySelector("#receiver-start-con-btn").addEventListener("click", function () {
    senderID = document.querySelector("#join-id").value;
    if (!senderID) return;
    socket.emit("receiver-join", { sender_uid: senderID });
    document.querySelector(".join-screen").classList.remove("active");
    document.querySelector(".fs-screen").classList.add("active");
  });

  let fileShare = null;

  socket.on("fs-meta", function (data) {
    fileShare = {
      metadata: data.metadata,
      receivedBytes: 0,
      parts: new Map(),
      expectedSize: data.metadata.total_buffer_size,
      progress_node: null
    };

    const el = document.createElement("div");
    el.classList.add("item");
    el.innerHTML = `<div class="progress">0%</div><div class="filename">${data.metadata.filename}</div>`;
    document.querySelector(".files-list").appendChild(el);
    fileShare.progress_node = el.querySelector(".progress");

    // ask sender to start
    socket.emit("fs-start", { uid: senderID });
  });

  socket.on("fs-share", function (data) {
    if (!fileShare) return;
    // store by offset to allow reordering
    fileShare.parts.set(data.offset ?? fileShare.receivedBytes, data.buffer);
    fileShare.receivedBytes += data.buffer?.byteLength ?? 0;

    const pct = Math.min(Math.trunc((fileShare.receivedBytes / fileShare.expectedSize) * 100), 100);
    if (fileShare.progress_node) fileShare.progress_node.innerText = pct + "%";

    if (fileShare.receivedBytes >= fileShare.expectedSize) {
      // assemble parts in order of offset
      const ordered = Array.from(fileShare.parts.entries()).sort((a, b) => a[0] - b[0]).map(p => p[1]);
      const blob = new Blob(ordered);
      download(blob, fileShare.metadata.filename);
      fileShare = null;
    } else {
      // request next chunk
      socket.emit("fs-start", { uid: senderID });
    }
  });

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
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
