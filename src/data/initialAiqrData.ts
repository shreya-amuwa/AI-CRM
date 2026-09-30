export interface AiqrScanLog {
  id: string;
  visitorName: string;
  phone: string;
  email: string;
  device: string;
  city: string;
  scannedAt: string;
  status: 'Ingested' | 'Followed Up' | 'Converted';
}

export interface CustomAppLink {
  id: string;
  name: string;
  url: string;
  iconUrl: string;
}

export interface AiqrClient {
  id: string;
  uniqueQrId: string;
  name: string;
  companyName: string;
  phone: string;
  email: string;
  logoUrl: string;
  targetUrl: string;
  industry: string;
  createdAt: string;
  scansCount: number;
  scanLogs: AiqrScanLog[];
  appLinks?: CustomAppLink[];
}

export const DEFAULT_APP_LINKS: CustomAppLink[] = [
  { id: 'app-1', name: 'Website', url: 'https://amuwa.com', iconUrl: 'globe' },
  { id: 'app-2', name: 'WhatsApp', url: 'https://wa.me/919820112345', iconUrl: '/app_icons/whatsapp.png' },
  { id: 'app-3', name: 'Instagram', url: 'https://instagram.com', iconUrl: '/app_icons/instagram.png' },
  { id: 'app-4', name: 'Facebook', url: 'https://facebook.com', iconUrl: '/app_icons/facebook.png' },
  { id: 'app-5', name: 'Google Business Profile', url: 'https://google.com', iconUrl: '/app_icons/google_business.png' },
  { id: 'app-6', name: 'Location', url: 'https://maps.google.com', iconUrl: '/app_icons/location.png' },
  { id: 'app-7', name: 'YouTube', url: 'https://youtube.com', iconUrl: '/app_icons/youtube.png' },
];

export const INITIAL_AIQR_CLIENTS: AiqrClient[] = [];
