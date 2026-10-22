/**
 * =====================================================================
 *  CUY.AI // ROYAL AMETHYST BIOMETRIC ENGINE - Frontend Controller
 *  Real-Time RetinaFace & Facenet512 Face Recognition HUD
 * =====================================================================
 */

const CLOUD_BACKEND_URL = 'https://never-starting-that-lady.trycloudflare.com';

const isFileProtocol = window.location.protocol === 'file:';
const isLocal = Boolean(
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '' ||
    isFileProtocol
);

// Tentukan default API endpoint
let defaultApi = 'http://localhost:5001';
if (!isLocal) {
    defaultApi = CLOUD_BACKEND_URL;
} else if (!isFileProtocol && window.location.origin && window.location.origin !== 'null' && (window.location.port === '5001' || window.location.port === '5000')) {
    defaultApi = window.location.origin;
} else {
    defaultApi = 'http://localhost:5001';
}

const customApi = localStorage.getItem('cuy_face_backend_url');
let API_BASE = (customApi ? customApi.replace(/\/+$/, '') : defaultApi);
const WEBCAM_INTERVAL_MS = 650;
const JPEG_QUALITY = 0.75;

// State Variables
let isWebcamRunning = false;
let webcamStream = null;
let captureTimer = null;
let currentFacingMode = 'user';
let isProcessingFrame = false;
let fpsFrames = 0;
let lastFpsTime = performance.now();
let audioContext = null;
let registeredPersons = [];

// DOM References
const videoEl = document.getElementById('webcamVideo');
const overlayCanvas = document.getElementById('detectionOverlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const standbyEl = document.getElementById('viewportStandby');
const laserScannerEl = document.getElementById('laserScanner');
const btnToggleCamera = document.getElementById('btnToggleCamera');
const btnInitializeFeed = document.getElementById('btnInitializeFeed');
const btnFlipCamera = document.getElementById('btnFlipCamera');

// Tabs
const tabWebcam = document.getElementById('tabWebcam');
const tabUpload = document.getElementById('tabUpload');
const stageWebcam = document.getElementById('stageWebcam');
const stageUpload = document.getElementById('stageUpload');

// Upload Elements
const uploadDropzone = document.getElementById('uploadDropzone');
const filePickerInput = document.getElementById('filePickerInput');
const btnBrowseFile = document.getElementById('btnBrowseFile');
const uploadPreviewContainer = document.getElementById('uploadPreviewContainer');
const uploadPreviewImg = document.getElementById('uploadPreviewImg');
const uploadOverlayCanvas = document.getElementById('uploadOverlayCanvas');
const uploadOverlayCtx = uploadOverlayCanvas.getContext('2d');
const btnResetUpload = document.getElementById('btnResetUpload');

// Telemetry Elements
const telemetryLatency = document.getElementById('telemetryLatency');
const telemetryFaceCount = document.getElementById('telemetryFaceCount');
const telemetryFps = document.getElementById('telemetryFps');
const telemetryMatchStatus = document.getElementById('telemetryMatchStatus');
const targetCoords = document.getElementById('targetCoords');
const streamResolution = document.getElementById('streamResolution');

// Target Card Elements
const targetEmptyState = document.getElementById('targetEmptyState');
const targetDetectedState = document.getElementById('targetDetectedState');
const targetBadgePill = document.getElementById('targetBadgePill');
const targetPersonName = document.getElementById('targetPersonName');
const targetConfidenceScore = document.getElementById('targetConfidenceScore');
const targetConfidenceFill = document.getElementById('targetConfidenceFill');
const targetDistanceVal = document.getElementById('targetDistanceVal');
const targetSimilarityVal = document.getElementById('targetSimilarityVal');
const targetSecurityTier = document.getElementById('targetSecurityTier');

// Status & Registry
const serverStateLabel = document.getElementById('serverStateLabel');
const btnServerStatus = document.getElementById('btnServerStatus');
const totalPersonsBadge = document.getElementById('totalPersonsBadge');
const registryGrid = document.getElementById('registryGrid');
const inputRegistrySearch = document.getElementById('inputRegistrySearch');
const btnSyncRegistry = document.getElementById('btnSyncRegistry');
const hudClock = document.getElementById('hudClock');

// Modal Elements
const configModal = document.getElementById('configModal');
const btnOpenConfig = document.getElementById('btnOpenConfig');
const btnCloseConfig = document.getElementById('btnCloseConfig');
const cfgApiBase = document.getElementById('cfgApiBase');
const btnPresetLocal = document.getElementById('btnPresetLocal');
const btnPresetTunnel = document.getElementById('btnPresetTunnel');
const btnSaveConfig = document.getElementById('btnSaveConfig');
const btnResetConfig = document.getElementById('btnResetConfig');

// ===================== AUDIO FEEDBACK =====================
function playSciFiChime(isMatch = true) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);

        const now = audioContext.currentTime;
        if (isMatch) {
            osc.frequency.setValueAtTime(640, now);
            osc.frequency.exponentialRampToValueAtTime(960, now + 0.12);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.start(now);
            osc.stop(now + 0.22);
        } else {
            osc.frequency.setValueAtTime(320, now);
            osc.frequency.exponentialRampToValueAtTime(240, now + 0.15);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            osc.start(now);
            osc.stop(now + 0.18);
        }
    } catch (e) {
        // audio optional
    }
}

