#!/usr/bin/env node
/**
 * Amuwa AI CRM documentation site generator. No dependencies: Node 18+ only.
 *
 *   node docs-site/build.mjs                    full site (employees + clients)  -> docs-site/dist
 *   node docs-site/build.mjs --audience=client  client-only site                 -> docs-site/dist-client
 *   node docs-site/build.mjs --check            validate only (no output)
 *
 * Content lives in docs-site/content/<section>/<article>.md (see docs-site/README.md for the format).
 * The build fails (exit 1) on broken links or anchors, missing images or alt text, missing titles, unknown
 * sections and anything that looks like a secret, so a bad edit cannot be published by accident.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const AUDIENCE = args.get('audience') === 'client' ? 'client' : 'internal';
const CHECK_ONLY = args.has('check');
const OUT = path.join(ROOT, AUDIENCE === 'client' ? 'dist-client' : 'dist');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'sections.json'), 'utf8'));
const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

// ------------------------------------------------------------------ helpers
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[`*_]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

function frontMatter(raw, file) {
  const cleanRaw = raw.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(cleanRaw);
  const meta = {};
  if (!m) return { meta, body: cleanRaw };
  let key = null;
  for (const line of m[1].split('\n')) {
    if (/^\s+-\s+/.test(line) && key) { (meta[key] ||= []).push(line.replace(/^\s+-\s+/, '').trim()); continue; }
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!kv) { if (line.trim()) err(file, `unreadable front matter line "${line}"`); continue; }
    key = kv[1];
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) meta[key] = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
    else if (v === '') meta[key] = [];
    else meta[key] = v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: raw.slice(m[0].length) };
}

// ------------------------------------------------------------------ markdown
const ICONS = {
  tip: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  note: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  important: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  prereq: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  result: '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
  gap: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'
};
const CALLOUT_TITLES = { tip: 'Tip', note: 'Note', warning: 'Warning', important: 'Important', prereq: 'Before you start', result: 'What you should see', gap: 'Not available yet' };
const svg = k => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

function createRenderer(ctx) {
  const used = new Map();
  const headings = [];
  const links = [];
  const images = [];
  const uniqueId = text => { let id = slugify(text) || 'section'; const n = used.get(id) || 0; used.set(id, n + 1); return n ? `${id}-${n + 1}` : id; };

  function inline(src) {
    const stash = [];
    let s = esc(src).replace(/`([^`]+)`/g, (_m, c) => { stash.push(`<code>${c}</code>`); return `\u0000${stash.length - 1}\u0000`; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => `<img src="${imgUrl(url, alt)}" alt="${alt}" loading="lazy">`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
      if (/^https?:\/\//.test(url)) return `<a href="${url.replace(/&amp;/g, '&')}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      links.push(url);
      return `<a href="${href(url)}">${text}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/\bkbd:([A-Za-z0-9+]+)/g, '<kbd>$1</kbd>');
    return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[+i]);
  }
  const imgUrl = (url, alt) => {
    images.push({ url, alt });
    return url.startsWith('shot:') ? `${ctx.base}assets/shots/${url.slice(5)}` : url;
  };
  const href = url => {
    const [p, a] = url.split('#');
    if (!p) return `#${a}`;
    return `${ctx.base}${p.replace(/^\//, '').replace(/\/$/, '')}/${a ? `#${a}` : ''}`;
  };

  function blocks(lines) {
    const out = [];
    let i = 0;
    const isBlank = l => /^\s*$/.test(l);
    const listStart = l => /^(\s*)([-*]|\d+\.)\s+/.exec(l);
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) { i++; continue; }
      let m;
      if ((m = /^```(\w*)\s*$/.exec(line))) {
        const body = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        if (m[1] === 'flow') {
          out.push(flow(body));
        } else if (m[1] === 'mermaid') {
          out.push(`<div class="mermaid-wrap"><div class="mermaid">${esc(body.join('\n'))}</div></div>`);
        } else {
          out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
        }
        continue;
      }
      if ((m = /^:::(\w+)\s*(.*)$/.exec(line))) {
        const kind = m[1];
        const body = [];
        let depth = 1;
        i++;
        while (i < lines.length) {
          if (/^:::\w+/.test(lines[i])) depth++;
          else if (/^:::\s*$/.test(lines[i]) && --depth === 0) break;
          body.push(lines[i++]);
        }
        i++;
        if (!ICONS[kind]) { err(ctx.file, `unknown callout ":::${kind}"`); continue; }
        out.push(`<aside class="callout ${kind}" role="note"><div class="callout-title">${svg(kind)}<span>${inline(m[2] || CALLOUT_TITLES[kind])}</span></div><div class="callout-body">${blocks(body)}</div></aside>`);
        continue;
      }
      if ((m = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line))) {
        const level = m[1].length;
        const text = m[2];
        const id = uniqueId(text);
        headings.push({ level, text: text.replace(/[`*]/g, ''), id });
        out.push(level === 1 ? '' : `<h${level} id="${id}">${inline(text)}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`);
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^>\s?/.test(line)) {
        const body = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${blocks(body)}</blockquote>`);
        continue;
      }
      if ((m = listStart(line))) {
        const base = m[1].length;
        const ordered = /\d/.test(m[2]);
        const items = [];
        while (i < lines.length) {
          const lm = listStart(lines[i]);
          if (lm && lm[1].length === base && /\d/.test(lm[2]) === ordered) {
            const body = [lines[i].slice(lm[0].length)];
            i++;
            while (i < lines.length) {
              const l = lines[i];
              if (isBlank(l)) {
                let j = i;
                while (j < lines.length && isBlank(lines[j])) j++;
                if (j < lines.length && (/^\s{2,}\S/.test(lines[j]) && (lines[j].match(/^\s*/)[0].length > base))) { body.push(''); i = j; continue; }
                break;
              }
              const lm2 = listStart(l);
              if (lm2 && lm2[1].length <= base) break;
              if (l.match(/^\s*/)[0].length > base) { body.push(l.slice(Math.min(l.match(/^\s*/)[0].length, base + (ordered ? 3 : 2)))); i++; continue; }
              break;
            }
            items.push(body);
          } else break;
          while (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length && listStart(lines[i + 1]) && listStart(lines[i + 1])[1].length === base) i++;
        }
        const li = body => {
          const first = body[0];
          const task = /^\[( |x)\]\s+(.*)$/.exec(first);
          if (task) return `<li class="task"><span class="box${task[1] === 'x' ? ' on' : ''}" aria-hidden="true"></span>${blocks([task[2], ...body.slice(1)])}</li>`;
          return `<li>${blocks(body)}</li>`;
        };
        const tasky = items.some(b => /^\[( |x)\]\s/.test(b[0]));
        out.push(`<${ordered ? 'ol class="steps"' : tasky ? 'ul class="checklist"' : 'ul'}>${items.map(li).join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      const para = [];
      while (i < lines.length && !isBlank(lines[i]) && !/^(```|:::|#{1,4}\s|>\s?|\s*\|.*\|\s*$)/.test(lines[i]) && !(para.length && listStart(lines[i]))) para.push(lines[i++]);
      const text = para.join(' ').trim();
      const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(text);
      if (img) out.push(`<figure>${inline(text)}<figcaption>${esc(img[1])}</figcaption></figure>`);
      else if (text) out.push(`<p>${inline(text)}</p>`);
    }
    return out.join('\n');
  }

  /** ```flow: one step per line "Step | Who does it | Where / what changes"; a line starting with "->" is a branch under the step above. */
  function flow(lines) {
    const steps = [];
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const branch = /^\s*->\s*(.*)$/.exec(raw);
      const cells = (branch ? branch[1] : raw).split('|').map(c => c.trim());
      if (branch) { const last = steps[steps.length - 1]; if (last) last.branches.push(cells); else err(ctx.file, 'flow branch without a step'); }
      else steps.push({ cells, branches: [] });
    }
    return `<ol class="flow">${steps.map((s, n) => `<li><span class="flow-n">${n + 1}</span><div class="flow-card"><div class="flow-title">${inline(s.cells[0])}</div>${s.cells[1] ? `<div class="flow-who">${inline(s.cells[1])}</div>` : ''}${s.cells[2] ? `<div class="flow-note">${inline(s.cells[2])}</div>` : ''}${s.branches.map(b => `<div class="flow-branch"><span>If not</span> ${inline(b[0])}${b[1] ? ` <em>${inline(b[1])}</em>` : ''}</div>`).join('')}</div></li>`).join('')}</ol>`;
  }

  return { render: md => blocks(md.split('\n')), headings, links, images };
}

