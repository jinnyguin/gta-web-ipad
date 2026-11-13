export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  let targetUrl;
  if (path.startsWith('/release-proxy/v1/')) {
    const file = path.slice('/release-proxy/v1/'.length);
    targetUrl = `https://github.com/jinnyguin/gta-web-ipad/releases/download/files/${file}`;
  } else if (path.startsWith('/release-proxy/v2/')) {
    const file = path.slice('/release-proxy/v2/'.length);
    targetUrl = `https://github.com/alihammoud21/playgta5/releases/download/full-game-v1/${file}`;
  } else {
    return new Response('Not found', { status: 404 });
  }

  const upstream = await fetch(targetUrl, { redirect: 'follow' });
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
