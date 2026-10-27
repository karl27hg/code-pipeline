// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const els = { title: $('title'), source: $('source'), canvas: $('preview'), file: $('file'), toast: $('toast') };
const VERSION = '0.1.0';
const STORE_KEY = 'pipe-render.v1';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
let themePref = 'auto';  // auto | light | dark, what the user picked
let theme = 'light';     // light | dark, what is drawn

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ title: els.title.value, source: els.source.value, themePref }));
  } catch { /* storage unavailable: ignore */ }
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

// ---- editor highlighting: a <pre> under the transparent textarea
const hl = $('hl');
const escapeHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function syncScroll() {
  hl.scrollTop = els.source.scrollTop;
  hl.scrollLeft = els.source.scrollLeft;
}

function highlight() {
  const text = els.source.value;
  const raw = text.split('\n');
  const html = tokenLines(text).map((toks, i) => (MARKER.test(raw[i])
    ? `<span class="t-mk">${escapeHtml(raw[i])}</span>`
    : toks.map(t => (t.t === 'plain' ? escapeHtml(t.s) : `<span class="t-${t.t}">${escapeHtml(t.s)}</span>`)).join('')));
  hl.firstElementChild.innerHTML = html.join('\n') + '\n';
  syncScroll();
}

function update() {
  highlight();
  render(els.canvas, els.title.value.trim(), parseSource(els.source.value), theme);
  save();
}
let pending = 0;
function scheduleUpdate() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(update);
}

function setTheme(pref) {
  themePref = pref in THEMES ? pref : 'auto';
  theme = themePref === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : themePref;
  document.documentElement.dataset.theme = theme;
  // the editor uses the same syntax palette as the rendered image
  for (const [k, c] of Object.entries(THEMES[theme].syn)) document.documentElement.style.setProperty(`--syn-${k}`, c);
  document.querySelectorAll('[data-theme-btn]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.themeBtn === themePref)));
  update();
}
darkQuery.addEventListener('change', () => { if (themePref === 'auto') setTheme('auto'); });

function fileBase() {
  return (els.title.value.trim() || 'pipeline').replace(/[\\/:*?"<>|]+/g, '_');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const canvasBlob = () => new Promise(r => els.canvas.toBlob(r, 'image/png'));

async function copyImage() {
  try {
    const blob = await canvasBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('이미지를 복사했습니다. Discord에 Ctrl+V 하세요');
    track('copy_image', { theme });
  } catch (e) {
    toast('복사 실패: 브라우저가 이미지 복사를 막았습니다. PNG 저장을 사용하세요');
    console.error(e);
  }
}

function exportMd() {
  const md = toMarkdown(els.title.value.trim(), parseSource(els.source.value));
  download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), fileBase() + '.md');
  track('export_md');
}

// The .py file keeps the editor text as is, with the title on a first "# title:" line
const PY_TITLE = /^# title:[ \t]*(.*)\n\n?/;

function exportPy() {
  const title = els.title.value.trim();
  const body = normalize(els.source.value).replace(/\n*$/, '\n');
  const py = (title ? `# title: ${title}\n\n` : '') + body;
  download(new Blob([py], { type: 'text/x-python;charset=utf-8' }), fileBase() + '.py');
  track('export_py');
}

function importText(text, name = '') {
  let title = els.title.value;
  const isPy = /\.py$/i.test(name);
  if (!isPy && (/\.(md|markdown)$/i.test(name) || looksLikeMarkdown(text))) {
    const doc = fromMarkdown(text);
    if (doc.title) title = doc.title;
    text = stepsToSource(doc.steps);
  } else {
    text = normalize(text);
    const m = text.match(PY_TITLE);
    if (m) {
      title = m[1].trim();
      text = text.slice(m[0].length);
    }
  }
  setEditor(title, text);
}

// Nothing to lose when the editor is empty or still shows the untouched sample
const isPristine = () => !els.source.value.trim() ||
  (els.source.value === SAMPLE && els.title.value === SAMPLE_TITLE);

// Ask before replacing the editor's content; "save" first downloads the current source as .py.
// Resolves true when the caller should go ahead.
async function confirmReplace({ title, message, action }) {
  if (isPristine()) return true;
  const dlg = $('confirmDlg');
  $('confirmTitle').textContent = title;
  $('confirmMsg').textContent = message;
  $('confirmSave').textContent = `PY로 저장 후 ${action}`;
  $('confirmOk').textContent = action;
  dlg.returnValue = 'cancel';
  dlg.showModal();
  const choice = await new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }));
  if (choice === 'save') exportPy();
  return choice === 'ok' || choice === 'save';  // Esc may close with '' instead of 'cancel'
}

