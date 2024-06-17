I have provided three code blocks below which i need you to check for correct functionality.  The issue I currently is that the receiver progess box on the html page is not being update as the file is being received.  The transfer does complete successfully but the progress bar remaining at zero percent through out the transfer.  I need your help to fix this issue.

//HTML code//
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Home Page</title>
    <link rel="stylesheet" type="text/css" href="style.css">
</head>
<body>
    <div class="app">
        <div class="screen join-screen active">
            <div class="form">
                <h2>Share your files</h2>
                <div class="form-input">
                    <label for="join-id">Join ID</label>
                    <input type="text" id="join-id">
                </div>
                <div class="form-input">
                    <button id="receiver-start-con-btn">Connect</button>
                </div>
            </div>
        </div>
        <div class="screen fs-screen">
            
            <div class="files-list">
                <div class="title">Shared files:</div>
               
            </div>
        </div>
    </div>
    
   
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/downloadjs/1.4.1/download.min.js"></script>
    <script type="text/javascript" src="socket.io/socket.io.js"></script>
    <script type="text/javascript" src="receiver.js"></script>
</body>
</html>
///reciever code block///
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
/// css code block//
* {
    margin: 0px;
    padding: 0px;
    box-sizing: border-box;
}
body {
    background: #f5f5f5;
    font-family: "Roboto", sans-serif;
}
.screen {
    display: none;
}
.screen.active {
    display: block;
}
.app {
    position: fixed;
    top: 0px;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    height: 100%;
    max-width: 500px;
    background: #fff;
    border-right: 1px solid #ddd;
    border-left: 1px solid #ddd;
}

.button {
    border: none;
    color: white;
    padding: 10px 20px;
    text-align: center;
    text-decoration: none;
    display: inline-block;
    font-size: 18px;
    border-radius: 20px;
    margin: 4px 2px;
    cursor: pointer;
  }
  
  .button1 {background-color: #04AA6D;} /* Green */
  .button2 {background-color: #008CBA;} /* Blue */

  .center {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100px;
  }

.join-screen .form {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 50px;
}

.join-screen .form .form-input {
    margin: 10px 0px;
}
.join-screen .form h2 {
    font-size: 40px;
    line-height: 45px;
    color: #222;
    margin-bottom: 20px;
}
.join-screen .form button {
    background: #111;
    padding: 10px 20px;
    font-size: 18px;
    border-radius: 20px;
    color: #fff;
    border: none;
    outline: none;
    cursor: pointer;
}
.join-screen .form #join-id b {
    color: #222;
    display: block;
    margin-top: 20px;
}
.join-screen .form #join-id span {
    display: inline-block;
    font-size: 25px;
    font-family: monospace;
    color: #222;
    padding: 10px;
    border: 1px solid #111;
    margin-top: 5px;
}
.join-screen .form label {
    color: #222;
    font-size: 18px;
}
.join-screen .form input {
    display: block;
    margin: 10px 0px;
    width: 100%;
    max-width: 200px;
    border: 1px solid #111;
    color: #111;
    font-size: 20px;
    padding: 10px;
}

.fs-screen {
    padding: 20px;
}
.fs-screen .file-input {
    width: 100%;
    border: 2px dashed #555;
}

.fs-screen .file-input label {
    display: block;
    width: 100%;
    padding: 40px 50px;
    text-align: center;
    color: #111;
    font-size: 18px;
}

.fs-screen .file-input input {
    display: none;
}

.fs-screen .files-list {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
}

.fs-screen .files-list .title {
    width: 100%;
    font-size: 18px;
    color: #555;
    margin-bottom: 20px;
}

.fs-screen .files-list .item {
    width: 33.33%;
    min-width: 200px;
    border: 1px solid #eee;
    box-shadow: 0px 0px 5px 2px rgba(0,0,0, 0.05);
}

.fs-screen .files-list .item .progress {
    padding: 30px;
    text-align: center;
    font-size: 50px;
    font-family: monospace;
    color: #222;
}
.fs-screen .files-list .item .filename {
    font-size: 16px;
    padding: 5px;
    border-top: 1px solid #eee;
}
