// Reader view: shows the article Readability extracted, cleaned up and in Burrow's typography.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const original = (() => { const u = params.get('u') || ''; return /^https?:\/\//i.test(u) ? u : ''; })();

// ---------- Safety: keep only plain article content ----------
const DROP = 'script,style,iframe,frame,frameset,object,embed,form,input,button,select,textarea,link,meta,base,svg,math,noscript,template,dialog';
const SAFE_URL = /^(https?:|mailto:|#)/i;
function sanitize(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'datetime', 'cite'].includes(name);
      if (!keep) { el.removeAttribute(attr.name); continue; }
      if ((name === 'href' || name === 'src') && !SAFE_URL.test(attr.value.trim())) {
        // data: images are fine for pictures; anything else (javascript:, file:…) goes.
        if (!(name === 'src' && el.tagName === 'IMG' && /^data:image\//i.test(attr.value.trim()))) el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); el.setAttribute('referrerpolicy', 'no-referrer'); }
  });
  return doc.body;
}

// ---------- Text size + font (remembered on this computer) ----------
const SIZES = [16, 17, 18, 19, 20, 22, 24, 26];
let size = 3;
let serif = false;
try { size = Math.min(SIZES.length - 1, Math.max(0, Number(localStorage.getItem('reader-size') ?? 3))); serif = localStorage.getItem('reader-serif') === '1'; } catch { /* no storage */ }
function applyType() {
  document.documentElement.style.setProperty('--rsize', SIZES[size] + 'px');
  document.body.classList.toggle('serif', serif);
  $('serif').setAttribute('aria-pressed', String(serif));
  try { localStorage.setItem('reader-size', String(size)); localStorage.setItem('reader-serif', serif ? '1' : '0'); } catch { /* fine */ }
}
$('smaller').onclick = () => { size = Math.max(0, size - 1); applyType(); };
$('bigger').onclick = () => { size = Math.min(SIZES.length - 1, size + 1); applyType(); };
$('serif').onclick = () => { serif = !serif; applyType(); };
applyType();

// ---------- Load the article ----------
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
$('original').href = original || '#';
$('site').textContent = host(original);

function showMissing() {
  $('article').innerHTML = '';
  const p = document.createElement('p');
  p.className = 'rmissing';
  p.textContent = 'This article is no longer in reader view. ';
  const a = document.createElement('a');
  a.href = original || '#';
  a.textContent = 'Open the original page';
  p.append(a);
  $('article').append(p);
}

window.burrowPage.readerArticle(params.get('k')).then((data) => {
  const art = data?.article;
  if (!art) return showMissing();
  document.title = art.title || 'Reader';
  if (art.lang) document.documentElement.lang = art.lang;
  if (art.dir === 'rtl') document.documentElement.dir = 'rtl';
  const minutes = Math.max(1, Math.round((art.length || 0) / 1100)); // ~200 words a minute
  $('time').textContent = `${minutes} MIN READ`;
  if (art.siteName) $('site').textContent = art.siteName;

  const box = $('article');
  box.innerHTML = '';
  const h1 = document.createElement('h1');
  h1.textContent = art.title || '';
  box.append(h1);
  if (art.byline) {
    const by = document.createElement('p');
    by.className = 'rbyline';
    by.textContent = art.byline;
    box.append(by);
  }
  const body = document.createElement('div');
  body.className = 'rbody';
  body.append(...sanitize(art.content).childNodes);
  box.append(body);
}).catch(showMissing);

// ---------- Theme ----------
function applyTheme(p) { if (p?.tokens) window.BurrowTheme.apply(p.tokens); }
window.burrowPage.getTheme().then(applyTheme);
window.burrowPage.onTheme(applyTheme);
