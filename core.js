// Pipeline format, highlighting and rendering. No DOM access besides the canvas passed to render(),
// so it can be shared with a Node CLI or tests.
// ---------------------------------------------------------------------------
// Sample
// ---------------------------------------------------------------------------
const SAMPLE_TITLE = '예시) VQC로 Iris 분류하기';
const SAMPLE = `# %% 데이터 준비
# %% Iris에서 2개 클래스만 골라 각도 범위(0~π)로 정규화
import numpy as np
from sklearn.datasets import load_iris
from sklearn.preprocessing import MinMaxScaler

X, y = load_iris(return_X_y=True)
X, y = X[y < 2], y[y < 2] * 2 - 1
X = MinMaxScaler((0, np.pi)).fit_transform(X)

# %% 양자 회로 정의
# %% 특징을 회전 게이트로 인코딩하고 학습 가능한 얽힘 층을 쌓음
import pennylane as qml

dev = qml.device("default.qubit", wires=4)

@qml.qnode(dev)
def circuit(weights, x):
    qml.AngleEmbedding(x, wires=range(4))
    qml.StronglyEntanglingLayers(weights, wires=range(4))
    return qml.expval(qml.PauliZ(0))

# %% 학습
# %% 평균 제곱 오차를 최소화하도록 파라미터를 경사하강법으로 갱신
from pennylane import numpy as pnp

weights = pnp.random.random((2, 4, 3), requires_grad=True)
opt = qml.GradientDescentOptimizer(stepsize=0.1)

def cost(w):
    return sum((circuit(w, x) - t) ** 2 for x, t in zip(X, y)) / len(X)

for epoch in range(30):
    weights = opt.step(cost, weights)

# %% 평가
preds = [np.sign(circuit(weights, x)) for x in X]
print("accuracy:", np.mean(np.array(preds) == y))
`;

// ---------------------------------------------------------------------------
// Source format  <->  steps  <->  markdown
// ---------------------------------------------------------------------------
const MARKER = /^\s*#\s*%%[ \t]?(.*)$/;

function trimBlankLines(lines) {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

function dedent(lines) {
  const indents = lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length);
  const n = indents.length ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(Math.min(n, l.match(/^ */)[0].length)));
}

