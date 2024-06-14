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
           <p>Pass on this code to other participant</p>
      `;
      socket.emit("sender-join", {
          uid: joinID
      });
  });

  socket.on("init", function(uid) {
      console.log("init came in");
      receiverID = uid;
      document.querySelector(".join-screen").classList.remove("active");
      document.querySelector(".fs-screen").classList.add("active");
  });

  document.querySelector("#file-input").addEventListener("change", function(e) {
      let file = e.target.files[0];
      if (!file) {
          return;
      }
      let reader = new FileReader();
      reader.onload = function(e) {
          let buffer = new Uint8Array(reader.result);
          let el = document.createElement("div");
          el.classList.add("item");
          el.innerHTML = `
             <div class="progress">0%</div>
             <div class="filename">${file.name}</div>
          `;
          document.querySelector(".files-list").appendChild(el);
          shareFile({
              filename: file.name,
              total_buffer_size: buffer.length,
              buffer_size: 1024
          }, buffer, el.querySelector(".progress"));
      };
      reader.readAsArrayBuffer(file);
  });

  function shareFile(metadata, buffer, progressNode) {
      // Send metadata only once
      socket.emit("file-meta", {
          uid: receiverID,
          metadata: { filename: metadata.filename, total_buffer_size: metadata.total_buffer_size }
      });

      const bufferSize = 65536; // Adjust buffer size as needed
      let sent = 0;

      const sendChunk = () => {
          const chunk = buffer.slice(sent, sent + bufferSize);
          sent += chunk.byteLength;

          if (chunk.length > 0) {
              socket.emit("file-raw", {
                  uid: receiverID,
                  buffer: chunk
              });
          }

          progressNode.innerHTML = Math.trunc((sent / metadata.total_buffer_size) * 100) + "%";

          if (sent < metadata.total_buffer_size) {
              socket.once("fs-share", sendChunk); // Updated event name to match server code
          }
      };

      // Start the file sharing process
      socket.emit("fs-start", { uid: receiverID });
      sendChunk();
  }

})();
