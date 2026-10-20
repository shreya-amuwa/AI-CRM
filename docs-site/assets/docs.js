/* Amuwa AI CRM documentation: instant SPA navigation, navigation drawer, search, "on this page" highlight. No dependencies. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var brandLink = $('.brand');
  var rootUrl = new URL(brandLink ? brandLink.getAttribute('href') || './' : './', window.location.href).href.replace(/\/+$/, '') + '/';

  // ---- navigation drawer and collapse toggle
  var sidebar = $('#sidebar'), scrim = $('.scrim'), menuBtn = $('.menu-btn'), shell = $('.shell');
  var closeBtn = $('.sidebar-close-btn');

  function isMobile() {
    return window.innerWidth <= 1080;
  }

  function setDrawer(open) {
    if (isMobile()) {
      sidebar.classList.toggle('open', open);
      scrim.hidden = !open;
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        document.body.style.overflow = 'hidden';
        var a = $('a.active', sidebar) || $('a', sidebar);
        if (a) a.focus({ preventScroll: true });
      } else {
        document.body.style.overflow = '';
        if (document.activeElement && sidebar.contains(document.activeElement)) menuBtn.focus();
      }
    } else {
      shell.classList.toggle('sidebar-collapsed');
      var collapsed = shell.classList.contains('sidebar-collapsed');
      menuBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      if (isMobile()) {
        setDrawer(!sidebar.classList.contains('open'));
      } else {
        shell.classList.toggle('sidebar-collapsed');
        var collapsed = shell.classList.contains('sidebar-collapsed');
        menuBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    });
    if (scrim) scrim.addEventListener('click', function () { setDrawer(false); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setDrawer(false); });
  }

  // Normalize sidebar links so relative paths remain valid across SPA navigations
  function normalizeSidebarLinks() {
    $$('#sidebar a').forEach(function (a) {
      if (!a.hasAttribute('data-target-url')) {
        a.setAttribute('data-target-url', a.href);
      }
    });
  }
  normalizeSidebarLinks();

  function updateSidebarActive(targetUrl) {
    var cleanTarget = targetUrl.split('#')[0].replace(/\/+$/, '');
    $$('#sidebar a').forEach(function (a) {
      var aTarget = (a.getAttribute('data-target-url') || a.href).split('#')[0].replace(/\/+$/, '');
      var isActive = aTarget === cleanTarget;
      a.classList.toggle('active', isActive);
      if (isActive) {
        a.setAttribute('aria-current', 'page');
        var details = a.closest('details.nav-section');
        if (details) details.open = true;
        if (a.scrollIntoView && sidebar) {
          var box = sidebar.getBoundingClientRect(), r = a.getBoundingClientRect();
          if (r.top < box.top || r.bottom > box.bottom) {
            sidebar.scrollTop += r.top - box.top - box.height / 3;
          }
        }
      } else {
        a.removeAttribute('aria-current');
      }
    });
  }

  var active = $('a.active', sidebar);
  if (active && active.scrollIntoView) {
    var box = sidebar.getBoundingClientRect(), r = active.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) sidebar.scrollTop += r.top - box.top - box.height / 3;
  }

  // ---- search
  var modal = $('.search-modal'), input = $('input', modal), list = $('.search-results', modal), hint = $('.search-hint', modal);
  var results = [], sel = -1, lastFocus = null;
  function open() { lastFocus = document.activeElement; modal.hidden = false; input.value = ''; render(''); input.focus(); document.body.style.overflow = 'hidden'; }
  function close() { modal.hidden = true; document.body.style.overflow = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  if ($('.search-btn')) $('.search-btn').addEventListener('click', open);
  if ($('.search-close', modal)) $('.search-close', modal).addEventListener('click', close);
  if (modal) modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
    if (modal && modal.hidden) {
      if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); open(); }
      else if (e.key === 'Escape' && sidebar.classList.contains('open')) setDrawer(false);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && sel >= 0 && results[sel]) { e.preventDefault(); navigate(href(results[sel])); close(); }
    else if (e.key === 'Tab') { var f = [input, $('.search-close', modal)].concat($$('a', list)); var i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  });
  if (input) input.addEventListener('input', function () { render(input.value); });
  function href(r) { return rootUrl + r.u + (r.a ? '#' + r.a : ''); }
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
  var tocObserver = null;
  function initTocObserver() {
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    var toc = $$('.toc a');
    if (toc.length && 'IntersectionObserver' in window) {
      var map = {};
      toc.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
      var heads = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
      tocObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            toc.forEach(function (a) { a.classList.remove('on'); });
            if (map[en.target.id]) map[en.target.id].classList.add('on');
          }
        });
      }, { rootMargin: '-70px 0px -70% 0px' });
      heads.forEach(function (h) { tocObserver.observe(h); });
    }
  }
  initTocObserver();

  // ---- dynamic mermaid diagram renderer
  function renderMermaid() {
    if (window.mermaid) {
      try {
        mermaid.run({ querySelector: '#main .mermaid' }).catch(function (err) {
          console.warn('Mermaid rendering notice:', err);
        });
      } catch (e) {
        console.warn('Mermaid run notice:', e);
      }
    }
  }

  // ---- SPA instant page navigation engine
  var progress = $('#nav-progress');
  var progressTimer = null;
  function startProgress() {
    if (!progress) return;
    clearTimeout(progressTimer);
    progress.classList.remove('done');
    progress.classList.add('loading');
  }
  function stopProgress() {
    if (!progress) return;
    progress.classList.remove('loading');
    progress.classList.add('done');
    clearTimeout(progressTimer);
    progressTimer = setTimeout(function () {
      progress.classList.remove('done');
    }, 350);
  }

  var pageCache = new Map();
  // Cache the initial loaded page in memory
  var initialCleanUrl = location.href.split('#')[0];
  var currentMain = $('#main');
  if (currentMain) {
    pageCache.set(initialCleanUrl, {
      title: document.title,
      html: currentMain.innerHTML,
      desc: ($('meta[name="description"]') || {}).content || ''
    });
  }

  function prefetch(url) {
    var clean = url.split('#')[0];
    if (pageCache.has(clean)) return;
    fetch(clean)
      .then(function (res) { return res.ok ? res.text() : null; })
      .then(function (text) {
        if (!text) return;
        var parser = new DOMParser();
        var doc = parser.parseFromString(text, 'text/html');
        var newMain = doc.querySelector('#main');
        if (newMain) {
          pageCache.set(clean, {
            title: doc.title,
            html: newMain.innerHTML,
            desc: (doc.querySelector('meta[name="description"]') || {}).content || ''
          });
        }
      })
      .catch(function () {});
  }

  function navigate(targetUrl, opts) {
    opts = opts || {};
    var cleanTarget = targetUrl.split('#')[0];
    var hash = targetUrl.includes('#') ? targetUrl.split('#')[1] : '';

    function applyPage(data) {
      document.title = data.title;
      var descMeta = $('meta[name="description"]');
      if (descMeta && data.desc) descMeta.setAttribute('content', data.desc);

      var main = $('#main');
      if (main) {
        main.style.animation = 'none';
        main.offsetHeight; // trigger reflow for smooth fadeIn transition
        main.style.animation = '';
        main.innerHTML = data.html;
      }

      updateSidebarActive(targetUrl);

      if (opts.push !== false) {
        history.pushState({ url: targetUrl }, '', targetUrl);
      }

      if (hash) {
        var el = document.getElementById(hash);
        if (el) el.scrollIntoView();
        else window.scrollTo(0, 0);
      } else {
        window.scrollTo(0, 0);
      }

      initTocObserver();
      renderMermaid();
    }

    if (pageCache.has(cleanTarget)) {
      applyPage(pageCache.get(cleanTarget));
      return;
    }

    startProgress();
    fetch(cleanTarget)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        stopProgress();
        var parser = new DOMParser();
        var doc = parser.parseFromString(text, 'text/html');
        var newMain = doc.querySelector('#main');
        if (!newMain) {
          window.location.href = targetUrl;
          return;
        }
        var pageData = {
          title: doc.title,
          html: newMain.innerHTML,
          desc: (doc.querySelector('meta[name="description"]') || {}).content || ''
        };
        pageCache.set(cleanTarget, pageData);
        applyPage(pageData);
      })
      .catch(function (err) {
        stopProgress();
        console.warn('Navigation fallback:', err);
        window.location.href = targetUrl;
      });
  }

  // Delegated link click interceptor for instant, flicker-free transitions
  document.body.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    if (a.origin !== location.origin) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    if (a.hasAttribute('download')) return;
    if (a.getAttribute('target') === '_blank') return;

    var currentPath = location.pathname.replace(/\/+$/, '') || '/';
    var targetPath = a.pathname.replace(/\/+$/, '') || '/';

    // Same-page anchor jump
    if (currentPath === targetPath && a.hash) {
      if (isMobile() && sidebar.classList.contains('open')) setDrawer(false);
      return;
    }

    e.preventDefault();
    if (isMobile() && sidebar.classList.contains('open')) setDrawer(false);
    if (modal && !modal.hidden) close();
    navigate(a.href);
  });

  // Prefetch pages on mouseover / touch for instantaneous navigation
  document.body.addEventListener('mouseover', function (e) {
    var a = e.target.closest('a');
    if (a && a.origin === location.origin && !a.hash && a.pathname) {
      prefetch(a.href);
    }
  }, { passive: true });

  document.body.addEventListener('touchstart', function (e) {
    var a = e.target.closest('a');
    if (a && a.origin === location.origin && !a.hash && a.pathname) {
      prefetch(a.href);
    }
  }, { passive: true });

  // Handle browser back and forward buttons smoothly
  window.addEventListener('popstate', function () {
    navigate(location.href, { push: false });
  });
})();
