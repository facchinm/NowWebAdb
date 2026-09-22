/**
 * ADB Socket HTTP Proxy Service Worker.
 *
 * Intercepts every request (document, CSS, JS, XHR/fetch, dynamic imports)
 * made under this worker's scope and relays it over a BroadcastChannel to the
 * main app page, which performs the real request over an ADB socket and
 * replies with the raw response. This lets an arbitrary bundled web app (SPA)
 * served by an Android device render correctly inside our own origin, since
 * the browser's normal network stack never has to reach the device directly.
 *
 * BroadcastChannel (not the Clients API) is used because the main app page
 * lives outside this worker's scope, so it is never returned by
 * self.clients.matchAll() / self.clients.get() - those only see pages
 * actually controlled within scope.
 *
 * This worker is registered at scope '/' (not just PROXY_SCOPE) because
 * proxied pages commonly reference their own assets with absolute paths
 * (e.g. "/assets/app.js"), which the browser resolves against the origin
 * root, not the "/adb-proxy/" prefix the document itself was loaded from.
 * Requests outside PROXY_SCOPE are only proxied when their Referer shows
 * they were made by a page under PROXY_SCOPE; everything else (the main
 * app's own requests) is left untouched. Referrer-Policy is stripped from
 * proxied responses so that detection keeps working even when the device's
 * own server sends "no-referrer" or similar.
 *
 * Security note: content proxied this way runs with this page's own origin,
 * so it can reach the controlling app's DOM via window.parent. Only use this
 * for services you trust.
 */

const CHANNEL_NAME = 'adb-proxy-channel';
const PROXY_SCOPE = '/adb-proxy/';
const pending = new Map();
let requestCounter = 0;

const channel = new BroadcastChannel(CHANNEL_NAME);
channel.onmessage = (event) => {
  const { type, id } = event.data || {};
  if (type !== 'ADB_PROXY_RESPONSE') return;
  const resolve = pending.get(id);
  if (resolve) {
    pending.delete(id);
    resolve(event.data);
  }
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isUnderProxyScope = url.pathname.startsWith(PROXY_SCOPE);
  const referredByProxyPage = event.request.referrer?.startsWith(self.location.origin + PROXY_SCOPE);

  if (!isUnderProxyScope && !referredByProxyPage) {
    // Surface anything that looks like a device asset but wasn't recognized,
    // so the app's traffic log shows whether requests are truly not
    // happening vs. silently escaping the proxy.
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/static/')) {
      channel.postMessage({ type: 'ADB_PROXY_SKIPPED', url: url.href, referrer: event.request.referrer || '(none)' });
    }
    return; // not ours, let the network handle it
  }
  event.respondWith(proxyFetch(event.request, isUnderProxyScope));
});

async function proxyFetch(request, isUnderProxyScope) {
  const url = new URL(request.url);
  // Requests actually under /adb-proxy/ map to the device path by stripping the
  // prefix; absolute-path assets detected purely via referrer keep their real
  // path as-is, since that's exactly what the device serves at that path.
  const path = isUnderProxyScope
    ? (url.pathname.slice(PROXY_SCOPE.length - 1) + url.search || '/')
    : (url.pathname + url.search);

  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }

  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  const id = `req-${Date.now()}-${requestCounter++}`;

  const responseData = await new Promise((resolve) => {
    pending.set(id, resolve);
    channel.postMessage({ type: 'ADB_PROXY_REQUEST', id, method: request.method, path, headers, body });

    // Give up if the page never answers (e.g. forwarding was stopped mid-flight).
    // Generous timeout since requests are now processed one at a time on the
    // page side, so later requests in a burst can wait a while for their turn.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ error: 'Timed out waiting for the app page to service this request' });
      }
    }, 30000);
  });

  if (responseData?.error) {
    return new Response(`ADB proxy error: ${responseData.error}`, { status: 502 });
  }

  const strippedHeaders = new Set([
    'content-security-policy',
    'content-security-policy-report-only',
    'x-frame-options',
    'content-encoding',
    'transfer-encoding',
    'connection',
    'referrer-policy'
  ]);

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(responseData.headers || {})) {
    if (!strippedHeaders.has(key.toLowerCase())) {
      try {
        responseHeaders.set(key, value);
      } catch {
        // some header values may be invalid for the Headers API - skip them
      }
    }
  }

  return new Response(responseData.bodyBytes ? new Uint8Array(responseData.bodyBytes) : null, {
    status: responseData.status || 502,
    statusText: responseData.statusText || '',
    headers: responseHeaders
  });
}