// ===================== CLOCK & TELEMETRY =====================
function updateClock() {
    const d = new Date();
    hudClock.textContent = 'UTC: ' + d.toUTCString().slice(17, 25);
}
setInterval(updateClock, 1000);
updateClock();

// ===================== SERVER STATUS & REGISTRY =====================

/**
 * Melakukan ping cepat ke target URL dengan timeout ketat 2 detik
 */
async function pingBackend(url) {
    if (!url) return null;
    try {
        const clean = url.replace(/\/+$/, '');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const resp = await fetch(`${clean}/api/status`, {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store'
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
            const data = await resp.json();
            if (data && (data.status === 'online' || data.model_loaded !== undefined)) {
                return { url: clean, data };
            }
        }
    } catch (_) {}
    return null;
}

let isAutoDiscovering = false;
/**
 * Memindai port dan endpoint yang berpotensi aktif untuk auto-reconnect
 */
async function autoDiscoverBackend() {
    if (isAutoDiscovering) return null;
    isAutoDiscovering = true;
    try {
        const candidateList = [];

        // 1. Origin browser aktif jika port 5001 atau 5000
        if (!isFileProtocol && window.location.origin && window.location.origin !== 'null') {
            if (window.location.port === '5001' || window.location.port === '5000') {
                candidateList.push(window.location.origin);
            }
        }

        // 2. Localhost 5001 (port resmi CUY AI)
        candidateList.push('http://localhost:5001');
        candidateList.push('http://127.0.0.1:5001');

        // 3. Cloudflare Tunnel jika dikonfigurasi
        if (typeof CLOUD_BACKEND_URL === 'string' && CLOUD_BACKEND_URL && !candidateList.includes(CLOUD_BACKEND_URL)) {
            candidateList.push(CLOUD_BACKEND_URL);
        }

        // 4. Fallback port 5000 jika instance berjalan di port 5000
        candidateList.push('http://localhost:5000');
        candidateList.push('http://127.0.0.1:5000');

        for (const target of candidateList) {
            const res = await pingBackend(target);
            if (res) return res;
        }
        return null;
    } finally {
        isAutoDiscovering = false;
    }
}

async function fetchServerStatus() {
    // 1. Coba endpoint yang saat ini aktif
    let res = await pingBackend(API_BASE);

    // 2. Jika gagal terhubung, lakukan auto-discovery ke port kandidat
    if (!res) {
        serverStateLabel.textContent = 'AUTOCONNECTING...';
        btnServerStatus.className = 'server-status-pill offline';

        const discovered = await autoDiscoverBackend();
        if (discovered) {
            res = discovered;
            API_BASE = discovered.url;
            console.log('[CUY AI] Backend terdeteksi & terhubung ke:', API_BASE);
            localStorage.setItem('cuy_face_backend_url', API_BASE);
            if (cfgApiBase) cfgApiBase.value = API_BASE;
        }
    }

    if (res) {
        const data = res.data;
        serverStateLabel.textContent = `ONLINE [${data.total_persons || 24} ID]`;
        btnServerStatus.className = 'server-status-pill online';
        totalPersonsBadge.textContent = `${data.total_persons || 24} IDS`;

        if (cutoffText && data.threshold !== undefined) {
            cutoffText.textContent = Number(data.threshold).toFixed(4);
        }
        if (modelText && data.model_name) {
            modelText.textContent = data.model_name;
        }
        if (detectorText && data.detector) {
            detectorText.textContent = data.detector;
        }

        if (data.persons && Array.isArray(data.persons)) {
            registeredPersons = data.persons;
            renderRegistry(registeredPersons);
        }
    } else {
        serverStateLabel.textContent = 'OFFLINE (KLIK SETUP)';
        btnServerStatus.className = 'server-status-pill offline';
    }
}

async function fetchPersons() {
    try {
        const resp = await fetch(`${API_BASE}/api/persons`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (data.persons && Array.isArray(data.persons)) {
            registeredPersons = data.persons.map(p => typeof p === 'object' ? p.name : p);
            renderRegistry(registeredPersons);
        }
    } catch (e) {
        console.warn('Gagal memuat daftar persons:', e);
    }
}

function renderRegistry(list) {
    if (!list || list.length === 0) {
        registryGrid.innerHTML = '<div class="registry-loading">Tidak ada identitas terdaftar.</div>';
        return;
    }

    const q = (inputRegistrySearch.value || '').toLowerCase().trim();
    const filtered = list.filter(name => name.toLowerCase().includes(q));

    if (filtered.length === 0) {
        registryGrid.innerHTML = '<div class="registry-loading">Tidak ditemukan target yang cocok.</div>';
        return;
    }

    registryGrid.innerHTML = filtered.map(name => `
        <div class="person-badge-card" data-name="${encodeURIComponent(name)}">
            <span class="person-bullet"></span>
            <span class="person-name">${escapeHtml(name)}</span>
        </div>
    `).join('');

    registryGrid.querySelectorAll('.person-badge-card').forEach(card => {
        card.addEventListener('click', () => {
            const name = decodeURIComponent(card.getAttribute('data-name'));
            showMockIdentityInspect(name);
        });
    });
}

function showMockIdentityInspect(name) {
    targetEmptyState.style.display = 'none';
    targetDetectedState.style.display = 'flex';
    targetBadgePill.textContent = 'REGISTRY IDENTITY INSPECT';
    targetBadgePill.className = 'target-badge-pill';
    targetPersonName.textContent = name.toUpperCase();
    targetConfidenceScore.textContent = '99.2%';
    targetConfidenceFill.style.width = '99.2%';
    targetDistanceVal.textContent = '0.0820';
    targetSimilarityVal.textContent = '99.2%';
    targetSecurityTier.textContent = 'TIER-1 ACCESS';
    targetSecurityTier.className = 'quad-v text-emerald';
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[s]));
}

