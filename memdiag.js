// memdiag.js - tells you whether a crash is (a) memory.grow hitting the wasm32
// ceiling, (b) a wasm trap for another reason, or (c) a silent tab kill (Jetsam).
// Works as a classic script or via importScripts() in workers. Uses globalThis only.
(() => {
  const PAGE = 65536, CEIL = 32768;                 // 2 GiB in wasm pages
  const toMB = p => Math.round(p * PAGE / 1048576);
  const log = (...a) => console.log('[memdiag]', ...a);
  const HB_FILE = 'memdiag-heartbeat.json';
  const isWindow = typeof window !== 'undefined';

  // ---------------------------------------------------------------- 1. grow hook
  // Install in EVERY thread (main, wgpu worker, io worker) BEFORE the wasm module
  // is instantiated. Catches JS-side growth (Emscripten's emscripten_resize_heap).
  // If you never see "grow" lines but the heap grows, the binary calls the
  // memory.grow instruction directly; rely on the watchdog below instead.
  function installGrowHook(label = 'main') {
    const proto = WebAssembly.Memory.prototype;
    if (proto.__memdiag) return;
    const orig = proto.grow;
    proto.grow = function (delta) {
      globalThis.__memdiagMem = this;
      const before = this.buffer.byteLength / PAGE;
      try {
        const prev = orig.call(this, delta);
        const after = this.buffer.byteLength / PAGE;
        if (delta >= 256 || after >= CEIL - 2048) {
          log(`${label} grow +${toMB(delta)} MB: ${toMB(before)} -> ${toMB(after)} MB (${after}/${CEIL} pages)`);
        }
        return prev;
      } catch (e) {
        log(`${label} GROW FAILED asking +${toMB(delta)} MB at ${toMB(before)} MB (${before}/${CEIL} pages):`, e && e.message);
        console.trace('[memdiag] grow failure stack');
        throw e;
      }
    };
    proto.__memdiag = true;
    log(`${label}: grow hook installed`);
  }

  // ------------------------------------------------- 2. watchdog + heartbeat file
  // The main thread is blocked inside callMain, so polling must live in its own
  // worker. It writes a heartbeat to OPFS every 250 ms. If the tab is killed
  // silently, the file survives and the next load can read it.
  const WD_SRC = `
    let mem, fh, peak = 0, phase = 'boot', outcome = 'running', meta = {};
    const enc = new TextEncoder();
    function write() {
      if (!fh) return;
      const pages = mem ? mem.buffer.byteLength / 65536 : 0;
      peak = Math.max(peak, pages);
      const b = enc.encode(JSON.stringify(Object.assign({ t: Date.now(), pages, peak, phase, outcome }, meta)));
      try { fh.truncate(0); fh.write(b, { at: 0 }); fh.flush(); } catch (e) {}
    }
    onmessage = async (e) => {
      const m = e.data;
      if (m.type === 'start') {
        mem = m.memory; meta = { search: m.search, ua: m.ua };
        try {
          const root = await navigator.storage.getDirectory();
          const f = await root.getFileHandle('${HB_FILE}', { create: true });
          fh = await f.createSyncAccessHandle();
        } catch (err) { postMessage({ error: String(err) }); return; }
        setInterval(write, 250);
      } else if (m.type === 'phase') { phase = m.phase; write(); }
      else if (m.type === 'outcome') { outcome = m.outcome; write(); }
    };`;

  let wd = null;
  function startWatchdog(memory) {
    if (!memory) { log('startWatchdog: pass the WebAssembly.Memory'); return; }
    wd = new Worker(URL.createObjectURL(new Blob([WD_SRC], { type: 'text/javascript' })));
    wd.onmessage = e => e.data.error && log('watchdog error:', e.data.error);
    wd.postMessage({ type: 'start', memory, search: location.search, ua: navigator.userAgent });
    if (isWindow) {
      addEventListener('error', e => wd.postMessage({ type: 'outcome', outcome: 'js-error: ' + (e.message || '') }));
      addEventListener('unhandledrejection', e => wd.postMessage({ type: 'outcome', outcome: 'js-error: ' + (e.reason && e.reason.message || e.reason) }));
      // pagehide fires on navigation/backgrounding but normally NOT on a Jetsam kill
      addEventListener('pagehide', () => wd.postMessage({ type: 'outcome', outcome: 'pagehide' }));
    }
    log('watchdog started');
  }
  const setPhase = p => wd && wd.postMessage({ type: 'phase', phase: p });
  // Call from your catch around callMain:  memdiag.reportCrash(err)
  const reportCrash = err => wd && wd.postMessage({ type: 'outcome', outcome: (err && err.name || 'error') + ': ' + (err && err.message || '') });

  // ------------------------------------------------------ 3. previous-run recorder
  // Call once at startup, BEFORE startWatchdog(). Reads the last heartbeat,
  // classifies how the previous run ended, appends it to localStorage and prints a table.
  async function recordPreviousRun() {
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(HB_FILE);
      const r = JSON.parse(await (await fh.getFile()).text());
      let verdict;
      if (r.outcome === 'running') {
        verdict = r.peak >= CEIL - 256
          ? 'SILENT KILL near 2 GiB (heap ceiling or Jetsam at the top)'
          : 'SILENT KILL below ceiling (likely Jetsam / tab memory limit)';
      } else if (/RuntimeError|RangeError/.test(r.outcome)) {
        verdict = r.peak >= CEIL - 256 ? 'TRAP at ceiling (heap exhaustion)' : 'TRAP below ceiling (not a heap-limit problem)';
      } else verdict = r.outcome;
      const row = { when: new Date(r.t).toISOString(), search: r.search, phase: r.phase,
                    peakMB: toMB(r.peak), lastMB: toMB(r.pages), verdict };
      const runs = JSON.parse(localStorage.getItem('memdiag.runs') || '[]');
      runs.push(row); localStorage.setItem('memdiag.runs', JSON.stringify(runs.slice(-50)));
      console.table(runs.slice(-10));
      return row;
    } catch (e) { log('no previous run recorded'); return null; }
  }

  // ------------------------------------------- 4. wasm memory limits from the binary
  // Reads the import/memory sections (they sit near the start) without downloading
  // the whole file. If max < 32768 pages, the real ceiling is lower than 2 GiB.
  async function readWasmMemoryLimits(url, limit = 4 * 1024 * 1024) {
    const res = await fetch(url);
    const reader = res.body.getReader(), chunks = [];
    let n = 0;
    while (n < limit) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
    reader.cancel();
    const buf = new Uint8Array(n); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    let p = 8;
    const leb = () => { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
    const out = [];
    const limits = where => {
      const f = buf[p++], min = leb(), max = (f & 1) ? leb() : null;
      out.push({ where, shared: !!(f & 2), memory64: !!(f & 4), minPages: min, maxPages: max,
                 minMB: toMB(min), maxMB: max == null ? null : toMB(max) });
    };
    while (p < buf.length) {
      const id = buf[p++], size = leb(), end = p + size;
      if (end > buf.length) break;
      if (id === 2) {
        const cnt = leb();
        for (let i = 0; i < cnt; i++) {
          p += leb(); p += leb();                    // module + field names
          const kind = buf[p++];
          if (kind === 0) leb();                      // func type index
          else if (kind === 1) { p++; const f = buf[p++]; leb(); if (f & 1) leb(); } // table
          else if (kind === 2) limits('import');
          else if (kind === 3) p += 2;                // global
          else if (kind === 4) { p++; leb(); }        // tag
        }
      } else if (id === 5) {
        const cnt = leb(); for (let i = 0; i < cnt; i++) limits('defined');
      }
      p = end;
    }
    console.table(out);
    return out;
  }

  // --------------------------------------------------------- 5. flag sweep planner
  // Builds one URL per variant so you can compare peak heap per flag.
  // Run each URL once; recordPreviousRun() logs peakMB per search string.
  function sweepPlan(base, args) {
    const mk = a => base + (a.length ? '&args=' + a.join(',') : '');
    const plan = [{ name: 'baseline', url: mk([]) }, ...args.map(a => ({ name: '+' + a, url: mk([a]) })), { name: 'all', url: mk(args) }];
    console.table(plan); return plan;
  }

  globalThis.memdiag = { installGrowHook, startWatchdog, setPhase, reportCrash, recordPreviousRun, readWasmMemoryLimits, sweepPlan };
})();