async function importWithConfirm(text, name = '') {
  const go = await confirmReplace({
    title: '파일을 불러올까요?',
    message: `지금 작성 중인 내용이 ${name ? `'${name}'` : '붙여넣은 마크다운'}의 내용으로 바뀝니다.`,
    action: '불러오기',
  });
  if (!go) return false;
  importText(text, name);
  track('import_file', { kind: name ? name.split('.').pop() : 'paste' });
  return true;
}

function setEditor(title, source) {
  els.title.value = title;
  replaceRange(els.source, 0, els.source.value.length, source);  // code stays undoable with Ctrl+Z
  els.source.setSelectionRange(0, 0);
  els.source.scrollTop = 0;
  update();
}

async function clearEditor() {
  const go = await confirmReplace({
    title: '편집창을 비울까요?', message: '지금 작성 중인 제목과 코드가 지워집니다.', action: '비우기',
  });
  if (go) setEditor('', '');
}

async function showSample() {
  const go = await confirmReplace({
    title: '예제를 불러올까요?', message: '지금 작성 중인 내용이 예제로 바뀝니다.', action: '예제 불러오기',
  });
  if (go) setEditor(SAMPLE_TITLE, SAMPLE);
}

// Edit through execCommand so the browser's undo stack (Ctrl+Z) keeps working
function replaceRange(ta, start, end, text) {
  ta.focus();
  ta.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, start, end, 'end');
  scheduleUpdate();
}

const isMarker = line => MARKER.test(line || '');
const isComment = line => /^\s*#/.test(line) && !isMarker(line);
const indentOf = line => line.match(/^ */)[0];
// a "# %%" with no text and no neighbouring markers: the closing line Ctrl+/ adds after a block
const isCloser = (lines, k) => isMarker(lines[k]) && !lines[k].match(MARKER)[1].trim() &&
  !isMarker(lines[k - 1]) && !isMarker(lines[k + 1]);

function offsetOf(lines, idx) {
  let o = 0;
  for (let k = 0; k < idx; k++) o += lines[k].length + 1;
  return o;
}

// Replace lines a..r (inclusive) with newLines; returns the offset where they start
function replaceLines(ta, lines, a, r, newLines) {
  let from = offsetOf(lines, a);
  let to = offsetOf(lines, r) + lines[r].length;
  if (!newLines.length) {
    if (r + 1 < lines.length) to++;  // take the line break with the deleted lines
    else if (a > 0) from--;
  }
  replaceRange(ta, from, to, newLines.join('\n'));
  return from;
}

