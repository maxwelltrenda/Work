// Phone/tablet camera as a barcode scanner. Loads the decoder only when the
// camera is first opened, shows a full-screen viewfinder, and hands each new
// code to onCode() exactly like a scan from the Bluetooth scanner.

const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
let libLoading;

function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  libLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = resolve;
    s.onerror = () => { libLoading = null; reject(new Error('Could not load the camera scanner. Check the connection and try again.')); };
    document.head.appendChild(s);
  });
  return libLoading;
}

export async function openCamera(onCode, { hint = 'Point the camera at a barcode' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'cam-overlay';
  overlay.innerHTML = `
    <div class="cam-box">
      <div class="cam-head"><span class="eyebrow" style="margin:0">Camera scanner</span><button class="btn small" id="cam-done">Done</button></div>
      <div id="cam-view"></div>
      <div class="cam-msg" id="cam-msg">${hint}</div>
    </div>`;
  document.body.appendChild(overlay);
  const msg = overlay.querySelector('#cam-msg');
  let scanner = null;
  let closed = false;
  let last = { code: '', at: 0 };
  let busy = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('hashchange', close);
    try { if (scanner?.isScanning) await scanner.stop(); } catch { /* already stopped */ }
    try { scanner?.clear(); } catch { /* nothing to clear */ }
    overlay.remove();
  };
  overlay.querySelector('#cam-done').addEventListener('click', close);
  window.addEventListener('hashchange', close);

  try {
    await loadLib();
    if (closed) return;
    const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = window;
    scanner = new Html5Qrcode('cam-view', {
      formatsToSupport: [F.CODE_128, F.CODE_39, F.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false,
    });
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 12,
        // A wide, short box suits 1D barcodes.
        qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.9, 380)), height: Math.floor(Math.min(h * 0.5, 160)) }),
      },
      async (text) => {
        const code = text.trim();
        const now = Date.now();
        // Ignore the same label still in view, and anything while the last scan saves.
        if (busy || (code === last.code && now - last.at < 2500)) return;
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
      },
      () => { /* no barcode in this frame */ },
    );
  } catch (e) {
    const denied = /Permission|NotAllowed|denied/i.test(String(e?.name || e?.message || e));
    msg.className = 'cam-msg err';
    msg.textContent = denied
      ? 'Camera access is blocked. Allow the camera for this site in your browser settings (iPhone: Settings → Safari → Camera), then try again.'
      : (e?.message || 'The camera could not start.');
  }
}
