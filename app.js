// =======================================================
// Make a song from this beat — Full app.js
// - Beat: demo or upload
// - Vocals: record OR upload/drop (iPhone files)
// - Mix: offline render to WAV for compatibility
// =======================================================

// ---------- DOM ----------
const useDemoBtn = document.getElementById('useDemo');
const beatFileInput = document.getElementById('beatFile');

const initAudioBtn = document.getElementById('initAudio');
const playBeatBtn = document.getElementById('playBeat');
const stopBeatBtn = document.getElementById('stopBeat');

const beatVol = document.getElementById('beatVol');
const micVol = document.getElementById('micVol');

const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');

const statusEl = document.getElementById('status');

const vocalsPlayback = document.getElementById('vocalsPlayback');
const mixPlayback = document.getElementById('mixPlayback');
const downloadMix = document.getElementById('downloadMix');

// Upload vocals UI
const vocalsDrop = document.getElementById('vocalsDrop');
const vocalsFile = document.getElementById('vocalsFile');
const uploadedVocalsPlayback = document.getElementById('uploadedVocalsPlayback');
const useUploadedVocalsBtn = document.getElementById('useUploadedVocals');
const clearUploadedVocalsBtn = document.getElementById('clearUploadedVocals');
const uploadStatus = document.getElementById('uploadStatus');

// ---------- Audio state ----------
let audioCtx = null;

let beatBuffer = null;          // decoded beat audio (AudioBuffer)
let beatObjectURL = null;       // for quick preview if needed
let beatIsLoaded = false;

let beatSource = null;
let beatGainNode = null;
let beatIsPlaying = false;

let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;        // recorded vocals blob
let recordedVocalsBuffer = null;

let uploadedVocalsBuffer = null;
let uploadedVocalsObjectURL = null;
let useUploadedVocalsForMix = false;

let lastMixURL = null;
let lastBeatURL = null;
let lastVocalsURL = null;

// ---------- Helpers ----------
function setStatus(msg) {
  statusEl.textContent = msg;
}

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

async function decodeFileToAudioBuffer(file) {
  const ctx = ensureAudioCtx();
  const arrayBuf = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuf);
}

async function decodeBlobToAudioBuffer(blob) {
  const ctx = ensureAudioCtx();
  const arrayBuf = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuf);
}

function revokeURL(url) {
  if (url) URL.revokeObjectURL(url);
}

function clearLastMixLink() {
  if (lastMixURL) revokeURL(lastMixURL);
  lastMixURL = null;
  downloadMix.hidden = true;
  downloadMix.href = '#';
  mixPlayback.removeAttribute('src');
  mixPlayback.load();
}

// ---------- Beat load ----------
async function loadBeatFromURL(url) {
  try {
    setStatus('Loading demo beat…');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch demo beat.');
    const arrayBuf = await res.arrayBuffer();

    const ctx = ensureAudioCtx();
    beatBuffer = await ctx.decodeAudioData(arrayBuf);

    beatIsLoaded = true;
    playBeatBtn.disabled = false;
    recordBtn.disabled = false;

    setStatus('Demo beat loaded. You can play and record now.');
  } catch (err) {
    console.error(err);
    setStatus('Could not load demo beat. Check the file path in app.js.');
  }
}

async function loadBeatFromFile(file) {
  try {
    setStatus('Loading beat…');
    beatBuffer = await decodeFileToAudioBuffer(file);

    // optional: store objectURL (not necessary for mixing)
    if (beatObjectURL) revokeURL(beatObjectURL);
    beatObjectURL = URL.createObjectURL(file);

    beatIsLoaded = true;
    playBeatBtn.disabled = false;
    recordBtn.disabled = false;

    setStatus(`Beat loaded: ${file.name}`);
  } catch (err) {
    console.error(err);
    setStatus('Could not load that beat file. Try mp3/wav/m4a.');
  }
}

// ---------- Beat playback ----------
function stopBeatPlayback() {
  if (beatSource) {
    try { beatSource.stop(); } catch(e) {}
    beatSource.disconnect();
    beatSource = null;
  }
  beatIsPlaying = false;
  playBeatBtn.disabled = !beatIsLoaded;
  stopBeatBtn.disabled = true;
}

function playBeatPlayback() {
  if (!beatBuffer) return;

  const ctx = ensureAudioCtx();
  stopBeatPlayback();

  beatSource = ctx.createBufferSource();
  beatSource.buffer = beatBuffer;

  beatGainNode = ctx.createGain();
  beatGainNode.gain.value = parseFloat(beatVol.value);

  beatSource.connect(beatGainNode).connect(ctx.destination);

  beatSource.onended = () => {
    beatIsPlaying = false;
    playBeatBtn.disabled = !beatIsLoaded;
    stopBeatBtn.disabled = true;
  };

  beatSource.start();
  beatIsPlaying = true;

  playBeatBtn.disabled = true;
  stopBeatBtn.disabled = false;
}

