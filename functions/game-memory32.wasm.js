export async function onRequest() {
  const GITHUB_WASM_URL = 'https://github.com/jinnyguin/gta-web-ipad/releases/download/files/game-memory32.wasm';

  const upstream = await fetch(GITHUB_WASM_URL, { redirect: 'follow' });
  if (!upstream.ok) {
    return new Response(`Failed to fetch WASM: HTTP ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', 'application/wasm');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
