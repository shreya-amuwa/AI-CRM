import { useEffect, useState } from 'react';

/** A notification about an AI Studio task or daily report opens that page of the AI Studio dashboard, on the item it names. */
export const OPEN_AI_STUDIO_EVENT = 'crm:open-ai-studio';
/** A task or a report (a notification, a search result) opens it; a project (a search result) opens the Projects page. */
export interface OpenAiStudioDetail { kind: 'task' | 'report' | 'project'; id?: string }
let pending: OpenAiStudioDetail | null = null;

export const openAiStudio = (detail: OpenAiStudioDetail) => {
  pending = detail;
  window.dispatchEvent(new CustomEvent<OpenAiStudioDetail>(OPEN_AI_STUDIO_EVENT, { detail }));
};
/**
 * What a notification asked for, read without consuming it (a state initializer may run twice); the page forgets it with `clearPendingAiStudio` once it is on
 * screen, so it opens the item once.
 */
export const peekPendingAiStudio = (kind: OpenAiStudioDetail['kind']): string | null => (pending && pending.kind === kind ? pending.id ?? null : null);
export const clearPendingAiStudio = (kind: OpenAiStudioDetail['kind']) => { if (pending?.kind === kind) pending = null; };
/** A hook for a page: the item a notification asked for (read now, forgotten after the first render). */
export function usePendingAiStudio(kind: OpenAiStudioDetail['kind']): string | null {
  const [id] = useState(() => peekPendingAiStudio(kind));
  useEffect(() => { clearPendingAiStudio(kind); }, [kind]);
  return id;
}
/** For a dashboard: switch to the page when something asks for it. */
export function useOpenAiStudioRequest(show: (detail: OpenAiStudioDetail) => void) {
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<OpenAiStudioDetail>).detail);
    window.addEventListener(OPEN_AI_STUDIO_EVENT, on);
    return () => window.removeEventListener(OPEN_AI_STUDIO_EVENT, on);
  }, [show]);
}

/** Tells the pages to read their lists again after something changed here. */
export const AI_STUDIO_CHANGED_EVENT = 'crm:ai-studio-changed';
export const notifyAiStudioChanged = () => window.dispatchEvent(new Event(AI_STUDIO_CHANGED_EVENT));
export function useAiStudioChanged(reload: () => void) {
  useEffect(() => {
    window.addEventListener(AI_STUDIO_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AI_STUDIO_CHANGED_EVENT, reload);
  }, [reload]);
}