// ---------- Mic recording ----------
async function initMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
}

function pickBestMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return ''; // let browser choose
}

async function startRecording() {
  if (!micStream) await initMic();

  recordedChunks = [];
  recordedBlob = null;
  recordedVocalsBuffer = null;

  const mimeType = pickBestMimeType();
  mediaRecorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const url = URL.createObjectURL(recordedBlob);

    if (lastVocalsURL) revokeURL(lastVocalsURL);
    lastVocalsURL = url;
    vocalsPlayback.src = url;

    setStatus('Recording ready. Rendering mix…');

    // Try decoding for mixing
    try {
      recordedVocalsBuffer = await decodeBlobToAudioBuffer(recordedBlob);
    } catch (e) {
      console.warn('Decode recorded vocals failed. Try uploaded vocals instead.', e);
      setStatus('Could not decode recorded audio for mixing in this browser. Try uploading your vocals file instead.');
      return;
    }

    // When you record, default to using recorded vocals for mix
    useUploadedVocalsForMix = false;
    if (uploadStatus) uploadStatus.textContent = 'Uploaded vocals not selected (recorded vocals will be used).';

    await renderAndAttachMix({
      vocalsBuffer: recordedVocalsBuffer
    });
  };

  mediaRecorder.start();
  recordBtn.disabled = true;
  stopRecordBtn.disabled = false;

  setStatus('Recording… (press Stop Recording when done)');
}

function stopRecording() {
  if (!mediaRecorder) return;
  if (mediaRecorder.state === 'recording') mediaRecorder.stop();

  recordBtn.disabled = false;
  stopRecordBtn.disabled = true;
}

// ---------- Upload / Drop vocals ----------
vocalsDrop?.addEventListener('click', () => vocalsFile.click());

vocalsDrop?.addEventListener('dragover', (e) => {
  e.preventDefault();
  vocalsDrop.classList.add('dragover');
});
vocalsDrop?.addEventListener('dragleave', () => vocalsDrop.classList.remove('dragover'));
vocalsDrop?.addEventListener('drop', async (e) => {
  e.preventDefault();
  vocalsDrop.classList.remove('dragover');
  const file = e.dataTransfer.files?.[0];
  if (file) await loadUploadedVocalsFile(file);
});

vocalsFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) await loadUploadedVocalsFile(file);
});

async function loadUploadedVocalsFile(file) {
  try {
    uploadStatus.textContent = 'Loading uploaded vocals…';
    ensureAudioCtx();

    // Playback audition
    if (uploadedVocalsObjectURL) revokeURL(uploadedVocalsObjectURL);
    uploadedVocalsObjectURL = URL.createObjectURL(file);
    uploadedVocalsPlayback.src = uploadedVocalsObjectURL;

    // Decode for mixing
    uploadedVocalsBuffer = await decodeFileToAudioBuffer(file);

    useUploadedVocalsBtn.disabled = false;
    clearUploadedVocalsBtn.disabled = false;

    uploadStatus.textContent = `Uploaded: ${file.name}`;
  } catch (err) {
    console.error(err);
    uploadedVocalsBuffer = null;
    useUploadedVocalsBtn.disabled = true;
    clearUploadedVocalsBtn.disabled = true;
    uploadStatus.textContent = 'Could not load that audio file. Try .wav or .mp3/.m4a.';
  }
}

useUploadedVocalsBtn?.addEventListener('click', async () => {
  if (!uploadedVocalsBuffer) return;

  useUploadedVocalsForMix = true;
  uploadStatus.textContent = 'Using uploaded vocals for mix ✅';

  if (!beatBuffer) {
    setStatus('Load a beat first, then click Enable Audio, then try again.');
    return;
  }

  setStatus('Rendering mix with uploaded vocals…');
  await renderAndAttachMix({ vocalsBuffer: uploadedVocalsBuffer });
});

clearUploadedVocalsBtn?.addEventListener('click', () => {
  useUploadedVocalsForMix = false;
  uploadedVocalsBuffer = null;

  if (uploadedVocalsObjectURL) revokeURL(uploadedVocalsObjectURL);
  uploadedVocalsObjectURL = null;

  uploadedVocalsPlayback.removeAttribute('src');
  uploadedVocalsPlayback.load();

  useUploadedVocalsBtn.disabled = true;
  clearUploadedVocalsBtn.disabled = true;
  uploadStatus.textContent = 'No uploaded vocals yet.';
});