// ===================== WEBCAM CONTROLLER =====================
async function startWebcam() {
    try {
        const constraints = {
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl.srcObject = webcamStream;
        await videoEl.play();

        isWebcamRunning = true;
        standbyEl.style.display = 'none';
        laserScannerEl.classList.add('active');
        btnToggleCamera.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
            <span>HALT FEED</span>
        `;
        btnToggleCamera.classList.remove('primary-btn');
        btnToggleCamera.classList.add('action-btn');

        // Check mobile dual camera
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === 'videoinput');
        if (videoInputs.length > 1) {
            btnFlipCamera.style.display = 'inline-flex';
        }

        videoEl.addEventListener('loadedmetadata', resizeOverlayCanvas);
        resizeOverlayCanvas();

        streamResolution.textContent = `STREAM: ${videoEl.videoWidth || 1280}x${videoEl.videoHeight || 720} @ 60FPS`;

        // Start frame capture loop
        captureTimer = setInterval(captureAndRecognizeFrame, WEBCAM_INTERVAL_MS);
    } catch (err) {
        alert('Gagal mengakses kamera: ' + err.message + '\nPastikan izin kamera telah diberikan di browser.');
    }
}

function stopWebcam() {
    if (captureTimer) {
        clearInterval(captureTimer);
        captureTimer = null;
    }
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }
    isWebcamRunning = false;
    standbyEl.style.display = 'flex';
    laserScannerEl.classList.remove('active');
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    btnToggleCamera.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>ENGAGE OPTICS</span>
    `;
    btnToggleCamera.classList.remove('action-btn');
    btnToggleCamera.classList.add('primary-btn');

    streamResolution.textContent = 'STREAM: STANDBY';
    telemetryFaceCount.textContent = '0';
    telemetryMatchStatus.textContent = 'IDLE';
}

function resizeOverlayCanvas() {
    if (!videoEl.videoWidth || !videoEl.videoHeight) return;
    overlayCanvas.width = videoEl.videoWidth;
    overlayCanvas.height = videoEl.videoHeight;
}

// ===================== RECOGNITION PIPELINE =====================
async function captureAndRecognizeFrame() {
    if (!isWebcamRunning || isProcessingFrame) return;
    if (videoEl.readyState < 2) return;

    isProcessingFrame = true;
    const startTime = performance.now();

    try {
        // Downscale frame webcam untuk transmisi super cepat & responsif (mengurangi latensi jaringan & CPU)
        const maxDim = 480;
        let targetW = videoEl.videoWidth || 640;
        let targetH = videoEl.videoHeight || 480;
        if (targetW > maxDim) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
        }

        const offCanvas = document.createElement('canvas');
        offCanvas.width = targetW;
        offCanvas.height = targetH;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(videoEl, 0, 0, targetW, targetH);

        const base64Data = offCanvas.toDataURL('image/jpeg', JPEG_QUALITY);

        const resp = await fetch(`${API_BASE}/api/recognize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Data })
        });

        const elapsed = Math.round(performance.now() - startTime);
        telemetryLatency.textContent = `${elapsed} ms`;

        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        handleRecognitionResults(data.faces || [], offCanvas.width, offCanvas.height);
    } catch (e) {
        console.warn('Frame recognition error:', e);
    } finally {
        isProcessingFrame = false;
        calculateFps();
    }
}

function handleRecognitionResults(faces, frameW, frameH) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    telemetryFaceCount.textContent = faces.length;

    if (faces.length === 0) {
        telemetryMatchStatus.textContent = 'SCANNING...';
        targetEmptyState.style.display = 'flex';
        targetDetectedState.style.display = 'none';
        targetCoords.textContent = 'TARGET_COORDS: [X: 000 | Y: 000 | Z: 512D]';
        return;
    }

    const scaleX = overlayCanvas.width / frameW;
    const scaleY = overlayCanvas.height / frameH;

    let primaryFace = faces[0];

    faces.forEach((face, idx) => {
        const { x, y, w, h } = face.bbox;
        const sx = x * scaleX;
        const sy = y * scaleY;
        const sw = w * scaleX;
        const sh = h * scaleY;

        const isMatch = face.name && face.name !== 'Unknown';

        // Draw HUD Bracket Box
        overlayCtx.lineWidth = 2.5;
        overlayCtx.strokeStyle = isMatch ? '#c77dff' : '#f87171';
        overlayCtx.shadowColor = isMatch ? 'rgba(199, 125, 255, 0.8)' : 'rgba(239, 68, 68, 0.8)';
        overlayCtx.shadowBlur = 12;

        const bracketLen = Math.min(sw, sh) * 0.25;

        // Top Left
        overlayCtx.beginPath();
        overlayCtx.moveTo(sx, sy + bracketLen);
        overlayCtx.lineTo(sx, sy);
        overlayCtx.lineTo(sx + bracketLen, sy);
        overlayCtx.stroke();

        // Top Right
        overlayCtx.beginPath();
        overlayCtx.moveTo(sx + sw - bracketLen, sy);
        overlayCtx.lineTo(sx + sw, sy);
        overlayCtx.lineTo(sx + sw, sy + bracketLen);
        overlayCtx.stroke();

        // Bottom Left
        overlayCtx.beginPath();
        overlayCtx.moveTo(sx, sy + sh - bracketLen);
        overlayCtx.lineTo(sx, sy + sh);
        overlayCtx.lineTo(sx + bracketLen, sy + sh);
        overlayCtx.stroke();

        // Bottom Right
        overlayCtx.beginPath();
        overlayCtx.moveTo(sx + sw - bracketLen, sy + sh);
        overlayCtx.lineTo(sx + sw, sy + sh);
        overlayCtx.lineTo(sx + sw, sy + sh - bracketLen);
        overlayCtx.stroke();

        // Target Tag Label
        const labelText = isMatch ? `${face.name.toUpperCase()} (${face.confidence}%)` : `UNKNOWN TARGET [${face.distance}]`;
        overlayCtx.font = 'bold 13px "Orbitron", monospace';
        overlayCtx.fillStyle = isMatch ? '#c77dff' : '#f87171';
        overlayCtx.shadowBlur = 8;
        overlayCtx.fillText(labelText, sx + 4, sy - 8);
    });

    // Update Telemetry Panel with Primary Target
    updateTargetPanel(primaryFace);
    targetCoords.textContent = `TARGET_COORDS: [X: ${primaryFace.bbox.x} | Y: ${primaryFace.bbox.y} | W: ${primaryFace.bbox.w}]`;
}

function updateTargetPanel(face) {
    targetEmptyState.style.display = 'none';
    targetDetectedState.style.display = 'flex';

    const isMatch = face.name && face.name !== 'Unknown';

    if (isMatch) {
        playSciFiChime(true);
        telemetryMatchStatus.textContent = 'MATCH VERIFIED';
        targetBadgePill.textContent = 'VERIFIED IDENTITY';
        targetBadgePill.className = 'target-badge-pill';
        targetPersonName.textContent = face.name.toUpperCase();
        targetPersonName.style.textShadow = '0 0 16px rgba(199, 125, 255, 0.8), 0 0 32px rgba(157, 78, 221, 0.5)';
        
        targetConfidenceScore.textContent = `${face.confidence}%`;
        targetConfidenceFill.style.width = `${face.confidence}%`;
        targetDistanceVal.textContent = face.distance ? face.distance.toFixed(4) : '0.1240';
        targetSimilarityVal.textContent = `${face.confidence}%`;
        targetSecurityTier.textContent = 'TIER-1 ACCESS (CLEARANCE GRANTED)';
        targetSecurityTier.className = 'quad-v text-emerald';
    } else {
        playSciFiChime(false);
        telemetryMatchStatus.textContent = 'UNAUTHORIZED TARGET';
        targetBadgePill.textContent = 'UNAUTHORIZED / UNKNOWN';
        targetBadgePill.className = 'target-badge-pill unknown';
        targetPersonName.textContent = 'UNKNOWN IDENTITY';
        targetPersonName.style.textShadow = '0 0 16px rgba(239, 68, 68, 0.8)';

        targetConfidenceScore.textContent = '0.0%';
        targetConfidenceFill.style.width = '12%';
        targetDistanceVal.textContent = face.distance ? face.distance.toFixed(4) : '0.5400';
        targetSimilarityVal.textContent = 'LOW MATCH (<40%)';
        targetSecurityTier.textContent = 'ACCESS RESTRICTED';
        targetSecurityTier.className = 'quad-v';
        targetSecurityTier.style.color = '#f87171';
    }
}

function calculateFps() {
    fpsFrames++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        telemetryFps.textContent = Math.round((fpsFrames * 1000) / (now - lastFpsTime));
        fpsFrames = 0;
        lastFpsTime = now;
    }
}

// ===================== UPLOAD PIPELINE =====================
function handleUploadedFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        alert('Silakan pilih file gambar yang valid (JPG, PNG, WEBP).');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        uploadPreviewImg.src = dataUrl;

        uploadPreviewImg.onload = async () => {
            uploadDropzone.style.display = 'none';
            uploadPreviewContainer.style.display = 'flex';

            uploadOverlayCanvas.width = uploadPreviewImg.width;
            uploadOverlayCanvas.height = uploadPreviewImg.height;

            telemetryMatchStatus.textContent = 'ANALYZING BUFFER...';
            const startTime = performance.now();

            try {
                const resp = await fetch(`${API_BASE}/api/recognize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: dataUrl })
                });

                const elapsed = Math.round(performance.now() - startTime);
                telemetryLatency.textContent = `${elapsed} ms`;

                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();

                renderUploadOverlays(data.faces || []);
            } catch (err) {
                alert('Gagal memproses gambar upload: ' + err.message);
                telemetryMatchStatus.textContent = 'BUFFER ERROR';
            }
        };
    };
    reader.readAsDataURL(file);
}

