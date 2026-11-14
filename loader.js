// Worker that hosts the engine ("main runtime thread" of the Emscripten module). importScripts('game.js') runs the static constructors
// and main() here; the loop blocks this worker, which is fine (nothing else runs on it). game.js also runs in every pthread worker.
'use strict';
let started = false;
self.addEventListener('error', (ev) => {
	const err = ev.error;
	const detail = err ? `${err.name}: ${err.message}\n${err.stack || ''}` : `${ev.message} (${ev.filename}:${ev.lineno}:${ev.colno})`;
	diagnostic('[loader] UNCAUGHT ERROR: ' + detail);
	self.postMessage({ error: detail });
});
self.addEventListener('unhandledrejection', (ev) => {
	const err = ev.reason;
	const detail = err ? `${err.name || 'Error'}: ${err.message || err}\n${err.stack || ''}` : String(ev.reason);
	diagnostic('[loader] UNHANDLED REJECTION: ' + detail);
	self.postMessage({ error: detail });
});
let diagnosticChannel;
function diagnostic(text) {
	console.info(text);
	(diagnosticChannel || (diagnosticChannel = new BroadcastChannel('game-log'))).postMessage(text);
}
self.onmessage = (ev) => {
	if (started) return;
	started = true;
	const m = ev.data;
	if (m.cores && navigator.hardwareConcurrency !== m.cores) {
		try {
			Object.defineProperty(navigator, 'hardwareConcurrency', { value: m.cores });
		} catch (error) {
			console.warn('[loader] Could not override hardwareConcurrency; continuing with the browser value.', error);
		}
	}
	const gq = new URLSearchParams();
	if (m.slots) gq.set('slots', m.slots);
	if (m.syncPipelines) gq.set('syncpipelines', '1');
	if (m.remoteLog) gq.set('log', '1');
	if (m.lowMemory) gq.set('low', '1');
	if (m.noPack) gq.set('nopack', '1');
	if (m.shotRt) gq.set('shotrt', '1');
	if (m.gpuLimits) gq.set('limits', m.gpuLimits);
	const B = m.base || '';
	const engine = m.memory32 ? 'game-memory32' : 'game';
	const engineScript = '/' + engine + '.js';
	const wasmFile = engine + '.wasm';
	const reportFailure = (error) => self.postMessage({ error });
	diagnostic(`[loader] Starting ${engine}; base path: ${B || '(site root)'}.`);
	diagnostic(`[loader] Game-file cache: ${m.noStore ? 'disabled' : 'enabled'}; local ZIP: ${self.location.search.includes('localzip=1') ? 'enabled' : 'disabled'}.`);
	diagnostic('[loader] Starting GPU and game-data workers.');
	let gpu, io;
	try {
		const gpuUrl = new URL('/wgpu_worker.js', self.location.origin);
		gpuUrl.search = gq.toString();
		gpu = new Worker(gpuUrl);
		const ioUrl = new URL('/io_worker.js', self.location.origin);
		ioUrl.search = self.location.search;
		io = new Worker(ioUrl, { type: 'module' });
	} catch (error) {
		gpu?.terminate();
		diagnostic('[loader] ERROR Could not create a game worker: ' + (error && (error.stack || error.message) || error));
		reportFailure('Could not create a game worker: ' + (error.message || error));
		return;
	}
	io.postMessage({ init: true, base: self.location.origin + '/data/', noStore: !!m.noStore, record: !!m.record, trace: !!m.trace, log: !!m.remoteLog, noHints: !!m.noHints, bootset: m.lowMemory ? 'bootset_low.json' : 'bootset.json' });
	let loaded = 0;
	io.onmessage = (e) => {
		if (e.data.error) {
			diagnostic('[loader] ERROR I/O initialization failed: ' + e.data.error);
			reportFailure(e.data.error);
			return;
		}
		if (e.data.progress) {
			const { current, total, status } = e.data.progress;
			bc0.postMessage({ pct: total ? 18 * current / total : 0, label: status });
		}
		if (e.data.loaded && ++loaded === 2) start();
	};
	gpu.onmessage = (e) => {
		if (e.data.loaded && ++loaded === 2) start();
	};
	const workerError = (name, e) => {
		const location = e.filename ? ` at ${e.filename}:${e.lineno || 0}:${e.colno || 0}` : '';
		const detail = e.message || e.type || 'unknown worker error';
		diagnostic(`[loader] ERROR ${name} worker error${location}: ${detail}${e.error?.stack ? '\n' + e.error.stack : ''}`);
		reportFailure(`${name} worker failed: ${detail}${location}`);
	};
	io.onerror = (e) => workerError('I/O', e);
	gpu.onerror = (e) => workerError('GPU', e);
	const fetchWasm = async () => {
		for (let attempt = 0; ; attempt++) {
			let res = null, err = null;
			diagnostic(`[loader] Fetching ${wasmFile}${attempt ? ` (attempt ${attempt + 1})` : ''}.`);
			try { res = await fetch(B + '/' + wasmFile); } catch (e) { err = e; }
			if (m.memory32 && res?.status === 404) throw new Error('The 32-bit engine file is missing.');
			if (res && res.ok) {
				diagnostic(`[loader] ${wasmFile} response: HTTP ${res.status}; ${res.headers.get('Content-Type') || 'unknown content type'}; ${res.headers.get('Content-Length') || 'unknown'} bytes; ${res.url || wasmFile}.`);
				return res;
			}
			diagnostic(`[loader] ${wasmFile} request failed: ${res ? `HTTP ${res.status} ${res.statusText}; ${res.url || wasmFile}` : err && (err.stack || err.message) || 'network error'}`);
			if (attempt >= 7) { if (res) throw new Error('HTTP ' + res.status + ' for ' + wasmFile); throw err; }
			bc0.postMessage({ label: 'The server is busy, retrying (' + (attempt + 1) + ')' });
			await new Promise((r) => setTimeout(r, Math.min(5000, 300 * 2 ** attempt) * (0.5 + Math.random())));
		}
	};
	const bc0 = new BroadcastChannel('game-progress');
	const start = () => {
		const bc = new BroadcastChannel('game-progress');
		self.Module = {
			instantiateWasm: (imports, done) => {
				const buffered = async () => {
					const res = await fetchWasm();
					const total = +(res.headers.get('X-Uncompressed-Length') || res.headers.get('Content-Length')) || 0;
					const reader = res.body.getReader(), chunks = [];
					let got = 0;
					for (;;) {
						const { done: end, value } = await reader.read();
						if (end) break;
						chunks.push(value);
						got += value.length;
						bc.postMessage({ pct: total ? 20 * got / total : 0, label: 'Downloading the engine (' + (got / 1048576 | 0) + ' MB)' });
					}
					const bytes = new Uint8Array(got);
					let o = 0;
					for (const c of chunks) { bytes.set(c, o); o += c.length; }
					bc.postMessage({ pct: 20, label: 'Compiling the engine' });
					return WebAssembly.instantiate(bytes, imports);
				};
				const streaming = async (res) => {
					const total = +(res.headers.get('X-Uncompressed-Length') || res.headers.get('Content-Length')) || 0;
					const counter = res.clone().body.getReader();
					(async () => {
						let got = 0;
						for (;;) {
							const { done: end, value } = await counter.read();
							if (end) break;
							got += value.length;
							bc.postMessage({ pct: total ? 20 * got / total : 0, label: 'Downloading and compiling the engine (' + (got / 1048576 | 0) + ' MB)' });
						}
						bc.postMessage({ pct: 20, label: 'Compiling the engine' });
					})().catch(() => {});
					return WebAssembly.instantiateStreaming(res, imports);
				};
				(async () => {
					const res = await fetchWasm();
					let r;
					try { r = await streaming(res); }
					catch (e) { console.warn('streaming instantiation failed (' + e + '): downloading first'); r = await buffered(); }
					bc.postMessage({ pct: 22, label: 'Starting the engine' });
					done(r.instance, r.module);
				})().catch((e) => reportFailure('Could not load ' + wasmFile + '. ' + e.message));
				return {};
			},
			canvas: m.canvas,
			arguments: m.args,
			wgpuWorker: gpu,
			ioWorker: io,
			fullConsole: !!m.fullConsole,
			remoteLog: !!m.remoteLog,
			wgpuShaderUrl: B + '/shaders',
			wgpuShotEvery: m.shotEvery,
			keepThreads: m.keepThreads | 0,
			mainScriptUrlOrBlob: engineScript + ((m.fullConsole || m.remoteLog) ? '?' + [m.fullConsole ? 'console=1' : '', m.remoteLog ? 'log=1' : ''].filter(Boolean).join('&') : ''),
			locateFile: (p) => B + '/' + p,
			onExit: (code) => { console.error('EXIT ' + code); self.__log('EXIT ' + code); self.__logFlush(); if (code) self.__crash('exit', 'EXIT ' + code); },
			onAbort: (what) => { console.error('ABORT ' + what); self.__log('ABORT ' + what); self.__logFlush(); self.__crash('abort', 'ABORT ' + what); },
			preRun: [() => {
				if (typeof FS === 'undefined' || typeof addRunDependency !== 'function' || typeof indexedDB === 'undefined') return;
				addRunDependency('userdata');
				let finished = false;
				const finish = (note) => { if (finished) return; finished = true; self.__log('[loader] userdata: ' + note); self.__logFlush(); removeRunDependency('userdata'); };
				setTimeout(() => finish('timed out'), 8000);
				try {
					const r = indexedDB.open('gta5-userdata', 1);
					r.onupgradeneeded = () => r.result.createObjectStore('files');
					r.onerror = () => finish('IndexedDB unavailable: ' + r.error);
					r.onsuccess = () => {
						let n = 0, bytes = 0;
						try {
							const req = r.result.transaction('files', 'readonly').objectStore('files').openCursor();
							req.onerror = () => finish('read failed: ' + req.error);
							req.onsuccess = () => {
								const c = req.result;
								if (!c) { finish('restored ' + n + ' file(s), ' + bytes + ' bytes'); return; }
								const path = String(c.key);
								try {
									if (path.startsWith('/userdata/') && c.value && c.value.data) {
										FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
										FS.writeFile(path, c.value.data);
										FS.utime(path, c.value.mtime, c.value.mtime);
										n++; bytes += c.value.data.length;
									}
								} catch (e) { self.__log('[loader] userdata: ' + path + ' not restored: ' + e); }
								c.continue();
							};
						} catch (e) { finish('read failed: ' + e); }
					};
				} catch (e) { finish('failed: ' + e); }
			}],
		};
		console.log('loader: starting engine: ' + m.args.join(' ') + ' (cores ' + m.cores + ')');
		try {
			console.info('[loader] Loading engine script:', engineScript);
			importScripts(engineScript);
		} catch (e) {
			console.error(e);
			reportFailure('Could not load ' + engine + '.js. ' + (m.memory32 ? 'Install the matching 32-bit engine files.' : e.message));
		}
	};
};