// ---------- Mixing (Offline render to WAV) ----------
async function renderAndAttachMix({ vocalsBuffer }) {
  try {
    clearLastMixLink();

    const beatGain = parseFloat(beatVol.value);
    const vocalsGain = parseFloat(micVol.value);

    const wavBlob = await renderMixWav({
      beatBuffer,
      vocalsBuffer,
      beatGain,
      vocalsGain
    });

    const url = URL.createObjectURL(wavBlob);
    lastMixURL = url;

    mixPlayback.src = url;
    downloadMix.hidden = false;
    downloadMix.href = url;
    downloadMix.download = 'my-song.wav';

    setStatus('Mix ready ✅');
  } catch (err) {
    console.error(err);
    setStatus('Mix failed. Try another file format (wav/mp3/m4a) or Chrome/Edge.');
  }
}

async function renderMixWav({ beatBuffer, vocalsBuffer, beatGain = 0.9, vocalsGain = 1.0 }) {
  if (!beatBuffer || !vocalsBuffer) throw new Error('Missing beatBuffer or vocalsBuffer');

  // Use a stable sample rate
  const sampleRate = 44100;
  const duration = Math.max(beatBuffer.duration, vocalsBuffer.duration);
  const length = Math.ceil(duration * sampleRate);

  const offline = new OfflineAudioContext(2, length, sampleRate);

  // Beat
  const beatSrc = offline.createBufferSource();
  beatSrc.buffer = beatBuffer;
  const beatG = offline.createGain();
  beatG.gain.value = beatGain;

  // Vocals
  const vocSrc = offline.createBufferSource();
  vocSrc.buffer = vocalsBuffer;
  const vocG = offline.createGain();
  vocG.gain.value = vocalsGain;

  beatSrc.connect(beatG).connect(offline.destination);
  vocSrc.connect(vocG).connect(offline.destination);

  beatSrc.start(0);
  vocSrc.start(0);

  const rendered = await offline.startRendering();
  return audioBufferToWavBlob(rendered);
}

// Convert AudioBuffer -> WAV Blob (16-bit PCM)
function audioBufferToWavBlob(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;

  const interleaved = interleaveChannels(buffer, numCh, length);

  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = interleaved.length * bytesPerSample;

  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

function interleaveChannels(buffer, numCh, length) {
  if (numCh === 1) return buffer.getChannelData(0);

  const chData = [];
  for (let c = 0; c < numCh; c++) chData.push(buffer.getChannelData(c));

  const out = new Float32Array(length * numCh);
  let idx = 0;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) out[idx++] = chData[c][i];
  }
  return out;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ---------- UI wiring ----------
initAudioBtn.addEventListener('click', async () => {
  try {
    ensureAudioCtx();
    await audioCtx.resume();

    // ask for mic permission upfront so record works smoothly
    await initMic();

    initAudioBtn.disabled = true;
    setStatus(beatIsLoaded ? 'Audio enabled. Ready!' : 'Audio enabled. Load a beat next.');

    // If beat already loaded, unlock controls
    if (beatIsLoaded) {
      playBeatBtn.disabled = false;
      recordBtn.disabled = false;
    }
  } catch (err) {
    console.error(err);
    setStatus('Could not enable audio. Check mic permissions in browser.');
  }
});

useDemoBtn.addEventListener('click', async () => {
  // Put your demo beat here:
  // ✅ Make sure you have: ./assets/mikhael-beat.mp3
  // (You can rename it; just update the path.)
  ensureAudioCtx();
  await loadBeatFromURL('./assets/beat.wav');
});

beatFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  ensureAudioCtx();
  await loadBeatFromFile(file);
});

playBeatBtn.addEventListener('click', () => {
  if (!audioCtx) {
    setStatus('Click Enable Audio first.');
    return;
  }
  playBeatPlayback();
});

stopBeatBtn.addEventListener('click', () => {
  stopBeatPlayback();
});

beatVol.addEventListener('input', () => {
  if (beatGainNode) beatGainNode.gain.value = parseFloat(beatVol.value);
});

recordBtn.addEventListener('click', async () => {
  if (!audioCtx) {
    setStatus('Click Enable Audio first.');
    return;
  }
  if (!beatBuffer) {
    setStatus('Load a beat first.');
    return;
  }

  // If user previously selected uploaded vocals, recording switches back to recorded mode
  useUploadedVocalsForMix = false;
  if (uploadStatus) uploadStatus.textContent = 'Uploaded vocals not selected (recorded vocals will be used).';

  await startRecording();
});

stopRecordBtn.addEventListener('click', () => {
  stopRecording();
});

// ---------- Initial state ----------
playBeatBtn.disabled = true;
stopBeatBtn.disabled = true;
recordBtn.disabled = true;
stopRecordBtn.disabled = true;
useUploadedVocalsBtn.disabled = true;
clearUploadedVocalsBtn.disabled = true;
