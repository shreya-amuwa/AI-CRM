import React, { useCallback, useState } from 'react';
import { TaskDetails } from './TaskDetails';

/** Things inside a task card that do their own job: a click on them must never open the workspace. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, details, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [contenteditable="true"], [data-no-open]';

/** True when the click (or key) came from a control inside the card rather than from the card itself. */
export function isInsideControl(target: EventTarget | null, card: Element): boolean {
  const hit = (target as Element | null)?.closest?.(INTERACTIVE);
  return !!hit && hit !== card && card.contains(hit);
}

/**
 * Opens the task workspace from a task card. A card gets `cardProps(taskId)`: clicking anywhere on it (or pressing Enter / Space while the card itself has
 * focus) opens the workspace, except on its own buttons, inputs, links and expanders, and while the person is selecting text. Render `node` once on the page.
 */
export function useTaskWorkspace(onChanged?: () => void) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const cardProps = (taskId: string) => ({
    'data-task-card': taskId,
    tabIndex: 0,
    title: 'Open task details',
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (isInsideControl(e.target, e.currentTarget)) return;
      if (window.getSelection()?.toString()) return; // copying text from the card is not opening it
      setOpenId(taskId);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpenId(taskId); }
    }
  });
  const node = openId ? <TaskDetails taskId={openId} onClose={close} onChanged={onChanged} /> : null;
  return { open: setOpenId, node, cardProps };
}
