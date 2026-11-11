// public/loader.js

const ioWorker = new Worker('./io_worker.js', { type: 'module' });

// Initiate worker startup sequence
ioWorker.postMessage({
  init: true,
  base: './', // Root path for game data manifests
  noStore: false
});

ioWorker.onmessage = (e) => {
  const m = e.data;

  // Track background extraction progress
  if (m.progress) {
    const { current, total, status } = m.progress;
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status-text');

    if (progressBar) progressBar.style.width = `${(current / total) * 100}%`;
    if (statusText) statusText.innerText = status;
  }

  // Once assets are ready, boot WASM runtime
  if (m.loaded) {
    console.log('[Loader UI] OPFS asset cache verified. Launching WebAssembly engine...');
    const loaderScreen = document.getElementById('loader-screen');
    if (loaderScreen) loaderScreen.style.display = 'none';

    bootGameEngine();
  }
};

function bootGameEngine() {
  // Launch main game WASM entry point
  console.log('[Loader UI] Engine initialized.');
}
