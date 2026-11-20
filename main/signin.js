// Google sign-in. Google refuses to sign you in from browsers it thinks are "embedded"
// ("This browser or app may not be secure"). What other Electron browsers found in late 2026:
//   • Pretending to be Firefox gets caught: the page's scripts can tell the engine is Chromium,
//     and a browser that lies about itself looks suspicious. (Burrow did this from 0.2.1 to 0.3.0.)
//   • "chrome" pieces: real Chrome has window.chrome.app / .csi / .loadTimes; Electron leaves
//     window.chrome empty. Filling them in got a real account past the block (Nuphos).
//   • "electron" identity: on Google's sign-in pages only, say honestly what Burrow is: Electron's
//     own user agent with Chromium's normal client hints, everything consistent (Orca).
// Google changes its checks often, so the method is a setting: 'chrome' (default: it signed you in on
// 2026-11-20, where 'both' was refused), 'both' or 'electron' (Ctrl+K → "Google sign-in method"). If Google still refuses, Burrow notices its
// "Couldn't sign you in" page and offers the next method.
const SIGNIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com'];
const METHODS = ['chrome', 'both', 'electron']; // the first is the default; "Try it" goes down the list
const METHOD_NAMES = { both: 'Chrome pieces + Electron identity', chrome: 'Chrome pieces', electron: 'Electron identity' };

let store = null;
let selftest = false;
let electronUA = '';       // Electron's own user agent, recorded before Burrow cleans it up

function init(opts) {
  store = opts.store;
  selftest = !!opts.selftest;
  electronUA = opts.electronUA || electronUA;
}

function method() {
  const m = store?.get('signInMethod');
  return METHODS.includes(m) ? m : METHODS[0];
}
function setMethod(m) { if (METHODS.includes(m)) store.set('signInMethod', m); return method(); }
function nextMethod() { return METHODS[(METHODS.indexOf(method()) + 1) % METHODS.length]; }

// Google's sign-in pages (the self-test adds a local stand-in: 127.0.0.1/__burrow_signin_test).
function isSignIn(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && SIGNIN_HOSTS.includes(u.hostname)) return true;
    return selftest && u.hostname === '127.0.0.1' && u.pathname.startsWith('/__burrow_signin_test');
  } catch { return false; }
}

// Google's "Couldn't sign you in" page.
function isRejected(url) {
  return isSignIn(url) && /\/signin\/(v\d\/)?rejected|\/v\d\/signin\/rejected/.test(new URL(url).pathname);
}

const useElectronUA = () => method() !== 'chrome' && !!electronUA;
const useChromePieces = () => method() !== 'electron';

// The user agent a tab should use for this address ('' = Burrow's normal one).
function uaFor(url) { return isSignIn(url) && useElectronUA() ? electronUA : ''; }

// What a page's preload needs to know before the page's own scripts run.
function identityFor(url) {
  let web = false;
  try { web = /^https?:$/.test(new URL(url).protocol); } catch { /* not a web page */ }
  return { chromePieces: web && useChromePieces(), ua: uaFor(url) || null };
}

// Where to start again after a refusal: the page you were signing in to, if Google says.
function retryUrl(rejectedUrl) {
  try {
    const u = new URL(rejectedUrl);
    if (u.hostname === '127.0.0.1') return `${u.origin}/__burrow_signin_test/start`; // (the self-test's stand-in)
    const c = new URL(rejectedUrl).searchParams.get('continue');
    if (c && /^https:\/\//.test(c)) return `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(c)}`;
  } catch { /* fall through */ }
  return 'https://accounts.google.com/';
}

// Requests to the sign-in pages carry the same identity as the page (client hints are left alone:
// they're Chromium's own, which matches Electron's user agent).
function attach(ses) {
  const urls = SIGNIN_HOSTS.map((h) => `https://${h}/*`).concat(selftest ? ['http://127.0.0.1/__burrow_signin_test*'] : []);
  ses.webRequest.onBeforeSendHeaders({ urls }, (details, cb) => {
    const ua = uaFor(details.url);
    cb({ requestHeaders: ua ? { ...details.requestHeaders, 'User-Agent': ua } : details.requestHeaders });
  });
}

module.exports = { init, attach, method, setMethod, nextMethod, isSignIn, isRejected, uaFor, identityFor, retryUrl, METHODS, METHOD_NAMES };
