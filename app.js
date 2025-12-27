// Make a song from this beat — Web Audio + MediaRecorder prototype
// - Beat is played through an <audio> element routed into WebAudio
// - Mic is captured via getUserMedia
// - We mix beat + mic into a MediaStreamDestination and record that stream

const els = {
    beatFile: document.getElementById('beatFile'),
    useDemo: document.getElementById('useDemo'),
    initAudio: document.getElementById('initAudio'),
    playBeat: document.getElementById('playBeat'),
    stopBeat: document.getElementById('stopBeat'),
    recordBtn: document.getElementById('recordBtn'),
    stopRecordBtn: document.getElementById('stopRecordBtn'),
    status: document.getElementById('status'),
    beatVol: document.getElementById('beatVol'),
    micVol: document.getElementById('micVol'),
    mixPlayback: document.getElementById('mixPlayback'),
    downloadMix: document.getElementById('downloadMix'),
  };
  
  let audioCtx = null;
  let beatAudioEl = null;
  let beatObjectUrl = null;
  
  let beatSourceNode = null;
  let beatGain = null;
  
  let micStream = null;
  let micSourceNode = null;
  let micGain = null;
  
  let mixDest = null;
  
  let recorder = null;
  let recordedMixChunks = [];
  let recordedVocalsChunks = [];
  let vocalsRecorder = null; // optional separate vocals recording
  
  let beatLoaded = false;
  let audioReady = false;
  
  function setStatus(msg) {
    els.status.textContent = msg;
  }
  
  function enableControls() {
    els.playBeat.disabled = !(beatLoaded && audioReady);
    els.stopBeat.disabled = !(beatLoaded && audioReady);
    els.recordBtn.disabled = !(beatLoaded && audioReady);
  }
  
  function cleanupBeat() {
    if (beatAudioEl) {
      beatAudioEl.pause();
      beatAudioEl.src = "";
      beatAudioEl.load();
      beatAudioEl = null;
    }
    if (beatObjectUrl) {
      URL.revokeObjectURL(beatObjectUrl);
      beatObjectUrl = null;
    }
    beatLoaded = false;
  }
  
  function buildBeatAudio(url) {
    cleanupBeat();
    beatAudioEl = new Audio(url);
    beatAudioEl.crossOrigin = "anonymous";
    beatAudioEl.loop = true;
    beatAudioEl.preload = "auto";
    beatLoaded = true;
    setStatus("Beat loaded. Click “Enable Audio” (first time only).");
    enableControls();
  }
  
  els.beatFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
  
    const url = URL.createObjectURL(file);
    beatObjectUrl = url;
    buildBeatAudio(url);
  });
  
  els.useDemo.addEventListener('click', async () => {
    // Put your demo file at: ./assets/beat.mp3
    // If you deploy to GitHub Pages, keep the same path.
    const demoUrl = "./assets/beat.mp3";
    buildBeatAudio(demoUrl);
  });
  
  els.initAudio.addEventListener('click', async () => {
    try {
      if (!beatLoaded) {
        setStatus("Load a beat first (choose file or demo).");
        return;
      }
  
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state !== "running") await audioCtx.resume();
  
      // Beat chain
      beatSourceNode = audioCtx.createMediaElementSource(beatAudioEl);
      beatGain = audioCtx.createGain();
      beatGain.gain.value = Number(els.beatVol.value);
  
      // Mic chain
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // helps, but best is headphones
          noiseSuppression: true,
          autoGainControl: true
        }
      });
  
      micSourceNode = audioCtx.createMediaStreamSource(micStream);
      micGain = audioCtx.createGain();
      micGain.gain.value = Number(els.micVol.value);
  
      // Mix destination (what we record)
      mixDest = audioCtx.createMediaStreamDestination();
  
      // Route: beat -> beatGain -> speakers AND mix
      beatSourceNode.connect(beatGain);
      beatGain.connect(audioCtx.destination);
      beatGain.connect(mixDest);
  
      // Route: mic -> micGain -> mix (NOT to speakers to avoid feedback)
      micSourceNode.connect(micGain);
      micGain.connect(mixDest);
  
      // Optional: also record vocals alone (raw mic) for preview
      vocalsRecorder = new MediaRecorder(micStream, pickBestMimeType());
  
      vocalsRecorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) recordedVocalsChunks.push(evt.data);
      };
  
      audioReady = true;
      setStatus("Audio enabled. You can play the beat and record.");
      enableControls();
  
      els.initAudio.disabled = true;
    } catch (err) {
      console.error(err);
      setStatus("Couldn’t enable audio (mic permission denied or unsupported browser).");
    }
  });
  
  els.beatVol.addEventListener('input', () => {
    if (beatGain) beatGain.gain.value = Number(els.beatVol.value);
  });
  
  els.micVol.addEventListener('input', () => {
    if (micGain) micGain.gain.value = Number(els.micVol.value);
  });
  
  els.playBeat.addEventListener('click', async () => {
    try {
      if (!audioReady || !beatAudioEl) return;
      if (audioCtx.state !== "running") await audioCtx.resume();
      await beatAudioEl.play();
      setStatus("Beat playing.");
    } catch (err) {
      console.error(err);
      setStatus("Couldn’t play beat. Try clicking Enable Audio again.");
    }
  });
  
  els.stopBeat.addEventListener('click', () => {
    if (!beatAudioEl) return;
    beatAudioEl.pause();
    beatAudioEl.currentTime = 0;
    setStatus("Beat stopped.");
  });
  
  function pickBestMimeType() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg"
    ];
    for (const t of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) {
        return { mimeType: t };
      }
    }
    return {}; // browser chooses default
  }
  
  function makeRecorder(stream) {
    return new MediaRecorder(stream, pickBestMimeType());
  }
  
  function blobToUrl(blob) {
    return URL.createObjectURL(blob);
  }
  
  function stopIfRecording(mr) {
    return new Promise((resolve) => {
      if (!mr || mr.state !== "recording") return resolve();
      mr.addEventListener("stop", resolve, { once: true });
      mr.stop();
    });
  }
  
  els.recordBtn.addEventListener('click', async () => {
    if (!audioReady || !mixDest || !beatAudioEl) return;
  
    // Reset previous
    recordedMixChunks = [];
    recordedVocalsChunks = [];
    els.downloadMix.hidden = true;
    els.downloadMix.href = "#";
    els.mixPlayback.removeAttribute("src");
    els.vocalsPlayback.removeAttribute("src");
  
    // Ensure beat is playing from the beginning
    beatAudioEl.currentTime = 0;
    await beatAudioEl.play();
  
    // Record the mixed stream
    recorder = makeRecorder(mixDest.stream);
    recorder.ondataavailable = (evt) => {
      if (evt.data && evt.data.size > 0) recordedMixChunks.push(evt.data);
    };
  
    recorder.onstop = () => {
      // Mix output
      const mixBlob = new Blob(recordedMixChunks, { type: recorder.mimeType || "audio/webm" });
      const mixUrl = blobToUrl(mixBlob);
      els.mixPlayback.src = mixUrl;
  
      // Download link
      els.downloadMix.hidden = false;
      els.downloadMix.href = mixUrl;
      els.downloadMix.download = `my-song.${(mixBlob.type.includes("ogg") ? "ogg" : "webm")}`;
  
      setStatus("Recording done. Play the mix or download it.");
    };
  
    // Also record vocals alone (preview)
    if (vocalsRecorder) {
      vocalsRecorder.onstop = () => {
        const vBlob = new Blob(recordedVocalsChunks, { type: vocalsRecorder.mimeType || "audio/webm" });
        els.vocalsPlayback.src = blobToUrl(vBlob);
      };
      vocalsRecorder.start();
    }
  
    recorder.start();
    els.recordBtn.classList.add("recording");
    els.recordBtn.disabled = true;
    els.stopRecordBtn.disabled = false;
    els.playBeat.disabled = true;
    els.stopBeat.disabled = true;
  
    setStatus("Recording… (beat is playing).");
  });
  
  els.stopRecordBtn.addEventListener('click', async () => {
    els.stopRecordBtn.disabled = true;
  
    // Stop recorders
    await stopIfRecording(recorder);
    await stopIfRecording(vocalsRecorder);
  
    // Stop beat playback
    if (beatAudioEl) {
      beatAudioEl.pause();
      beatAudioEl.currentTime = 0;
    }
  
    els.recordBtn.classList.remove("recording");
    els.recordBtn.disabled = false;
    els.playBeat.disabled = false;
    els.stopBeat.disabled = false;
  
    setStatus("Processing recording…");
  });
  
  // Cleanup on page unload (optional hygiene)
  window.addEventListener("beforeunload", () => {
    try {
      cleanupBeat();
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close();
    } catch {}
  });
  