(function () {
  let senderID;
  const socket = io();

  // small helper to trigger download when File System Access API is not available
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  const RECEIVED_REPORT_INTERVAL = 1000; // send received list every N chunks

  // WebRTC state
  let pc = null;
  let controlChannel = null;
  let fileHandle = null;
  let writable = null;
  let metadata = null;
  let receivedSet = new Set();
  let receivedCount = 0;

  // Simple IndexedDB helpers for persistence of received indices
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('myfileshare-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('received')) {
          db.createObjectStore('received', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadReceivedList(transferId) {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('received', 'readonly');
        const store = tx.objectStore('received');
        const rq = store.get(transferId);
        rq.onsuccess = () => resolve(rq.result ? rq.result.received || [] : []);
        rq.onerror = () => reject(rq.error);
      });
    } catch (e) {
      return [];
    }
  }

  async function saveReceivedList(transferId, arr) {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('received', 'readwrite');
        const store = tx.objectStore('received');
        store.put({ id: transferId, received: arr });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      // ignore
    }
  }

  // list all saved transfers for UI
  async function listSavedTransfers() {
    const container = document.getElementById('saved-transfers');
    if (!container) return;
    try {
      const db = await openDb();
      const tx = db.transaction('received', 'readonly');
      const store = tx.objectStore('received');
      const req = store.getAll();
      req.onsuccess = () => {
        const results = req.result || [];
        if (results.length === 0) {
          container.innerText = 'No saved transfers';
          return;
        }
        container.innerHTML = '';
        results.forEach(entry => {
          const el = document.createElement('div');
          el.className = 'saved-entry';
          const pct = entry.received && metadata && metadata.totalChunks ? Math.min(Math.trunc((entry.received.length / (metadata ? metadata.totalChunks : 1)) * 100), 100) : '';
          el.innerHTML = `<div><b>${entry.id}</b> - ${entry.received.length} chunks</div>`;
          const sendBtn = document.createElement('button');
          sendBtn.innerText = 'Send to sender';
          sendBtn.disabled = !(controlChannel && controlChannel.readyState === 'open');
          sendBtn.addEventListener('click', () => {
            if (controlChannel && controlChannel.readyState === 'open') {
              controlChannel.send(JSON.stringify({ type: 'received', received: entry.received }));
            } else alert('Control channel not open. Wait for sender to connect.');
          });
          const clearBtn = document.createElement('button');
          clearBtn.innerText = 'Clear';
          clearBtn.addEventListener('click', async () => {
            const db2 = await openDb();
            const tx2 = db2.transaction('received', 'readwrite');
            tx2.objectStore('received').delete(entry.id);
            tx2.oncomplete = () => listSavedTransfers();
          });
          el.appendChild(sendBtn);
          el.appendChild(clearBtn);
          container.appendChild(el);
        });
      };
      req.onerror = () => { container.innerText = 'Error reading saved transfers'; };
    } catch (e) {
      container.innerText = 'IndexedDB not available';
    }
  }

  // refresh saved list on load
  window.addEventListener('load', () => listSavedTransfers());

  async function fetchRtcConfig() {
    const r = await fetch('/rtc-config');
    if (!r.ok) {
      const errBody = await r.text().catch(() => null);
      throw new Error(`rtc-config failed: ${r.status} ${r.statusText}${errBody ? ' - ' + errBody : ''}`);
    }
    const json = await r.json();
    if (!json || !Array.isArray(json.iceServers)) {
      throw new Error('rtc-config returned invalid ICE server configuration');
    }
    console.log('Fetched RTC config', json);
    return json;
  }

  document.querySelector("#receiver-start-con-btn").addEventListener("click", async function () {
    senderID = document.querySelector("#join-id").value;
    if (!senderID) return;

    // Do NOT prompt for file save until the sender provides metadata (user gesture will be requested then if needed).

    socket.emit("receiver-join", { sender_uid: senderID });
    document.querySelector(".join-screen").classList.remove("active");
    document.querySelector(".fs-screen").classList.add("active");
  });

  // queue ICE candidates until remoteDescription is set
  let pendingIceCandidatesRecv = [];

  socket.on('webrtc-offer', async (data) => {
    // create peer, set remote description, create answer
    const cfg = await fetchRtcConfig();
    console.log('Receiver: creating RTCPeerConnection with ICE servers', cfg.iceServers);
    pc = new RTCPeerConnection({ iceServers: cfg.iceServers });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc-ice', { uid: senderID, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Receiver PeerConnection connectionState:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.error('Receiver PeerConnection failed');
      }
    };
    pc.oniceconnectionstatechange = () => {
      console.log('Receiver PeerConnection iceConnectionState:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.error('Receiver ICE connection failed');
      }
    };

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      console.log('Receiver ondatachannel label=', ch.label);
      ch.binaryType = 'arraybuffer';
      ch.onerror = (e) => console.error('Data channel error (receiver)', ch.label, e);
      if (ch.label === 'control') {
        controlChannel = ch;
        controlChannel.onopen = async () => {
          console.log('control channel open');
          // if we already have metadata and a persisted list, send it
          if (metadata && metadata.transferId) {
            const saved = await loadReceivedList(metadata.transferId);
            receivedSet = new Set((saved || []).map(x => Number(x)));
            receivedCount = receivedSet.size;
            controlChannel.send(JSON.stringify({ type: 'received', received: Array.from(receivedSet) }));
          }
          // refresh saved transfers UI to enable "Send to sender" buttons
          listSavedTransfers();
        };
        controlChannel.onmessage = async (evt) => {
          // accept either JSON control messages or binary chunks on the control channel (fallback)
          if (typeof evt.data === 'string') {
            handleControlMessage(evt.data);
          } else if (evt.data instanceof ArrayBuffer) {
            await handleChunkMessage(evt.data);
          }
        };
      } else if (ch.label && ch.label.startsWith('data-')) {
        ch.onopen = () => console.log('data channel open (receiver)', ch.label);
        ch.onmessage = async (evt) => {
          await handleChunkMessage(evt.data);
        };
        ch.onclose = () => console.log('data channel closed (receiver)', ch.label);
      }
    };

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      console.log('Receiver set remote description (offer)');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('Receiver set local description (answer); emitting webrtc-answer');
      socket.emit('webrtc-answer', { uid: senderID, sdp: answer.sdp });
      // drain pending ICE candidates
      if (pendingIceCandidatesRecv.length) {
        for (const cand of pendingIceCandidatesRecv) {
          try { await pc.addIceCandidate(cand); } catch (e) { console.warn('addIceCandidate (drain) failed', e); }
        }
        pendingIceCandidatesRecv = [];
      }
    } catch (e) {
      console.error('Error handling offer', e);
    }
  });

  socket.on('webrtc-ice', async (data) => {
    if (!pc || !data?.candidate) return;
    // if remoteDescription not set yet, queue it
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      pendingIceCandidatesRecv.push(data.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (e) {
      console.warn('addIceCandidate failed', e);
    }
  });

  // Fallback relay handlers for socket.io-based transfer
  socket.on('fs-meta', async (data) => {
    try {
      if (!data || !data.metadata) return;
      console.log('Received fs-meta via socket relay', data.metadata);
      // feed into control flow as if metadata arrived over control channel
      await handleControlMessage(JSON.stringify({ type: 'meta', filename: data.metadata.filename, fileSize: data.metadata.fileSize, chunkSize: data.metadata.chunkSize, totalChunks: data.metadata.totalChunks }));
      // ask server to notify sender we're ready
      socket.emit('fs-start', { uid: data.uid });
    } catch (e) { console.warn('fs-meta handler error', e); }
  });

  socket.on('fs-share', async (data) => {
    try {
      if (!data || !data.buffer) return;
      // data.buffer expected to be ArrayBuffer
      console.log('Received fs-share chunk via socket relay, bytes:', data.buffer.byteLength || (data.buffer.length || 0));
      await handleChunkMessage(data.buffer);
    } catch (e) { console.error('fs-share handler error', e); }
  });

  socket.on('fs-complete', async (data) => {
    try {
      console.log('fs-complete received', data);
      // finalize write
      if (writable) {
        await writable.close();
        console.log('File write complete (socket relay)');
      }
    } catch (e) { console.warn('fs-complete handler error', e); }
  });

  async function handleControlMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.warn('Invalid control message', e);
      return;
    }

    if (msg.type === 'meta') {
      console.log('Received meta from sender', msg);
      metadata = msg;
      // create a stable transferId for persistence
      metadata.transferId = `${metadata.filename}::${metadata.fileSize}`;

      // load persisted received list if any
      const saved = await loadReceivedList(metadata.transferId);
      receivedSet = new Set((saved || []).map(x => Number(x)));
      receivedCount = receivedSet.size;

      // display file info
      const el = document.createElement('div');
      el.classList.add('item');
      el.innerHTML = `<progress max="100" value="0"></progress><div class="progress-text">0%</div><div class="filename">${metadata.filename}</div>`;
      document.querySelector('.files-list').appendChild(el);
      const progressBar = el.querySelector('progress');
      const progressText = el.querySelector('.progress-text');
      metadata._progressNode = { bar: progressBar, text: progressText };

      // if writable not prepared yet, prompt user now (may be blocked if no gesture) - best-effort
      if (!writable && window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({ suggestedName: metadata.filename });
          writable = await fileHandle.createWritable({ keepExistingData: false });
        } catch (e) {
          console.warn('Save dialog cancelled or unavailable', e);
        }
      }

      // send initial received list to sender if control channel open
      if (controlChannel && controlChannel.readyState === 'open') {
        controlChannel.send(JSON.stringify({ type: 'received', received: Array.from(receivedSet) }));
      }

      // update UI progress if some chunks already present
      if (metadata && metadata._progressNode) {
        const pct = Math.min(Math.trunc((receivedCount / metadata.totalChunks) * 100), 100);
        metadata._progressNode.bar.value = pct;
        metadata._progressNode.text.innerText = pct + '%';
      }

    } else if (msg.type === 'complete') {
      // finalize writable
      if (writable) {
        await writable.close();
        console.log('File write complete');
      } else {
        // fallback: assemble in-memory blobs and download
        console.warn('Writable not available; in-memory assembly required');
      }
    } else if (msg.type === 'received-req') {
      // sender requests list of received chunks for resume support
      const list = Array.from(receivedSet);
      if (controlChannel && controlChannel.readyState === 'open') {
        controlChannel.send(JSON.stringify({ type: 'received', received: list }));
      }
    }
  }

  async function handleChunkMessage(data) {
    // data is ArrayBuffer with 4-byte index header + 32-byte digest + payload
    try {
      const dv = new DataView(data);
      const index = dv.getUint32(0);
      const digestBytes = new Uint8Array(data.slice(4, 36));
      const payload = data.slice(36);

      if (receivedSet.has(index)) return; // already written

      // verify digest
      let ok = true;
      try {
        const computed = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
        if (computed.length !== digestBytes.length) ok = false;
        else {
          for (let i = 0; i < computed.length; i++) if (computed[i] !== digestBytes[i]) { ok = false; break; }
        }
      } catch (e) {
        ok = false;
      }

      if (!ok) {
        console.warn('Chunk digest mismatch for index', index);
        // request retransmit for this chunk
        if (controlChannel && controlChannel.readyState === 'open') {
          console.log('Sending NACK for index', index);
          controlChannel.send(JSON.stringify({ type: 'nack', indices: [index] }));
        }
        return;
      }

      if (writable) {
        const position = index * metadata.chunkSize;
        console.log('Writing chunk', index, 'position', position, 'bytes', payload.byteLength);
        // write with position
        await writable.write({ type: 'write', position, data: new Uint8Array(payload) });
        console.log('Wrote chunk', index);
      } else {
        // fallback: store in-memory map
        if (!metadata._parts) metadata._parts = new Map();
        metadata._parts.set(index, payload);
        console.log('Stored chunk in memory', index);
      }

      receivedSet.add(index);
      receivedCount++;

      // update progress UI
      if (metadata && metadata._progressNode) {
        const pct = Math.min(Math.trunc((receivedCount / metadata.totalChunks) * 100), 100);
        metadata._progressNode.bar.value = pct;
        metadata._progressNode.text.innerText = pct + '%';
      }

      // persist every RECEIVED_REPORT_INTERVAL chunks
      if (receivedCount % RECEIVED_REPORT_INTERVAL === 0) {
        try { await saveReceivedList(metadata.transferId, Array.from(receivedSet)); listSavedTransfers(); } catch (e) { /* ignore */ }
      }

      // periodically report received indices for resumability
      if (receivedCount % RECEIVED_REPORT_INTERVAL === 0 && controlChannel && controlChannel.readyState === 'open') {
        controlChannel.send(JSON.stringify({ type: 'received', received: Array.from(receivedSet) }));
      }

      // if complete
      if (receivedCount >= metadata.totalChunks) {
        // save final state
        try { await saveReceivedList(metadata.transferId, Array.from(receivedSet)); listSavedTransfers(); } catch(e) {}
        if (writable) {
          await writable.close();
          console.log('File write complete');
        } else {
          // assemble in-memory blobs
          const ordered = Array.from(metadata._parts.entries()).sort((a, b) => a[0] - b[0]).map(p => p[1]);
          const blob = new Blob(ordered);
          download(blob, metadata.filename);
        }
      }

    } catch (e) {
      console.error('Error handling chunk', e);
    }
  }

})();