function normalize(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

// Editor text -> [{desc: [line...], code: string}]
function parseSource(text) {
  const steps = [];
  let cur = null, prevMarker = false;
  for (const line of normalize(text).split('\n')) {
    const m = line.match(MARKER);
    if (m) {
      if (cur && prevMarker) cur.desc.push(m[1].trim());
      else steps.push(cur = { desc: [m[1].trim()], code: [] });
      prevMarker = true;
      continue;
    }
    prevMarker = false;
    if (!cur) steps.push(cur = { desc: [], code: [] });
    cur.code.push(line);
  }
  return steps
    .map(s => ({ desc: s.desc.filter(Boolean), code: dedent(trimBlankLines(s.code)).join('\n') }))
    .filter(s => s.desc.length || s.code);
}

function stepsToSource(steps) {
  return steps.map(s => {
    const head = s.desc.length ? s.desc.map(d => `# %% ${d}`) : ['# %%'];
    return head.join('\n') + (s.code ? '\n' + s.code : '');
  }).join('\n\n') + '\n';
}

function toMarkdown(title, steps) {
  const out = [];
  if (title) out.push(`# ${title}`, '');
  for (const s of steps) {
    out.push(`## ${s.desc[0] || ''}`.trimEnd());
    if (s.desc.length > 1) out.push(...s.desc.slice(1));
    if (s.code) {
      const longest = Math.max(2, ...(s.code.match(/`+/g) || []).map(r => r.length));
      const fence = '`'.repeat(longest + 1);
      out.push('', fence + 'python', s.code, fence);
    }
    out.push('');
  }
  return out.join('\n');
}

function fromMarkdown(md) {
  let title = '', cur = null, fence = null;
  const steps = [];
  const newStep = desc => steps.push(cur = { desc, code: [] });
  for (const line of normalize(md).split('\n')) {
    if (fence) {
      if (line.trim().startsWith(fence) && !line.trim().replace(/[`~]/g, '')) fence = null;
      else cur.code.push(line);
      continue;
    }
    let m;
    if ((m = line.match(/^\s*(`{3,}|~{3,})/))) {
      fence = m[1];
      if (!cur) newStep([]);
    } else if ((m = line.match(/^##(?!#)\s*(.*)$/))) {
      newStep(m[1].trim() ? [m[1].trim()] : []);
    } else if ((m = line.match(/^#\s+(.*)$/)) && !title && !cur) {
      title = m[1].trim();
    } else if (line.trim()) {
      if (!cur) newStep([]);
      cur.desc.push(line.trim());
    }
  }
  return {
    title,
    steps: steps.map(s => ({ desc: s.desc, code: trimBlankLines(s.code).join('\n') }))
                .filter(s => s.desc.length || s.code),
  };
}

function looksLikeMarkdown(text) {
  return /^\s*(`{3,}|~{3,})/m.test(text) && /^##?\s/m.test(text);
}

// ---------------------------------------------------------------------------
// Python tokenizer (just enough for highlighting)
// ---------------------------------------------------------------------------
const KEYWORDS = new Set(('and as assert async await break class continue def del elif else except finally for ' +
  'from global if import in is lambda nonlocal not or pass raise return try while with yield match case').split(' '));
const CONSTANTS = new Set(['True', 'False', 'None', 'self', 'cls']);
const BUILTINS = new Set(('abs all any bool dict enumerate filter float format int isinstance len list map max min ' +
  'next object open print range reversed round set sorted str sum super tuple type zip').split(' '));

const RULES = [
  ['com', /#[^\n]*/y],
  ['str', /[rRbBuUfF]{0,2}("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/y],
  ['deco', /@[A-Za-z_][\w.]*/y],
  ['num', /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?j?)/y],
  ['id', /[A-Za-z_À-￿][\wÀ-￿]*/y],
  ['ws', /\s+/y],
  ['op', /[^\s]/y],
];

function tokenize(code) {
  const toks = [];
  let i = 0, prevWord = '';
  while (i < code.length) {
    for (const [type, re] of RULES) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m) continue;
      let t = type;
      const s = m[0];
      if (type === 'id') {
        if (KEYWORDS.has(s)) t = 'kw';
        else if (CONSTANTS.has(s)) t = 'const';
        else if (prevWord === 'def') t = 'fn';
        else if (prevWord === 'class') t = 'cls';
        else if (/^\s*\(/.test(code.slice(re.lastIndex, re.lastIndex + 40))) t = BUILTINS.has(s) ? 'builtin' : 'fn';
        else if (BUILTINS.has(s)) t = 'builtin';
        else t = 'plain';
        prevWord = s;
      } else if (type !== 'ws') {
        prevWord = '';
      }
      toks.push({ t: t === 'ws' || t === 'op' ? 'plain' : t, s });
      i = re.lastIndex;
      break;
    }
  }
  return toks;
}

// Split tokens into per-line arrays (multi-line strings span lines)
function tokenLines(code) {
  const lines = [[]];
  for (const tok of tokenize(code)) {
    tok.s.split('\n').forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: tok.t, s: part });
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const SANS = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';
const MONO = 'Consolas, "Cascadia Mono", Menlo, "D2Coding", "Malgun Gothic", "Apple SD Gothic Neo", monospace';

const THEMES = {
  light: {
    bg: '#f4f5f7', card: '#ffffff', cardBorder: '#d8dce3', shadow: 'rgba(31,35,40,0.08)',
    codeBg: '#f6f8fa', codeBorder: '#e3e7ec', title: '#1f2328', text: '#1f2328', muted: '#59636e',
    accent: '#4c6ef5', badgeText: '#ffffff', arrow: '#8c95a3',
    syn: { plain: '#1f2328', kw: '#cf222e', str: '#0a3069', num: '#0550ae', com: '#6e7781', fn: '#8250df',
           builtin: '#0550ae', deco: '#8250df', const: '#0550ae', cls: '#953800' },
  },
  dark: {
    bg: '#1e1f22', card: '#2b2d31', cardBorder: '#3f4248', shadow: 'rgba(0,0,0,0)',
    codeBg: '#1a1b1e', codeBorder: '#34363c', title: '#f2f3f5', text: '#e8e9eb', muted: '#a5a9b2',
    accent: '#7289ff', badgeText: '#ffffff', arrow: '#6d717a',
    syn: { plain: '#e6edf3', kw: '#ff7b72', str: '#a5d6ff', num: '#79c0ff', com: '#8b949e', fn: '#d2a8ff',
           builtin: '#79c0ff', deco: '#d2a8ff', const: '#79c0ff', cls: '#ffa657' },
  },
};

const M = {
  pad: 32, titleFont: `700 22px ${SANS}`, titleLH: 30, titleGap: 22,
  boxPad: 18, radius: 12, badge: 26, badgeGap: 12, badgeFont: `700 13px ${SANS}`,
  headFont: `600 15px ${SANS}`, headLH: 24, descFont: `400 13.5px ${SANS}`, descLH: 21,
  descCodeGap: 14, codeFont: `13px ${MONO}`, codeItalic: `italic 13px ${MONO}`, codeLH: 20,
  codePadX: 14, codePadY: 12, codeRadius: 8, arrowH: 40, minInner: 460, maxInner: 880,
};

function wrapText(ctx, text, font, maxW) {
  ctx.font = font;
  const lines = [];
  let line = '';
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const next = line + word;
    if (ctx.measureText(next).width <= maxW || !line.trim()) {
      line = next;
    } else {
      lines.push(line.trimEnd());
      line = word.trimStart();
    }
    // break overlong words character by character
    while (ctx.measureText(line).width > maxW && line.length > 1) {
      let k = line.length - 1;
      while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--;
      lines.push(line.slice(0, k));
      line = line.slice(k);
    }
  }
  if (line.trim() || !lines.length) lines.push(line.trimEnd());
  return lines;
}

const codeFontFor = t => (t === 'com' ? M.codeItalic : M.codeFont);

function lineWidth(ctx, toks) {
  let w = 0;
  for (const tok of toks) { ctx.font = codeFontFor(tok.t); w += ctx.measureText(tok.s).width; }
  return w;
}

// Lay out one source line into one or more visual lines of positioned runs
function wrapCodeLine(ctx, toks, maxW) {
  ctx.font = M.codeFont;
  const spaceW = ctx.measureText(' ').width;
  const lead = (toks[0] && toks[0].t === 'plain' ? toks[0].s.match(/^ */)[0].length : 0);
  const contIndent = Math.min(lead * spaceW + 4 * spaceW, maxW / 2);
  const out = [[]];
  let x = 0;
  for (const tok of toks) {
    ctx.font = codeFontFor(tok.t);
    const w = ctx.measureText(tok.s).width;
    if (x + w <= maxW) {
      out[out.length - 1].push({ x, s: tok.s, t: tok.t });
      x += w;
      continue;
    }
    // move a whole token to the next line if it fits there; split only overlong tokens
    if (x > contIndent && contIndent + w <= maxW) {
      out.push([]);
      x = contIndent;
      if (!tok.s.trim()) continue;
      out[out.length - 1].push({ x, s: tok.s, t: tok.t });
      x += w;
      continue;
    }
    let buf = '', bufX = x;
    for (const ch of Array.from(tok.s)) {
      const cw = ctx.measureText(ch).width;
      if (x + cw > maxW && x > contIndent) {
        if (buf) out[out.length - 1].push({ x: bufX, s: buf, t: tok.t });
        out.push([]);
        x = bufX = contIndent;
        buf = '';
        if (ch === ' ') continue;
      }
      buf += ch;
      x += cw;
    }
    if (buf) out[out.length - 1].push({ x: bufX, s: buf, t: tok.t });
  }
  return out;
}

function layout(ctx, title, steps) {
  // natural widths drive the shared box width
  let natural = 0;
  const tokenized = steps.map(s => (s.code ? tokenLines(s.code) : []));
  for (const lines of tokenized)
    for (const toks of lines) natural = Math.max(natural, lineWidth(ctx, toks) + 2 * M.codePadX);
  for (const s of steps) {
    s.desc.forEach((d, i) => {
      ctx.font = i === 0 ? M.headFont : M.descFont;
      natural = Math.max(natural, M.badge + M.badgeGap + ctx.measureText(d).width);
    });
  }
  const inner = Math.ceil(Math.min(M.maxInner, Math.max(M.minInner, natural)));
  const boxW = inner + 2 * M.boxPad;
  const width = boxW + 2 * M.pad;
  const textW = inner - M.badge - M.badgeGap;

  let y = M.pad;
  const titleLines = title ? wrapText(ctx, title, M.titleFont, boxW) : [];
  if (titleLines.length) y += titleLines.length * M.titleLH + M.titleGap;

  const boxes = steps.map((s, idx) => {
    const head = s.desc.length ? wrapText(ctx, s.desc[0], M.headFont, textW) : [];
    const sub = s.desc.slice(1).flatMap(d => wrapText(ctx, d, M.descFont, textW));
    const textTop = (M.badge - M.headLH) / 2;
    const textH = head.length * M.headLH + sub.length * M.descLH;
    const headerH = Math.max(M.badge, textTop + textH);
    const code = tokenized[idx].flatMap(toks => wrapCodeLine(ctx, toks, inner - 2 * M.codePadX));
    const codeH = s.code ? code.length * M.codeLH + 2 * M.codePadY : 0;
    const h = M.boxPad + headerH + (codeH ? M.descCodeGap + codeH : 0) + M.boxPad;
    const box = { y, h, head, sub, code, textTop, headerH, codeH };
    y += h + M.arrowH;
    return box;
  });
  const height = (boxes.length ? y - M.arrowH : y + 60) + M.pad;
  return { width, height, boxW, inner, titleLines, boxes };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render(canvas, title, steps, themeName, scale = 2) {
  const T = THEMES[themeName];
  const ctx = canvas.getContext('2d');
  const L = layout(ctx, title, steps);
  canvas.width = Math.ceil(L.width * scale);
  canvas.height = Math.ceil(L.height * scale);
  canvas.style.width = L.width + 'px';
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.textBaseline = 'middle';

  const x0 = M.pad;
  const cx = L.width / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = T.title;
  ctx.font = M.titleFont;
  L.titleLines.forEach((line, i) => ctx.fillText(line, cx, M.pad + i * M.titleLH + M.titleLH / 2));

  if (!L.boxes.length) {
    ctx.fillStyle = T.muted;
    ctx.font = M.descFont;
    ctx.fillText('코드를 붙여넣고 Ctrl+/ 로 단계를 나눠보세요', cx, L.height - M.pad - 30);
  }

  L.boxes.forEach((b, idx) => {
    // card
    ctx.save();
    ctx.shadowColor = T.shadow;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, x0, b.y, L.boxW, b.h, M.radius);
    ctx.fillStyle = T.card;
    ctx.fill();
    ctx.restore();
    roundRect(ctx, x0 + 0.5, b.y + 0.5, L.boxW - 1, b.h - 1, M.radius);
    ctx.strokeStyle = T.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // badge
    const ix = x0 + M.boxPad;
    const iy = b.y + M.boxPad;
    ctx.beginPath();
    ctx.arc(ix + M.badge / 2, iy + M.badge / 2, M.badge / 2, 0, Math.PI * 2);
    ctx.fillStyle = T.accent;
    ctx.fill();
    ctx.fillStyle = T.badgeText;
    ctx.font = M.badgeFont;
    ctx.textAlign = 'center';
    ctx.fillText(String(idx + 1), ix + M.badge / 2, iy + M.badge / 2 + 0.5);

    // description
    ctx.textAlign = 'left';
    const tx = ix + M.badge + M.badgeGap;
    let ty = iy + b.textTop;
    ctx.font = M.headFont;
    ctx.fillStyle = T.text;
    for (const line of b.head) { ctx.fillText(line, tx, ty + M.headLH / 2); ty += M.headLH; }
    ctx.font = M.descFont;
    ctx.fillStyle = T.muted;
    for (const line of b.sub) { ctx.fillText(line, tx, ty + M.descLH / 2); ty += M.descLH; }

    // code
    if (b.codeH) {
      const cy = iy + b.headerH + M.descCodeGap;
      roundRect(ctx, ix + 0.5, cy + 0.5, L.inner - 1, b.codeH - 1, M.codeRadius);
      ctx.fillStyle = T.codeBg;
      ctx.fill();
      ctx.strokeStyle = T.codeBorder;
      ctx.stroke();
      b.code.forEach((runs, i) => {
        const ly = cy + M.codePadY + i * M.codeLH + M.codeLH / 2;
        for (const r of runs) {
          ctx.font = codeFontFor(r.t);
          ctx.fillStyle = T.syn[r.t] || T.syn.plain;
          ctx.fillText(r.s, ix + M.codePadX + r.x, ly);
        }
      });
    }

    // arrow to next box
    if (idx < L.boxes.length - 1) {
      const top = b.y + b.h + 6;
      const bottom = b.y + b.h + M.arrowH - 6;
      ctx.strokeStyle = T.arrow;
      ctx.fillStyle = T.arrow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, bottom - 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 7, bottom - 9);
      ctx.lineTo(cx + 7, bottom - 9);
      ctx.lineTo(cx, bottom);
      ctx.closePath();
      ctx.fill();
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    SAMPLE, SAMPLE_TITLE, THEMES, normalize, parseSource, stepsToSource, toMarkdown, fromMarkdown,
    looksLikeMarkdown, tokenize, tokenLines, layout, render,
  };
}
