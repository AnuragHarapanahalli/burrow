// Google sign-in. Google refuses to sign you in from browsers it thinks are "embedded" Chromium
// ("This browser or app may not be secure"), judging by the browser's identity: Burrow looks like
// Chrome, but without the "Google Chrome" brand that real Chrome sends in its client hints.
// Like other independent browsers, Burrow presents itself as Firefox — which Google allows — on
// Google's sign-in pages only (accounts.google.com). Everywhere else Burrow stays Chrome.
const SIGNIN_HOST = 'accounts.google.com';

// A current Firefox version: Firefox 145 came out on 11 Nov 2025 and a new one follows every 4 weeks.
function firefoxUA(now = Date.now()) {
  const v = 145 + Math.max(0, Math.floor((now - Date.UTC(2025, 10, 11)) / (28 * 864e5)));
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}

function isSignIn(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === SIGNIN_HOST; } catch { return false; }
}

// The request headers Google's sign-in pages get: Firefox's identity, and no Chromium client hints.
function signInHeaders(headers) {
  const h = { ...headers, 'User-Agent': firefoxUA() };
  for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
  return h;
}

function attach(ses) {
  ses.webRequest.onBeforeSendHeaders({ urls: [`https://${SIGNIN_HOST}/*`] }, (details, cb) => {
    cb({ requestHeaders: signInHeaders(details.requestHeaders) });
  });
}

module.exports = { attach, isSignIn, firefoxUA, signInHeaders, SIGNIN_HOST };
