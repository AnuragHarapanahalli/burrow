// Reader mode: Mozilla's Readability (the engine behind Firefox Reader View) pulls the article
// out of a page. It runs in an "isolated world" — the page's own scripts can't see or tamper with it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'node_modules', '@mozilla', 'readability');
const READERABLE = fs.readFileSync(path.join(DIR, 'Readability-readerable.js'), 'utf8');
const READABILITY = fs.readFileSync(path.join(DIR, 'Readability.js'), 'utf8');
const WORLD = 1001; // a private scripting world, separate from the page's

const articles = new Map(); // key -> { article, url }
const MAX_KEEP = 30;

// Does this page look like an article?
async function isReaderable(wc) {
  try {
    const res = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: READERABLE + '\n;isProbablyReaderable(document)' }]);
    return res === true || (Array.isArray(res) && res[0] === true);
  } catch { return false; }
}

// Extract the article and keep it under a random key the reader page asks for.
async function extract(wc) {
  const code = READABILITY + `
;(() => {
  const a = new Readability(document.cloneNode(true)).parse();
  if (!a || !a.content) return null;
  return { title: a.title || document.title, byline: a.byline || '', siteName: a.siteName || '',
    content: a.content, length: a.length || 0, lang: document.documentElement.lang || '', dir: a.dir || '' };
})()`;
  let article;
  try {
    const res = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
    article = Array.isArray(res) ? res[0] : res;
  } catch { article = null; }
  if (!article || typeof article.content !== 'string') return null;
  const key = crypto.randomUUID();
  articles.set(key, { article, url: wc.getURL() });
  if (articles.size > MAX_KEEP) articles.delete(articles.keys().next().value);
  return key;
}

function get(key) { return articles.get(String(key || '')) || null; }

module.exports = { isReaderable, extract, get };
