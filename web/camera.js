// Phone/tablet camera as a barcode scanner. Shows a full-screen viewfinder and
// hands each new code to onCode() exactly like a scan from the Bluetooth scanner.
//
// Reads the camera at full resolution and decodes a wide strip across the
// middle of the picture. Uses the phone's own barcode reader when it has one
// (Android Chrome); otherwise ZXing's C++ engine in WebAssembly (iPhone), which
// reads long, thin Code 128 labels far better than the old JavaScript decoder.

const ZX = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist';
let zxing = null;

async function loadZxing() {
  if (zxing) return zxing;
  const mod = await import(`${ZX}/es/reader/index.js`);
  mod.prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? `${ZX}/reader/${path}` : prefix + path) },
  });
  zxing = mod;
  return zxing;
}

async function nativeDetector() {
  try {
    if (!('BarcodeDetector' in window)) return null;
    const have = await window.BarcodeDetector.getSupportedFormats();
    const want = ['code_128', 'code_39', 'qr_code'].filter((f) => have.includes(f));
    return want.includes('code_128') ? new window.BarcodeDetector({ formats: want }) : null;
  } catch { return null; }
}

export async function openCamera(onCode, { hint = 'Point the camera at a barcode' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'cam-overlay';
  overlay.innerHTML = `
    <div class="cam-box">
      <div class="cam-head"><span class="eyebrow" style="margin:0">Camera scanner</span><button class="btn small" id="cam-done">Done</button></div>
      <div id="cam-view" class="cam-view"><video playsinline muted autoplay></video><div class="cam-guide" aria-hidden="true"></div></div>
      <div class="cam-msg" id="cam-msg">${hint}</div>
    </div>`;
  document.body.appendChild(overlay);
  const msg = overlay.querySelector('#cam-msg');
  const video = overlay.querySelector('video');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let closed = false;
  let timer = null;
  let last = { code: '', at: 0 };
  let busy = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    window.removeEventListener('hashchange', close);
    stream?.getTracks().forEach((t) => t.stop());
    overlay.remove();
  };
  overlay.querySelector('#cam-done').addEventListener('click', close);
  window.addEventListener('hashchange', close);

  const found = async (text) => {
    const code = String(text || '').trim();
    const now = Date.now();
    // Ignore the same label still in view, and anything while the last scan saves.
    if (!code || busy || (code === last.code && now - last.at < 2500)) return;
    last = { code, at: now };
    busy = true;
    navigator.vibrate?.(60);
    msg.className = 'cam-msg';
    msg.textContent = `Scanned ${code}…`;
    try {
      const result = await onCode(code);
      if (result?.close) { close(); return; }
      msg.className = `cam-msg ${result?.ok === false ? 'err' : 'ok'}`;
      msg.textContent = result?.text || `Scanned ${code}`;
    } finally {
      busy = false;
    }
  };

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera. Try Safari or Chrome.');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
    // Keep refocusing (labels are read up close).
    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const detector = await nativeDetector();
    const zx = detector ? null : await loadZxing();

    const tick = async () => {
      if (closed) return;
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h && !busy) {
          // A wide strip across the middle, like the guide box on screen.
          const sw = Math.round(w * 0.9);
          const sh = Math.round(Math.min(h * 0.45, sw * 0.45));
          canvas.width = sw;
          canvas.height = sh;
          ctx.drawImage(video, Math.round((w - sw) / 2), Math.round((h - sh) / 2), sw, sh, 0, 0, sw, sh);
          if (detector) {
            const hits = await detector.detect(canvas);
            if (hits[0]) await found(hits[0].rawValue);
          } else {
            const hits = await zx.readBarcodes(ctx.getImageData(0, 0, sw, sh), {
              formats: ['Code128', 'Code39', 'QRCode'], tryHarder: true, maxNumberOfSymbols: 1,
            });
            if (hits[0]?.isValid) await found(hits[0].text);
          }
        }
      } catch { /* try the next frame */ }
      if (!closed) timer = setTimeout(tick, 120);
    };
    tick();
  } catch (e) {
    const denied = /Permission|NotAllowed|denied/i.test(String(e?.name || e?.message || e));
    msg.className = 'cam-msg err';
    msg.textContent = denied
      ? 'Camera access is blocked. Allow the camera for this site in your browser settings (iPhone: Settings → Safari → Camera), then try again.'
      : (e?.message || 'The camera could not start.');
  }
}
