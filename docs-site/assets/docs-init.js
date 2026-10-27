/* Draws the diagrams (Mermaid). Kept as its own file so the pages need no inline script. */
(function () {
  function getMermaidConfig() {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return {
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'strict',
      fontFamily: 'Manrope, system-ui, sans-serif',
      flowchart: { htmlLabels: true, curve: 'basis', padding: 14 },
      themeVariables: dark
        ? {
            fontFamily: 'Manrope, system-ui, sans-serif',
            primaryColor: '#1E293B',
            primaryTextColor: '#F9FAFB',
            primaryBorderColor: '#6F8BF0',
            lineColor: '#9CA3AF',
            secondaryColor: '#111827',
            tertiaryColor: '#1F2937',
            mainBkg: '#1E293B',
            nodeBorder: '#6F8BF0',
            clusterBkg: '#111827',
            clusterBorder: '#374151',
            titleColor: '#F9FAFB',
            edgeLabelBackground: '#111827'
          }
        : {
            fontFamily: 'Manrope, system-ui, sans-serif',
            primaryColor: '#EEF2FF',
            primaryTextColor: '#111827',
            primaryBorderColor: '#2F5BEA',
            lineColor: '#6B7280',
            secondaryColor: '#F7F8FA',
            tertiaryColor: '#FFFFFF',
            mainBkg: '#EEF2FF',
            nodeBorder: '#2F5BEA',
            clusterBkg: '#F7F8FA',
            clusterBorder: '#E7E9EE',
            titleColor: '#111827',
            edgeLabelBackground: '#FFFFFF'
          }
    };
  }

  function renderAllMermaid(scope) {
    if (typeof mermaid === 'undefined') return;
    try {
      mermaid.initialize(getMermaidConfig());
      var root = scope || document;
      var nodes = root.querySelectorAll('.mermaid');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var src = el.getAttribute('data-mermaid-src');
        if (!src) {
          src = el.textContent || '';
          el.setAttribute('data-mermaid-src', src);
        } else if (el.getAttribute('data-processed')) {
          el.removeAttribute('data-processed');
          el.textContent = src;
        }
      }
      if (nodes.length) {
        mermaid.run({ nodes: nodes }).catch(function (err) {
          console.warn('Mermaid rendering notice:', err);
        });
      }
    } catch (e) {
      console.warn('Mermaid initialization notice:', e);
    }
  }

  window.__renderDocsMermaid = renderAllMermaid;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderAllMermaid(document); });
  } else {
    renderAllMermaid(document);
  }
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        renderAllMermaid(document);
      });
    } catch (_e) {}
  }
})();