function renderUploadOverlays(faces) {
    uploadOverlayCtx.clearRect(0, 0, uploadOverlayCanvas.width, uploadOverlayCanvas.height);
    telemetryFaceCount.textContent = faces.length;

    if (faces.length === 0) {
        telemetryMatchStatus.textContent = 'NO FACE DETECTED';
        targetEmptyState.style.display = 'flex';
        targetDetectedState.style.display = 'none';
        return;
    }

    const primary = faces[0];
    updateTargetPanel(primary);

    faces.forEach(face => {
        const { x, y, w, h } = face.bbox;
        const isMatch = face.name && face.name !== 'Unknown';

        uploadOverlayCtx.lineWidth = 3;
        uploadOverlayCtx.strokeStyle = isMatch ? '#c77dff' : '#f87171';
        uploadOverlayCtx.shadowColor = isMatch ? 'rgba(199, 125, 255, 0.9)' : 'rgba(239, 68, 68, 0.9)';
        uploadOverlayCtx.shadowBlur = 14;

        uploadOverlayCtx.strokeRect(x, y, w, h);

        const label = isMatch ? `${face.name.toUpperCase()} (${face.confidence}%)` : 'UNKNOWN';
        uploadOverlayCtx.font = 'bold 15px "Orbitron", monospace';
        uploadOverlayCtx.fillStyle = isMatch ? '#c77dff' : '#f87171';
        uploadOverlayCtx.fillText(label, x + 4, y - 8);
    });
}

