// Turns whatever you type in the address bar into a URL.
const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=' },
};
const DEFAULT_ENGINE = 'google';

const NEWTAB = 'burrow://newtab/';

function toUrl(input, engine = DEFAULT_ENGINE) {
  const text = String(input || '').trim();
  if (!text) return NEWTAB;
  if (/^(https?|burrow|file):\/\//i.test(text) || /^about:/i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return 'http://' + text;
  // Looks like a domain: no spaces and has a dot with a 2+ letter ending.
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
  return (ENGINES[engine] || ENGINES[DEFAULT_ENGINE]).url + encodeURIComponent(text);
}

// What the address bar should show for a URL (Burrow's own pages show nothing).
function displayUrl(url) {
  if (!url || url.startsWith('burrow://newtab') || url.startsWith('burrow://welcome')) return '';
  return url;
}

module.exports = { toUrl, displayUrl, NEWTAB, ENGINES, DEFAULT_ENGINE };
