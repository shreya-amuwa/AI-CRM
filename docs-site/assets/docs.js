/* Amuwa AI CRM documentation: navigation drawer, search, "on this page" highlight. No dependencies. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var base = document.body.getAttribute('data-base') || '';

  // ---- mobile navigation drawer
  var sidebar = $('#sidebar'), scrim = $('.scrim'), menuBtn = $('.menu-btn');
  function setDrawer(open) {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var a = $('a.active', sidebar) || $('a', sidebar); if (a) a.focus({ preventScroll: true }); } else if (document.activeElement && sidebar.contains(document.activeElement)) menuBtn.focus();
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () { setDrawer(!sidebar.classList.contains('open')); });
    scrim.addEventListener('click', function () { setDrawer(false); });
    $$('a', sidebar).forEach(function (a) { a.addEventListener('click', function () { setDrawer(false); }); });
  }
  var active = $('a.active', sidebar);
  if (active && active.scrollIntoView) { var box = sidebar.getBoundingClientRect(), r = active.getBoundingClientRect(); if (r.top < box.top || r.bottom > box.bottom) sidebar.scrollTop += r.top - box.top - box.height / 3; }

  // ---- search
  var modal = $('.search-modal'), input = $('input', modal), list = $('.search-results', modal), hint = $('.search-hint', modal);
  var results = [], sel = -1, lastFocus = null;
  function open() { lastFocus = document.activeElement; modal.hidden = false; input.value = ''; render(''); input.focus(); document.body.style.overflow = 'hidden'; }
  function close() { modal.hidden = true; document.body.style.overflow = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $('.search-btn').addEventListener('click', open);
  $('.search-close', modal).addEventListener('click', close);
  modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
    if (modal.hidden) {
      if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); open(); }
      else if (e.key === 'Escape' && sidebar.classList.contains('open')) setDrawer(false);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && sel >= 0 && results[sel]) { e.preventDefault(); location.href = href(results[sel]); }
    else if (e.key === 'Tab') { var f = [input, $('.search-close', modal)].concat($$('a', list)); var i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  });
  input.addEventListener('input', function () { render(input.value); });
  function href(r) { return base + r.u + (r.a ? '#' + r.a : ''); }
  function move(d) { if (!results.length) return; sel = (sel + d + results.length) % results.length; paint(); }
  function paint() { $$('a', list).forEach(function (a, i) { a.setAttribute('aria-selected', i === sel ? 'true' : 'false'); if (i === sel) a.scrollIntoView({ block: 'nearest' }); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function words(q) { return q.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; }); }
  function mark(text, ws) { var out = esc(text); ws.forEach(function (w) { out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); }); return out; }
  function snippet(x, ws) {
    var low = x.toLowerCase(), at = -1;
    for (var i = 0; i < ws.length && at < 0; i++) at = low.indexOf(ws[i]);
    var from = Math.max(0, at - 40), s = x.slice(from, from + 150);
    return (from > 0 ? '... ' : '') + mark(s, ws) + (from + 150 < x.length ? ' ...' : '');
  }
  function search(q) {
    var ws = words(q), idx = window.__DOCS_INDEX || [];
    if (!ws.length) return [];
    var out = [];
    idx.forEach(function (e) {
      var t = e.t.toLowerCase(), h = (e.h || '').toLowerCase(), x = (e.x || '').toLowerCase(), score = 0, all = true;
      ws.forEach(function (w) {
        var s = 0;
        if (t.indexOf(w) >= 0) s += 10 + (t.split(/\W+/).indexOf(w) >= 0 ? 4 : 0);
        if (h.indexOf(w) >= 0) s += 7;
        if (x.indexOf(w) >= 0) s += 2;
        if (!s) all = false;
        score += s;
      });
      if (!all) return;
      if (!e.h) score += 3;
      var phrase = ws.join(' ');
      if (t.indexOf(phrase) >= 0) score += 12; else if (h.indexOf(phrase) >= 0) score += 8; else if (x.indexOf(phrase) >= 0) score += 4;
      out.push({ e: e, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    var seen = {}, res = [];
    out.forEach(function (o) { var k = o.e.u + '#' + o.e.a; if (!seen[k] && res.length < 12) { seen[k] = 1; res.push(o.e); } });
    return res;
  }
  function render(q) {
    var ws = words(q);
    results = search(q);
    sel = results.length ? 0 : -1;
    if (q.trim().length < 2) { list.innerHTML = ''; hint.hidden = false; return; }
    hint.hidden = true;
    if (!results.length) { list.innerHTML = '<li class="search-empty">No article matches "' + esc(q) + '". Try other words, for example "payment", "invoice" or "document".</li>'; return; }
    list.innerHTML = results.map(function (r, i) {
      return '<li role="option"><a href="' + esc(href(r)) + '" aria-selected="' + (i === 0) + '"><div class="r-title">' + mark(r.h || r.t, ws) + '</div><div class="r-path">' + esc(r.s) + ' / ' + esc(r.t) + '</div><div class="r-snippet">' + snippet(r.x, ws) + '</div></a></li>';
    }).join('');
  }

  // ---- highlight the current heading in "On this page"
  var toc = $$('.toc a');
  if (toc.length && 'IntersectionObserver' in window) {
    var map = {};
    toc.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var heads = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { toc.forEach(function (a) { a.classList.remove('on'); }); map[en.target.id].classList.add('on'); }
      });
    }, { rootMargin: '-70px 0px -70% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }
})();