// ------------------------------------------------------------------ load content
const sectionIds = new Set(SITE.sections.map(s => s.id));
const contentDir = path.join(ROOT, 'content');
const pages = [];
for (const file of walk(contentDir).filter(f => f.endsWith('.md'))) {
  const rel = path.relative(contentDir, file).split(path.sep).join('/');
  const { meta, body } = frontMatter(fs.readFileSync(file, 'utf8'), rel);
  const parts = rel.replace(/\.md$/, '').split('/');
  const isHome = rel === 'index.md';
  const section = isHome ? null : parts[0];
  const slug = isHome ? '' : parts.slice(1).join('/');
  if (!isHome && (parts.length !== 2 || !sectionIds.has(section))) { err(rel, `must be content/<section>/<article>.md with a section from sections.json (${[...sectionIds].join(', ')})`); continue; }
  if (!meta.title) err(rel, 'missing "title"');
  meta.description ||= meta.summary;
  if (!meta.description) err(rel, 'missing "description"');
  const sectionDef = SITE.sections.find(s => s.id === section);
  const audience = meta.audience || (sectionDef?.audience ?? 'internal');
  pages.push({ rel, meta, body, section, slug, isHome, audience, url: isHome ? '' : `${section}/${slug}`, order: Number(meta.order ?? 100) });
}
const inAudience = p => (AUDIENCE === 'client' ? p.audience === 'client' || p.audience === 'both' : true);
const homePage = AUDIENCE === 'client' ? pages.find(p => p.meta.home === 'client') : pages.find(p => p.isHome);
if (!homePage) err('content', AUDIENCE === 'client' ? 'no article with "home: client" for the client site' : 'content/index.md is missing');
const siteSections = SITE.sections.filter(s => (AUDIENCE === 'client' ? s.audience === 'client' || s.audience === 'both' || pages.some(p => p.section === s.id && inAudience(p)) : true));
const articles = pages
  .filter(p => !p.isHome && inAudience(p) && p !== homePage)
  .sort((a, b) => SITE.sections.findIndex(s => s.id === a.section) - SITE.sections.findIndex(s => s.id === b.section) || a.order - b.order || String(a.meta.title).localeCompare(String(b.meta.title)));
