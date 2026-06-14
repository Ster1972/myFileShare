(function () {
  let receiverID = null;
  const socket = io();

  const CHUNK_SIZE = 1024 * 1024; // 1MB
  const PARALLEL_CHANNELS = 8;

  function generateID() {
    return `${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}-${Math.trunc(Math.random() * 999)}`;
  }

  // WebRTC state
  let pc = null;
  let dataChannels = [];
  let controlChannel = null;
  let pendingChannelsOpen = 0;

  async function fetchRtcConfig() {
    try {
      const r = await fetch('/rtc-config');
      return await r.json();
    } catch (e) {
      return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    }
  }

  // queue ICE candidates received before remoteDescription is set
  let pendingIceCandidates = [];

  async function createPeerConnectionAndOffer() {
    const cfg = await fetchRtcConfig();
    pc = new RTCPeerConnection({ iceServers: cfg.iceServers });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc-ice', { uid: receiverID, candidate: e.candidate });
      }
    };

    // control channel for metadata and simple control messages
    controlChannel = pc.createDataChannel('control', { ordered: true });
    controlChannel.onopen = () => {
      console.log('control channel open');
      // request list of already received chunks for resumability
      try { controlChannel.send(JSON.stringify({ type: 'received-req' })); } catch (e) { }
    };
    controlChannel.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'received') {
          // receiver reports received chunks for resume; not used yet
          console.log('receiver received list length', msg.received?.length);
        }
      } catch (err) {
        console.warn('control channel message parse error', err);
      }
    };

    // create parallel data channels
    dataChannels = [];
    pendingChannelsOpen = PARALLEL_CHANNELS;

    for (let i = 0; i < PARALLEL_CHANNELS; i++) {
      const ch = pc.createDataChannel('data-' + i, { ordered: true });
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        console.log('data channel open', i);
        ch.bufferedAmountLowThreshold = 4 * CHUNK_SIZE;
        pendingChannelsOpen--;
      };
      ch.onbufferedamountlow = () => {
        // could resume sending on this channel
      };
      ch.onerror = (e) => console.error('data channel error', e);
      dataChannels.push(ch);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { uid: receiverID, sdp: offer.sdp });
  }

  socket.on('webrtc-answer', async (data) => {
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      console.log('Remote description set (answer)');
      // drain any queued ICE candidates
      if (pendingIceCandidates.length) {
        for (const cand of pendingIceCandidates) {
          try { await pc.addIceCandidate(cand); } catch (e) { console.warn('addIceCandidate (drain) failed', e); }
        }
        pendingIceCandidates = [];
      }
    } catch (e) {
      console.error('Error setting remote description', e);
    }
  });

  socket.on('webrtc-ice', async (data) => {
    if (!pc || !data?.candidate) return;
    // if remoteDescription not set yet, queue candidate
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      pendingIceCandidates.push(data.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (e) {
      console.warn('addIceCandidate failed', e);
    }
  });

  document.querySelector("#sender-start-con-btn").addEventListener("click", function () {
    const joinID = generateID();
    document.querySelector("#join-id").innerHTML = `
      <b> Room ID</b> <span>${joinID}</span><br><br><p>Pass on this code to other participants</p>
    `;
    socket.emit("sender-join", { uid: joinID });
  });

  socket.on("init", async function (data) {
    receiverID = data?.receiver_uid ?? null;
    document.querySelector(".join-screen").classList.remove("active");
    document.querySelector(".fs-screen").classList.add("active");

    // start WebRTC negotiation as the initiator (sender)
    await createPeerConnectionAndOffer();
  });

  socket.on('webrtc-offer', async (data) => {
    // ignore unexpected incoming offers (negotiation is sender-initiated)
  });

  document.querySelector("#file-input").addEventListener("change", function (e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const el = document.createElement("div");
    el.classList.add("item");
    el.innerHTML = `<progress max="100" value="0"></progress><div class="progress-text">0%</div><div class="filename">${file.name}</div>`;
    document.querySelector(".files-list").appendChild(el);
    const progressBar = el.querySelector('progress');
    const progressText = el.querySelector('.progress-text');

    sendFileOverDataChannels(file, { bar: progressBar, text: progressText }).catch(err => {
      console.error("sendFile error", err);
      progressText.innerText = "Error";
    });
  });

  async function waitForChannelsReady() {
    // wait until all channels are open (with timeout)
    const start = Date.now();
    while (pendingChannelsOpen > 0 && Date.now() - start < 30000) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (pendingChannelsOpen > 0) console.warn('Some channels did not open in time');
  }

  async function sendFileOverDataChannels(file, progressNode) {
    if (!pc) {
      progressNode.text.innerText = 'No peer connection';
      return;
    }

    await waitForChannelsReady();

    // collect open channels (after waiting). If none open within 5s, fail.
    let openChannels = dataChannels.filter(ch => ch && ch.readyState === 'open');
    const openStart = Date.now();
    while (openChannels.length === 0 && (Date.now() - openStart) < 5000) {
      await new Promise(r => setTimeout(r, 100));
      openChannels = dataChannels.filter(ch => ch && ch.readyState === 'open');
    }
    if (openChannels.length === 0) {
      throw new Error('No data channels available to send');
    }

    const fileSize = file.size;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    // ensure control channel is open before sending meta
    if (!controlChannel || controlChannel.readyState !== 'open') {
      const ctrlStart = Date.now();
      while ((!controlChannel || controlChannel.readyState !== 'open') && (Date.now() - ctrlStart) < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    if (!controlChannel || controlChannel.readyState !== 'open') {
      throw new Error('Control channel not open');
    }

    // send metadata over control channel
    const transferId = `${file.name}::${fileSize}`;
    const meta = { type: 'meta', filename: file.name, fileSize, chunkSize: CHUNK_SIZE, totalChunks, transferId };
    controlChannel.send(JSON.stringify(meta));

    // wait for receiver to send back list of already received chunks (resumability)
    let receivedSet = new Set();
    let receivedResolve;
    const receivedPromise = new Promise((resolve) => { receivedResolve = resolve; });

    const receivedHandler = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'received') {
          receivedSet = new Set((msg.received || []).map(x => Number(x)));
          console.log('initial received set length', receivedSet.size);
          receivedResolve();
        } else if (msg.type === 'nack') {
          // receiver requests retransmit of specific indices
          (msg.indices || []).forEach(idx => {
            // trigger retransmit asynchronously
            resendQueue.push(Number(idx));
          });
        }
      } catch (err) {
        console.warn('control channel message parse error', err);
      }
    };

    controlChannel.addEventListener('message', receivedHandler);

    // timeout: if no received list in 5s, continue
    const rpTimeout = setTimeout(() => receivedResolve(), 5000);
    await receivedPromise;
    clearTimeout(rpTimeout);

    let sentChunks = 0;

    // build list of indices to send excluding already received
    const sendIndices = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedSet.has(i)) sendIndices.push(i);
    }

    // round-robin schedule across open channels
    const channelCount = openChannels.length || 1;

    const resendQueue = [];

    const sendChunk = async (index) => {
      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const blob = file.slice(start, end);
      const payload = await blob.arrayBuffer();

      // compute SHA-256 digest
      let digest;
      try {
        digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
      } catch (e) {
        // fallback: zeroed digest
        digest = new Uint8Array(32);
      }

      // create header: 4 bytes chunk index + 32-byte digest
      const packet = new ArrayBuffer(4 + 32 + payload.byteLength);
      const dv = new DataView(packet);
      dv.setUint32(0, index);
      const headerArr = new Uint8Array(packet, 4, 32);
      headerArr.set(digest);
      const arr = new Uint8Array(packet);
      arr.set(new Uint8Array(payload), 4 + 32);

      const ch = openChannels[index % channelCount];
      // wait for channel to be open (short timeout)
      const chStart = Date.now();
      while (ch.readyState !== 'open' && (Date.now() - chStart) < 5000) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (ch.readyState !== 'open') throw new Error('Data channel not open');
      // backpressure: wait if channel bufferedAmount too high
      while (ch.bufferedAmount > 16 * CHUNK_SIZE) {
        await new Promise(r => setTimeout(r, 50));
      }
      ch.send(packet);
      sentChunks++;
      // update progress bar and text
      const pct = Math.min(Math.trunc((sentChunks / totalChunks) * 100), 100);
      progressNode.bar.value = pct;
      progressNode.text.innerText = pct + "%";
    };

    // producers consume from sendIndices
    let nextIndexPtr = 0;
    const producers = [];
    for (let i = 0; i < channelCount; i++) {
      producers.push((async () => {
        while (true) {
          let idx;
          // prioritize resends
          if (resendQueue.length > 0) {
            idx = resendQueue.shift();
          } else {
            idx = sendIndices[nextIndexPtr++];
          }
          if (idx === undefined) break;
          await sendChunk(idx);
        }
      })());
    }

    await Promise.all(producers);
    // notify receiver of completion
    controlChannel.send(JSON.stringify({ type: 'complete' }));
    controlChannel.removeEventListener('message', receivedHandler);

  }

})();