function resetUpload() {
    uploadDropzone.style.display = 'flex';
    uploadPreviewContainer.style.display = 'none';
    uploadPreviewImg.src = '';
    uploadOverlayCtx.clearRect(0, 0, uploadOverlayCanvas.width, uploadOverlayCanvas.height);
    filePickerInput.value = '';
    targetEmptyState.style.display = 'flex';
    targetDetectedState.style.display = 'none';
    telemetryMatchStatus.textContent = 'IDLE';
}

// ===================== EVENT LISTENERS =====================
btnToggleCamera.addEventListener('click', () => {
    if (isWebcamRunning) {
        stopWebcam();
    } else {
        startWebcam();
    }
});

btnInitializeFeed.addEventListener('click', startWebcam);

btnFlipCamera.addEventListener('click', async () => {
    currentFacingMode = (currentFacingMode === 'user' ? 'environment' : 'user');
    stopWebcam();
    await startWebcam();
});

// Mode Switching
tabWebcam.addEventListener('click', () => {
    tabWebcam.classList.add('active');
    tabUpload.classList.remove('active');
    stageWebcam.style.display = 'flex';
    stageUpload.style.display = 'none';
});

tabUpload.addEventListener('click', () => {
    tabUpload.classList.add('active');
    tabWebcam.classList.remove('active');
    stageWebcam.style.display = 'none';
    stageUpload.style.display = 'flex';
    if (isWebcamRunning) {
        stopWebcam();
    }
});

