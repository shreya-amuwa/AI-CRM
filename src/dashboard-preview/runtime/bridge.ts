import { frameToParentSchema, parentToFrameSchema, type FrameToParent, type PreviewLaunch } from '../../../shared/dashboardExplorer';

/**
 * The only channel between the preview frame and Dashboard Explorer (the Managing Director's page). The frame is sandboxed without
 * allow-same-origin, so its own origin is opaque ("null"); the parent is the CRM's origin, which is the frame URL's origin (location.origin).
 *  - Messages are accepted only from window.parent, only from that origin, and only when they match the schema; anything else is ignored.
 *  - The frame never receives a token, a session or any live data: the launch message names a dashboard, a department and a scenario.
 */
const PARENT_ORIGIN = location.origin;

export function postToParent(message: FrameToParent): void {
  const checked = frameToParentSchema.safeParse(message);
  if (!checked.success || window.parent === window) return;
  window.parent.postMessage(checked.data, PARENT_ORIGIN);
}

export function onLaunch(handler: (launch: PreviewLaunch) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.source !== window.parent || e.origin !== PARENT_ORIGIN) return;
    const parsed = parentToFrameSchema.safeParse(e.data);
    if (parsed.success && parsed.data.type === 'crm-preview:launch') handler(parsed.data.launch);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** True when the page runs inside Dashboard Explorer's frame (a direct visit has no parent and shows a notice instead). */
export const insideExplorer = (): boolean => window.parent !== window;
