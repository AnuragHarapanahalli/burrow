// Ask AI: which AI chat sites Burrow can open, and how to spot a question.
// Shared by the main process, the browser interface and the new tab.
(function (root) {
  const PROVIDERS = {
    claude: { name: 'Claude', host: 'claude.ai', home: 'https://claude.ai/new', login: 'https://claude.ai/login', prefill: (q) => 'https://claude.ai/new?q=' + encodeURIComponent(q) },
    chatgpt: { name: 'ChatGPT', host: 'chatgpt.com', home: 'https://chatgpt.com/', login: 'https://chatgpt.com/auth/login', prefill: (q) => 'https://chatgpt.com/?q=' + encodeURIComponent(q) },
    // Gemini doesn't accept a question in the address, so Burrow copies it for you to paste.
    gemini: { name: 'Gemini', host: 'gemini.google.com', home: 'https://gemini.google.com/app', login: 'https://gemini.google.com/app', open: 'https://gemini.google.com/app' },
  };
  const DEFAULT_PROVIDER = 'claude';

  // Words people start questions and requests with.
  const STARTERS = /^(how|what|why|when|where|who|whom|whose|which|can|could|should|would|will|is|are|am|was|were|do|does|did|has|have|explain|describe|summari[sz]e|compare|write|draft|translate|help|tell me|give me|show me|teach me|make|create|suggest|recommend|list|define|plan|fix|debug)\b/i;

  // Does this look like something you'd ask an AI rather than search for?
  function isQuestion(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 2000) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;           // a full address
    if (!/\s/.test(t) && /\.[a-z]{2,}(\/|$|:)/i.test(t)) return false; // looks like a domain
    if (/\?\s*$/.test(t)) return true;                                // ends with "?"
    const words = t.split(/\s+/).length;
    return STARTERS.test(t) && words >= 3;                             // "how do volcanoes work"
  }

  // Where to go for a question. { url, copy } — copy=true means paste the question yourself.
  function askUrl(providerId, question) {
    const p = PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
    return p.prefill ? { url: p.prefill(question), copy: false } : { url: p.open, copy: true };
  }

  const list = () => Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, host: p.host, prefill: !!p.prefill }));

  const api = { PROVIDERS, DEFAULT_PROVIDER, isQuestion, askUrl, list };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BurrowAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