// Upload events
btnBrowseFile.addEventListener('click', () => filePickerInput.click());
filePickerInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleUploadedFile(e.target.files[0]);
    }
});

uploadDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadDropzone.classList.add('dragover');
});

uploadDropzone.addEventListener('dragleave', () => {
    uploadDropzone.classList.remove('dragover');
});

uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleUploadedFile(e.dataTransfer.files[0]);
    }
});

btnResetUpload.addEventListener('click', resetUpload);

// Search filter
inputRegistrySearch.addEventListener('input', () => {
    renderRegistry(registeredPersons);
});

btnSyncRegistry.addEventListener('click', () => {
    fetchServerStatus();
    fetchPersons();
});

// Config Modal
btnOpenConfig.addEventListener('click', () => {
    cfgApiBase.value = API_BASE;
    configModal.style.display = 'flex';
});

btnServerStatus.addEventListener('click', () => {
    cfgApiBase.value = API_BASE;
    configModal.style.display = 'flex';
});

btnCloseConfig.addEventListener('click', () => {
    configModal.style.display = 'none';
});

btnPresetLocal.addEventListener('click', () => {
    cfgApiBase.value = 'http://localhost:5001';
    const hint = document.getElementById('cfgStatusHint');
    if (hint) hint.textContent = 'Preset Localhost:5001 dipilih. Klik Save & Reconnect.';
});

