import type React from 'react';

/** Things inside a row that do their own job: a click on them must not open the row. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="checkbox"], [role="menuitem"], [data-no-row-click]';

/**
 * Makes a whole list row or card open its details when clicked anywhere (Enter / Space too
 * when the row itself has focus). Buttons, links and form controls inside the row keep working.
 * Spread the result on the `<tr>`, `<li>` or card `<div>`.
 */
export function rowOpen(activate: () => void) {
  return {
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      const hit = (e.target as HTMLElement).closest(INTERACTIVE);
      if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return;
      if (window.getSelection()?.toString()) return; // the user was selecting text
      activate();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    },
    tabIndex: 0,
    style: { cursor: 'pointer' } as React.CSSProperties
  };
}
