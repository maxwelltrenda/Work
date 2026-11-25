// Bramblebrook rules engine: the game's own code (src/js), run with no page. Built by build.sh; do not edit.
// Evaluating this file sets globalThis.__engine = { load(content), fresh(), replay(state, moves, opt), hashState(state) }.
// The game code runs inside a function whose parameters stand in for the page (timers, document, storage), so
// nothing here touches the host's own globals.
globalThis.__ENGINE__ = true;
globalThis.__engineQueue = [];
var __engineEnv = (() => {
  const q = globalThis.__engineQueue;
  const node = new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      return node;
    },
    set() { return true; },
    apply() { return node; },
  });
  const mem = {};
  const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const win = { claude: undefined, scrollTo() {}, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), innerWidth: 400, innerHeight: 800 };
  return {
    // whatever the page would do a moment later runs straight after the move (99-engine.js drains them)
    setTimeout: fn => { if (typeof fn === 'function') q.push(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    document: node, window: win, addEventListener: () => {}, removeEventListener: () => {},
    localStorage: storage, sessionStorage: storage,
    fetch: () => Promise.reject(new Error('The rules engine has no network.')),
    confirm: () => true, alert: () => {}, matchMedia: win.matchMedia,
    navigator: { userAgent: 'bramblebrook-engine', onLine: true, clipboard: { writeText: () => Promise.resolve() } },
    location: { search: '', hash: '', href: '' },
  };
})();