const btnPresetLocal5000 = document.getElementById('btnPresetLocal5000');
if (btnPresetLocal5000) {
    btnPresetLocal5000.addEventListener('click', () => {
        cfgApiBase.value = 'http://localhost:5000';
        const hint = document.getElementById('cfgStatusHint');
        if (hint) hint.textContent = 'Preset Port 5000 dipilih. Klik Save & Reconnect.';
    });
}

btnPresetTunnel.addEventListener('click', () => {
    cfgApiBase.value = CLOUD_BACKEND_URL;
    const hint = document.getElementById('cfgStatusHint');
    if (hint) hint.textContent = 'Preset Cloudflare Tunnel dipilih. Klik Save & Reconnect.';
});

const btnAutoDetect = document.getElementById('btnAutoDetect');
if (btnAutoDetect) {
    btnAutoDetect.addEventListener('click', async () => {
        const hint = document.getElementById('cfgStatusHint');
        if (hint) hint.textContent = 'Memindai server backend yang aktif...';
        btnAutoDetect.textContent = '⏳ Scanning...';
        const found = await autoDiscoverBackend();
        btnAutoDetect.textContent = '⚡ Auto Detect';
        if (found) {
            cfgApiBase.value = found.url;
            if (hint) hint.textContent = `[OK] Server aktif ditemukan di ${found.url}! Klik Save & Reconnect.`;
        } else {
            if (hint) hint.textContent = '[INFO] Tidak ada server yang merespon. Pastikan start_server.bat sudah dijalankan.';
        }
    });
}

btnResetConfig.addEventListener('click', () => {
    localStorage.removeItem('cuy_face_backend_url');
    API_BASE = defaultApi;
    cfgApiBase.value = API_BASE;
    fetchServerStatus();
    configModal.style.display = 'none';
});

btnSaveConfig.addEventListener('click', () => {
    const val = (cfgApiBase.value || '').trim().replace(/\/+$/, '');
    if (val) {
        localStorage.setItem('cuy_face_backend_url', val);
        API_BASE = val;
    }
    configModal.style.display = 'none';
    fetchServerStatus();
    fetchPersons();
});

// ===================== INITIALIZATION =====================
window.addEventListener('DOMContentLoaded', () => {
    fetchServerStatus();
    fetchPersons();
    setInterval(fetchServerStatus, 5000);
});