function commentLines(ls) {
  const ind = Math.min(...ls.filter(l => l.trim()).map(l => indentOf(l).length));
  return ls.map(l => (l.trim() ? `${l.slice(0, ind)}# ${l.slice(ind)}` : l));
}
const uncommentLines = ls => ls.map(l => l.replace(/^(\s*)# ?/, '$1'));

// Ctrl+/ cycles the selected lines (or the caret line): code -> box -> commented out -> code
function toggleBlock() {
  const ta = els.source;
  const v = ta.value;
  const lines = v.split('\n');
  const s = ta.selectionStart;
  let e = ta.selectionEnd;
  if (e > s && v[e - 1] === '\n') e--;  // selection ending at a line start excludes that line
  const sel = e > s;
  const first = v.slice(0, s).split('\n').length - 1;
  const last = Math.max(first, v.slice(0, e).split('\n').length - 1);
  const selectLines = (from, out) => ta.setSelectionRange(from, from + out.join('\n').length);

  // box -> commented out: caret on the box's "# %%" lines, or selection starting right below them
  let g = isMarker(lines[first]) ? first : -1;
  if (g < 0 && first > 0 && isMarker(lines[first - 1]) && !isCloser(lines, first - 1)) g = first - 1;
  if (g >= 0) {
    let a = g, b = g;
    while (a > 0 && isMarker(lines[a - 1])) a--;
    while (b + 1 < lines.length && isMarker(lines[b + 1])) b++;
    let next = b + 1;
    while (next < lines.length && !isMarker(lines[next])) next++;
    let end = sel && first > b ? Math.min(last, next - 1) : next - 1;
    while (end > b && !lines[end].trim()) end--;
    // also drop the closing "# %%" so the code below rejoins the previous box
    const dropCloser = next < lines.length && isCloser(lines, next) && lines.slice(end + 1, next).every(l => !l.trim());
    const code = end > b ? commentLines(lines.slice(b + 1, end + 1)) : [];
    const out = [...code, ...(dropCloser ? lines.slice(end + 1, next) : [])];
    const from = replaceLines(ta, lines, a, dropCloser ? next : Math.max(end, b), out);
    selectLines(from, code);
    return;
  }

  // commented out -> code
  const range = lines.slice(first, last + 1);
  if (range.some(l => l.trim()) && range.every(l => !l.trim() || isComment(l))) {
    const out = uncommentLines(range);
    selectLines(replaceLines(ta, lines, first, last, out), out);
    return;
  }

  // code -> box
  const head = `${indentOf(lines[first])}# %% `;
  const blankLine = !sel && !lines[first].trim();  // caret on an empty line: that line becomes the "# %%"
  let tail = [];
  if (!blankLine) {
    const nextLine = lines.slice(last + 1).find(l => l.trim());
    if (nextLine !== undefined && !isMarker(nextLine)) tail = [`${indentOf(nextLine)}# %%`];
  }
  // reuse the closing "# %%" of the previous block instead of leaving it dangling
  let p = first - 1;
  while (p >= 0 && !lines[p].trim()) p--;
  const a = p >= 0 && isCloser(lines, p) ? p : first;
  const gap = lines.slice(a === first ? first : a + 1, first);
  const out = [...gap, head, ...(blankLine ? [] : range), ...tail];
  const from = replaceLines(ta, lines, a, last, out);
  const caret = from + offsetOf(out, gap.length) + head.length;
  ta.setSelectionRange(caret, caret);
}

// Ctrl+Shift+K deletes the selected lines (or the caret line), like VS Code
function deleteLines() {
  const ta = els.source;
  const v = ta.value;
  const lines = v.split('\n');
  const s = ta.selectionStart;
  let e = ta.selectionEnd;
  if (e > s && v[e - 1] === '\n') e--;
  const first = v.slice(0, s).split('\n').length - 1;
  const last = Math.max(first, v.slice(0, e).split('\n').length - 1);
  const col = s - offsetOf(lines, first);
  replaceLines(ta, lines, first, last, []);
  // keep the caret's column on the line that moved into place
  const rest = [...lines.slice(0, first), ...lines.slice(last + 1)];
  if (!rest.length) return;
  const k = Math.min(first, rest.length - 1);
  const caret = offsetOf(rest, k) + Math.min(col, rest[k].length);
  ta.setSelectionRange(caret, caret);
}

els.source.addEventListener('input', () => { highlight(); scheduleUpdate(); });
els.source.addEventListener('scroll', syncScroll);
els.title.addEventListener('input', scheduleUpdate);
window.addEventListener('pagehide', save);  // keep edits made right before closing or reloading
els.source.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    els.source.setRangeText('    ', els.source.selectionStart, els.source.selectionEnd, 'end');
    scheduleUpdate();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash' || e.key === 'Enter')) {
    e.preventDefault();
    toggleBlock();
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyK') {
    e.preventDefault();
    deleteLines();
  }
});
els.source.addEventListener('paste', e => {
  const text = e.clipboardData.getData('text/plain');
  if (!looksLikeMarkdown(text)) return;
  e.preventDefault();
  importWithConfirm(text).then(done => done && toast('마크다운을 불러왔습니다'));
});
document.addEventListener('keydown', e => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); exportMd(); }
});

document.querySelectorAll('[data-theme-btn]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)));
$('btnStep').addEventListener('click', toggleBlock);
$('btnOpen').addEventListener('click', () => els.file.click());
$('btnMd').addEventListener('click', exportMd);
$('btnClear').addEventListener('click', clearEditor);
$('btnSample').addEventListener('click', showSample);
$('btnPy').addEventListener('click', exportPy);
$('btnPng').addEventListener('click', async () => {
  download(await canvasBlob(), fileBase() + '.png');
  track('download_png', { theme });
});
$('btnCopy').addEventListener('click', copyImage);

async function readFile(file) {
  if (file) importWithConfirm(await file.text(), file.name);
}
els.file.addEventListener('change', () => { readFile(els.file.files[0]); els.file.value = ''; });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });

// Google Analytics 4: put the measurement ID (G-XXXXXXXXXX) here.
// Sends only from the published site, so local copies and forks don't add to the stats.
const GA_ID = '';
const GA_HOST = 'karl27hg.github.io';
function initAnalytics() {
  if (!GA_ID || location.hostname !== GA_HOST) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}
function track(name, params) {
  if (window.gtag) gtag('event', name, params);
}

// help
const help = $('help');
$('btnHelp').addEventListener('click', () => {
  help.showModal();
  help.scrollTop = 0;  // focusing the close button scrolls to the bottom; start at the top
});
help.addEventListener('click', e => { if (e.target === help) help.close(); });  // backdrop click
document.querySelectorAll('[data-version]').forEach(el => { el.textContent = `v${VERSION}`; });

// init
initAnalytics();
const saved = load();
const params = new URLSearchParams(location.search);
// an untouched sample keeps showing the current sample title
const untouched = !saved || (saved.source === SAMPLE && saved.title === 'VQC로 Iris 분류하기');
els.title.value = untouched ? SAMPLE_TITLE : saved.title;
els.source.value = saved ? saved.source : SAMPLE;
setTheme(params.get('theme') || (saved && saved.themePref) || 'auto');
