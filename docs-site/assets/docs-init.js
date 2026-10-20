/* Draws the diagrams (Mermaid). Kept as its own file so the pages need no inline script. */
(function () {
  function initMermaid() {
    if (typeof mermaid === 'undefined') return;
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
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
      mermaid.run({ querySelector: '.mermaid' }).catch(function (err) {
        console.warn('Mermaid rendering notice:', err);
      });
    } catch (e) {
      console.warn('Mermaid initialization notice:', e);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMermaid);
  else initMermaid();
})();