const urlSet = new Map([[ '', homePage ], ...articles.map(a => [a.url, a])]);
if (homePage && !homePage.isHome) urlSet.set(homePage.url, homePage);

// ------------------------------------------------------------------ render pages
const SECRET_PATTERNS = [/eyJ[A-Za-z0-9_-]{20,}/, /\bsk_(live|test)_/i, /service_role/i, /\bBearer\s+[A-Za-z0-9._-]{16,}/, /password\s*[:=]\s*["'`]?[^\s"'`<>*(),.]{6,}/i, /\bSUPABASE_[A-Z_]*KEY\b/, /AKIA[0-9A-Z]{16}/];
const rendered = [];
const allPages = [homePage, ...articles].filter(Boolean);
for (const p of allPages) {
  const depth = p.url ? p.url.split('/').length : 0;
  const base = '../'.repeat(depth);
  const r = createRenderer({ file: p.rel, base });
  for (const re of SECRET_PATTERNS) if (re.test(p.body)) err(p.rel, `looks like a secret or credential (${re}); documentation must never contain real credentials`);
  const html = r.render(p.body);
  const h1 = /^#\s+(.*)$/m.exec(p.body);
  if (h1 && slugify(h1[1]) !== slugify(p.meta.title)) warnings.push(`${p.rel}: first "# heading" differs from the title (the title from the front matter is used)`);
  for (const img of r.images) {
    if (!img.alt || img.alt.trim().length < 5) err(p.rel, `image ${img.url} needs descriptive alt text`);
    if (img.url.startsWith('shot:') && !fs.existsSync(path.join(ROOT, 'assets', 'shots', img.url.slice(5)))) err(p.rel, `image file assets/shots/${img.url.slice(5)} does not exist`);
  }
  rendered.push({ p, html, headings: r.headings.filter(h => h.level >= 2 && h.level <= 3), allHeadings: r.headings, links: r.links, base, images: r.images });
}
// links
const anchorsOf = new Map(rendered.map(x => [x.p.url, new Set(x.allHeadings.map(h => h.id))]));
for (const x of rendered) {
  for (const l of x.links) {
    const [target, anchor] = l.replace(/^\//, '').split('#');
    if (!target) { if (anchor && !anchorsOf.get(x.p.url)?.has(anchor)) err(x.p.rel, `link #${anchor} does not match a heading`); continue; }
    const key = target.replace(/\/$/, '');
    if (!urlSet.has(key)) { err(x.p.rel, `broken link "${l}"${AUDIENCE === 'client' ? ' (not part of the client documentation)' : ''}`); continue; }
    if (anchor && !anchorsOf.get(key)?.has(anchor)) err(x.p.rel, `link "${l}": the page has no heading "#${anchor}"`);
  }
  for (const rel of [].concat(x.p.meta.related || [])) if (!urlSet.has(rel.replace(/^\//, ''))) err(x.p.rel, `related article "${rel}" does not exist${AUDIENCE === 'client' ? ' in the client documentation' : ''}`);
}
if (errors.length) {
  console.error(`\nDocumentation build FAILED (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n` + errors.map(e => ` - ${e}`).join('\n'));
  process.exit(1);
}
if (CHECK_ONLY) { console.log(`Checked ${rendered.length} pages: OK${warnings.length ? `\nWarnings:\n${warnings.map(w => ` - ${w}`).join('\n')}` : ''}`); process.exit(0); }

// ------------------------------------------------------------------ layout
const flatNav = articles.map(a => a.url);
const sectionTitle = id => SITE.sections.find(s => s.id === id)?.title ?? id;
function sidebar(current, base) {
  const home = `<a class="nav-home${current === homePage.url ? ' active' : ''}" href="${base || './'}"${current === homePage.url ? ' aria-current="page"' : ''}>${esc(AUDIENCE === 'client' ? 'Welcome' : 'Welcome to Amuwa AI CRM')}</a>`;
  const groups = siteSections.map(s => {
    const list = articles.filter(a => a.section === s.id);
    if (!list.length) return '';
    const open = list.some(a => a.url === current);
    let lastGroup = null;
    const items = list.map(a => {
      const g = a.meta.group && a.meta.group !== lastGroup ? `<li class="nav-group-label">${esc(a.meta.group)}</li>` : '';
      lastGroup = a.meta.group || lastGroup;
      return `${g}<li><a href="${base}${a.url}/"${a.url === current ? ' class="active" aria-current="page"' : ''}>${esc(a.meta.nav || a.meta.title)}</a></li>`;
    }).join('');
    return `<details class="nav-section"${open ? ' open' : ''}><summary>${esc(s.title)}</summary><ul>${items}</ul></details>`;
  }).join('');
  return `${home}${groups}`;
}
function page({ p, html, headings, base }) {
  const current = p.url;
  const isHome = p === homePage;
  const idx = flatNav.indexOf(current);
  const prev = idx > 0 ? urlSet.get(flatNav[idx - 1]) : null;
  const next = idx >= 0 && idx < flatNav.length - 1 ? urlSet.get(flatNav[idx + 1]) : null;
  const crumbs = isHome ? '' : `<nav class="crumbs" aria-label="Breadcrumb"><a href="${base || './'}">Docs</a><span>/</span><span>${esc(sectionTitle(p.section))}</span><span>/</span><span aria-current="page">${esc(p.meta.title)}</span></nav>`;
  const roles = [].concat(p.meta.roles || []);
  const related = [].concat(p.meta.related || []).map(r => urlSet.get(r.replace(/^\//, ''))).filter(Boolean);
  const toc = headings.length > 1 ? `<nav class="toc" aria-label="On this page"><div class="toc-title">On this page</div><ul>${headings.map(h => `<li class="l${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></nav>` : '';
  const mobileToc = headings.length > 1 ? `<details class="toc-mobile"><summary>On this page</summary><ul>${headings.map(h => `<li class="l${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></details>` : '';
  const pager = isHome ? '' : `<nav class="pager" aria-label="Previous and next article">${prev ? `<a class="prev" href="${base}${prev.url}/"><small>Previous</small><span>${esc(prev.meta.title)}</span></a>` : '<span></span>'}${next ? `<a class="next" href="${base}${next.url}/"><small>Next</small><span>${esc(next.meta.title)}</span></a>` : '<span></span>'}</nav>`;
  const status = p.meta.status === 'needs-confirmation' ? `<aside class="callout gap"><div class="callout-title">${svg('gap')}<span>Being confirmed</span></div><div class="callout-body"><p>Some steps in this article have not been confirmed against the working application yet. Check with your administrator before relying on them.</p></div></aside>` : '';
  const title = isHome ? `${p.meta.title} - Amuwa AI CRM Documentation` : `${p.meta.title} - ${sectionTitle(p.section)} - Amuwa AI CRM Documentation`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(p.meta.description || '')}">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${base}assets/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}assets/docs.css">
</head>
<body data-base="${base}">
<div class="nav-progress" id="nav-progress" aria-hidden="true"></div>
<a class="skip" href="#main">Skip to the article</a>
<header class="top">
  <button class="icon-btn menu-btn" type="button" aria-label="Toggle navigation menu" aria-controls="sidebar" aria-expanded="false" title="Toggle navigation menu"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <a class="brand" href="${base || './'}"><img src="${base}assets/logo.png" alt="" width="28" height="28"><span>Amuwa AI CRM<small>${AUDIENCE === 'client' ? 'Client guide' : 'Documentation'}</small></span></a>
  <button class="search-btn" type="button" aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search the documentation</span><kbd>/</kbd></button>
</header>
<div class="shell">
  <div class="scrim" hidden></div>
  <aside class="sidebar" id="sidebar" aria-label="Documentation navigation">
    <div class="sidebar-head">
      <span class="sidebar-title">${AUDIENCE === 'client' ? 'Client Guide Menu' : 'Documentation Menu'}</span>
      <button class="sidebar-close-btn" type="button" aria-label="Close menu" title="Close menu"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <nav>${sidebar(current, base)}</nav>
  </aside>
  <main id="main" class="main">
    <article class="article">
      ${crumbs}
      <header class="article-head">
        ${isHome ? '' : `<p class="eyebrow">${esc(sectionTitle(p.section))}</p>`}
        <h1>${esc(p.meta.title)}</h1>
        <p class="lead">${esc(p.meta.description || '')}</p>
        ${roles.length ? `<p class="roles"><span>For</span>${roles.map(r => `<b>${esc(r)}</b>`).join('')}</p>` : ''}
      </header>
      ${mobileToc}
      ${status}
      <div class="prose">${html}</div>
      ${related.length ? `<section class="related" aria-labelledby="related-h"><h2 id="related-h">Related articles</h2><ul>${related.map(r => `<li><a href="${base}${r.url}/"><b>${esc(r.meta.title)}</b><span>${esc(r.meta.description || '')}</span></a></li>`).join('')}</ul></section>` : ''}
      ${pager}
      <footer class="foot">${p.meta.updated ? `Last reviewed ${esc(p.meta.updated)}. ` : ''}Spotted something that no longer matches the application? Tell your administrator so this page can be updated.</footer>
    </article>
    ${toc}
  </main>
</div>
<div class="search-modal" role="dialog" aria-modal="true" aria-label="Search the documentation" hidden>
  <div class="search-box">
    <div class="search-input"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search, for example: record a payment" aria-label="Search the documentation" autocomplete="off"><button type="button" class="search-close" aria-label="Close search">Esc</button></div>
    <ul class="search-results" role="listbox"></ul>
    <p class="search-hint">Type at least two letters. Use the arrow keys and Enter to open a result.</p>
  </div>
</div>
<script src="${base}assets/search-index.js" defer></script>
<script src="${base}assets/docs.js" defer></script>
<script src="${base}assets/mermaid.min.js"></script>
<script>
  (function() {
    function initMermaid() {
      if (typeof mermaid === 'undefined') return;
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'loose',
          fontFamily: 'Manrope, system-ui, sans-serif',
          themeVariables: {
            fontFamily: 'Manrope, system-ui, sans-serif',
            primaryColor: '#EEF2FF',
            primaryTextColor: '#111827',
            primaryBorderColor: '#2F5BEA',
            lineColor: '#6B7280',
            secondaryColor: '#F7F8FA',
            tertiaryColor: '#FFFFFF'
          }
        });
        mermaid.run({ querySelector: '.mermaid' }).catch(function(err) {
          console.warn('Mermaid rendering notice:', err);
        });
      } catch (e) {
        console.warn('Mermaid initialization notice:', e);
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initMermaid);
    } else {
      initMermaid();
    }
  })();
</script>
</body>
</html>`;
}

// ------------------------------------------------------------------ write output
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
for (const f of ['docs.css', 'docs.js', 'mermaid.min.js']) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'assets', f));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(OUT, 'assets', 'logo.png'));
const usedShots = new Set(rendered.flatMap(x => x.images.filter(i => i.url.startsWith('shot:')).map(i => i.url.slice(5))));
fs.mkdirSync(path.join(OUT, 'assets', 'shots'), { recursive: true });
for (const f of usedShots) fs.copyFileSync(path.join(ROOT, 'assets', 'shots', f), path.join(OUT, 'assets', 'shots', f));

const index = [];
const textOf = html => html.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<a class="anchor"[^>]*>#<\/a>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
for (const x of rendered) {
  const out = path.join(OUT, x.p.url, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page(x));
  const url = x.p.url ? `${x.p.url}/` : '';
  const parts = x.html.split(/(?=<h[23] id=")/);
  index.push({ t: x.p.meta.title, s: x.p.section ? sectionTitle(x.p.section) : 'Home', u: url, h: '', a: '', x: `${x.p.meta.description || ''} ${textOf(parts[0] || '')}`.slice(0, 700) });
  for (const part of parts.slice(1)) {
    const m = /^<h[23] id="([^"]+)">([\s\S]*?)<a class="anchor"/.exec(part);
    if (m) index.push({ t: x.p.meta.title, s: x.p.section ? sectionTitle(x.p.section) : 'Home', u: url, h: textOf(m[2]), a: m[1], x: textOf(part).slice(0, 700) });
  }
}
fs.writeFileSync(path.join(OUT, 'assets', 'search-index.js'), `window.__DOCS_INDEX=${JSON.stringify(index)};`);
fs.writeFileSync(path.join(OUT, '404.html'), page({ p: { url: '404', section: null, meta: { title: 'Page not found', description: 'This page does not exist. Use the search or the navigation to find what you need.' } }, html: `<p><a href="${'./'}">Go to the documentation home</a>.</p>`, headings: [], base: '/' }).replace(/href="\//g, 'href="/').replace(/(href|src)="\/assets/g, '$1="/assets'));

// maintainers' inventory (internal build only)
if (AUDIENCE === 'internal') {
  const rows = rendered.map(x => `| ${x.p.url || '(home)'} | ${x.p.audience} | ${[].concat(x.p.meta.roles || []).join(', ')} | ${x.p.meta.status || 'verified'} | ${x.images.filter(i => i.url.startsWith('shot:')).length} | ${[].concat(x.p.meta.sources || []).map(s => `\`${s}\``).join(', ')} |`);
  fs.writeFileSync(path.join(ROOT, 'INVENTORY.md'), `# Documentation inventory\n\nGenerated by \`node docs-site/build.mjs\` - do not edit by hand.\n\n${rendered.length} pages. "Status" is \`verified\` (checked against the code and the running application) or \`needs-confirmation\` (published with a notice).\n\n| Page | Audience | Roles | Status | Screenshots | Verified against |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`);
}
console.log(`Built ${rendered.length} pages (${AUDIENCE}) -> ${path.relative(process.cwd(), OUT)}, ${index.length} search entries, ${usedShots.size} screenshots${warnings.length ? `\nWarnings:\n${warnings.map(w => ` - ${w}`).join('\n')}` : ''}`);
