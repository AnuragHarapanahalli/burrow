// Editable quick links on the new tab: rename, change address, remove, add, drag to reorder.
// Each link is either for all workspaces, or only for one workspace (link.ws = workspace id).
// Saved through burrowPage.setQuickLinks; the main process validates and shares them with every new tab.
const MAX_LINKS = 8;  // per workspace view
let allLinks = [];    // every link, in order
let workspace = null; // { id, name } of the workspace this new tab belongs to
let editing = false;
let formIndex = null; // index into allLinks being edited, or -1 for a new link
let formScope = 'all';

const linksBox = $('links');
const form = $('linkForm');
const pad2 = (n) => String(n).padStart(2, '0');
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

// The links this new tab shows, with their position in the full list.
const visible = () => allLinks.map((l, i) => ({ l, i })).filter(({ l }) => !l.ws || l.ws === workspace?.id);

function renderQuickLinks(next, ws) {
  if (next) allLinks = next.slice();
  if (ws !== undefined) workspace = ws;
  const vis = visible().slice(0, MAX_LINKS);
  document.body.classList.toggle('editing-links', editing);
  $('linksEdit').textContent = editing ? 'Done' : 'Edit';
  $('linksEdit').setAttribute('aria-pressed', String(editing));
  if (!editing) {
    linksBox.innerHTML = vis.length
      ? vis.map(({ l }, n) => `<a href="${esc(l.url)}" title="${esc(l.url)}"><span class="pixel n">${pad2(n + 1)}</span>${esc(l.name)} <span class="arrow">&nearr;</span></a>`).join('')
      : '<span class="links-empty">No quick links. Press Edit to add some.</span>';
    return;
  }
  linksBox.innerHTML = vis.map(({ l, i }, n) => `
    <div class="ql" draggable="true" data-i="${i}" title="Drag to reorder">
      <span class="pixel n">${pad2(n + 1)}</span>
      <button class="ql-name" data-edit="${i}" title="Edit ${esc(l.name)}">${esc(l.name)}<span class="ql-host">${esc(hostOf(l.url))}</span></button>
      ${l.ws ? `<span class="pixel ql-scope" title="Only shows in this workspace">ONLY ${esc((workspace?.name || '').toUpperCase())}</span>` : ''}
      <button class="ql-x" data-rm="${i}" aria-label="Remove ${esc(l.name)}">&times;</button>
    </div>`).join('') +
    (vis.length < MAX_LINKS ? '<button class="ql-add" data-add>+ Add link</button>' : `<span class="links-empty">${MAX_LINKS} links max</span>`);
}
window.renderQuickLinks = renderQuickLinks;
// Fetch our own copy too: newtab.js may have received the settings before this file loaded.
window.burrowPage.getTheme().then((p) => { if (p?.prefs) renderQuickLinks(p.prefs.quickLinks || [], p.workspace || null); });

function save() {
  window.burrowPage.setQuickLinks(allLinks);
  renderQuickLinks();
}

// ---------- Edit mode ----------
$('linksEdit').addEventListener('click', () => {
  editing = !editing;
  closeForm();
  renderQuickLinks();
});

linksBox.addEventListener('click', (e) => {
  if (!editing) return;
  const rm = e.target.closest('[data-rm]');
  const ed = e.target.closest('[data-edit]');
  if (rm) {
    const el = rm.closest('.ql');
    let done = false;
    const remove = () => { if (done) return; done = true; allLinks.splice(Number(rm.dataset.rm), 1); closeForm(); save(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return remove();
    el.classList.add('removing');
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 300); // fallback
  } else if (ed) openForm(Number(ed.dataset.edit));
  else if (e.target.closest('[data-add]')) openForm(-1);
});

// ---------- Add / edit form ----------
function renderScope() {
  const name = workspace?.name || 'this workspace';
  $('scopeWs').textContent = `Only ${name}`;
  document.querySelectorAll('#scopeSeg [data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === formScope)));
  $('scopeSeg').hidden = !workspace;
}
$('scopeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scope]');
  if (b) { formScope = b.dataset.scope; renderScope(); }
});

function openForm(i) {
  formIndex = i;
  const l = allLinks[i] || { name: '', url: '' };
  formScope = l.ws ? 'ws' : 'all';
  $('lfName').value = l.name;
  $('lfUrl').value = l.url;
  $('lfError').textContent = '';
  renderScope();
  form.hidden = false;
  (i === -1 ? $('lfUrl') : $('lfName')).focus();
}
function closeForm() { form.hidden = true; formIndex = null; }
$('lfCancel').addEventListener('click', closeForm);
form.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeForm(); });
[$('lfName'), $('lfUrl')].forEach((el) => el.addEventListener('input', () => { $('lfError').textContent = ''; }));

function normaliseUrl(text) {
  let t = text.trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    if (!/\./.test(u.hostname) && u.hostname !== 'localhost') return null;
    return u.href;
  } catch { return null; }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = normaliseUrl($('lfUrl').value);
  if (!url) { $('lfError').textContent = 'Enter a web address, like moodle.college.edu'; $('lfUrl').focus(); return; }
  const link = { name: $('lfName').value.trim() || hostOf(url), url };
  if (formScope === 'ws' && workspace) link.ws = workspace.id;
  if (formIndex === -1) allLinks.push(link);
  else allLinks[formIndex] = link;
  closeForm();
  save();
});

// ---------- Drag to reorder ----------
let dragFrom = null; // index into allLinks
linksBox.addEventListener('dragstart', (e) => {
  const el = e.target.closest('.ql');
  if (!el) return;
  dragFrom = Number(el.dataset.i);
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
linksBox.addEventListener('dragover', (e) => {
  const el = e.target.closest('.ql');
  if (dragFrom === null || !el) return;
  e.preventDefault();
  linksBox.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  if (Number(el.dataset.i) !== dragFrom) el.classList.add('drop-target');
});
linksBox.addEventListener('drop', (e) => {
  const el = e.target.closest('.ql');
  if (dragFrom === null || !el) return;
  e.preventDefault();
  const target = allLinks[Number(el.dataset.i)];
  const [moved] = allLinks.splice(dragFrom, 1);
  allLinks.splice(allLinks.indexOf(target) + (Number(el.dataset.i) > dragFrom ? 1 : 0), 0, moved);
  dragFrom = null;
  save();
});
linksBox.addEventListener('dragend', () => {
  dragFrom = null;
  linksBox.querySelectorAll('.dragging, .drop-target').forEach((x) => x.classList.remove('dragging', 'drop-target'));
});
