// public/loader.js

const ioWorkerUrl = new URL('./io_worker.js', self.location.href);
ioWorkerUrl.search = new URL(self.location.href).search;
const ioWorker = new Worker(ioWorkerUrl, { type: 'module' });

// Boot worker and pass engine parameters
ioWorker.postMessage({
  init: true,
  base: './',
  noStore: false
});

ioWorker.onmessage = (e) => {
  const m = e.data;

  // 1. Update your existing game progress bar & status text
  if (m.progress) {
    const { current, total, status } = m.progress;
    const progressPercent = (current / total) * 100;

    // Map to your original HTML elements
    const progressBar = document.getElementById('progress-bar') || document.querySelector('.progress-fill');
    const statusText = document.getElementById('status-text') || document.querySelector('.loading-status');

    if (progressBar) progressBar.style.width = `${progressPercent}%`;
    if (statusText) statusText.innerText = `${status} (${Math.round(progressPercent)}%)`;
  }

  // 2. Hide loading screen and reveal game canvas when OPFS is ready
  if (m.loaded) {
    console.log('[Loader UI] Assets verified in OPFS. Booting game engine...');

    // Fade out or hide your original loading screen wrapper
    const loadingScreen = document.getElementById('loading-screen') || document.getElementById('loader-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
    }

    bootGameEngine();
  }
};

function bootGameEngine() {
  console.log('[Loader UI] Game engine initializing...');
}
