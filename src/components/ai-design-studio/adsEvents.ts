import { useEffect } from 'react';

/** A notification about an AI Design Studio record (entityType ads_client, ads_notice, ads_assignment, ads_report, ads_issue) opens its page. */
export const OPEN_ADS_EVENT = 'crm:open-ads';
export interface OpenAdsDetail { entityType: string; id?: string }
let pending: OpenAdsDetail | null = null;

export const openAds = (detail: OpenAdsDetail) => {
  pending = detail;
  window.dispatchEvent(new CustomEvent<OpenAdsDetail>(OPEN_ADS_EVENT, { detail }));
};
/** A page takes what was asked for when it opens (once), when it is the page for that kind of record. */
export const takePendingAds = (entityType: string): string | null => {
  if (!pending || pending.entityType !== entityType) return null;
  const id = pending.id ?? null;
  pending = null;
  return id;
};

/** The dashboard switches to the page that belongs to the record. */
export function useOpenAdsRequest(show: (detail: OpenAdsDetail) => void) {
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<OpenAdsDetail>).detail);
    window.addEventListener(OPEN_ADS_EVENT, on);
    return () => window.removeEventListener(OPEN_ADS_EVENT, on);
  }, [show]);
}

/** Tells the pages that something changed (so the overview and badges read again). */
export const ADS_CHANGED_EVENT = 'crm:ads-changed';
export const notifyAdsChanged = () => window.dispatchEvent(new Event(ADS_CHANGED_EVENT));
