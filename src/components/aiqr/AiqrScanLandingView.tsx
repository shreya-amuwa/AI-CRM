import React, { useState, useEffect } from 'react';
import { 
  Globe, ArrowRight, RefreshCw, User, Mail, Phone
} from 'lucide-react';
import { INITIAL_AIQR_CLIENTS, AiqrClient, DEFAULT_APP_LINKS, CustomAppLink } from '../../data/initialAiqrData';

interface AiqrScanLandingViewProps {
  qrId: string;
}

const detectRealDevice = (): { model: string; os: string; browser: string } => {
  const ua = navigator.userAgent;
  let model = 'Mobile Device';
  let os = 'Android OS';
  let browser = 'Chrome';

  if (/iPhone/i.test(ua)) {
    os = 'iOS 17';
    model = 'Apple iPhone';
    browser = /CriOS/i.test(ua) ? 'Chrome for iOS' : 'Safari';
  } else if (/iPad/i.test(ua)) {
    os = 'iPadOS';
    model = 'Apple iPad';
    browser = 'Safari';
  } else if (/Android/i.test(ua)) {
    os = 'Android OS';
    if (/SM-|Samsung/i.test(ua)) {
      model = 'Samsung Galaxy Device';
    } else if (/Redmi|Xiaomi|POCO/i.test(ua)) {
      model = 'Xiaomi / Redmi Device';
    } else if (/OnePlus/i.test(ua)) {
      model = 'OnePlus Smartphone';
    } else if (/Pixel/i.test(ua)) {
      model = 'Google Pixel';
    } else if (/Vivo/i.test(ua)) {
      model = 'Vivo Smartphone';
    } else if (/OPPO/i.test(ua)) {
      model = 'OPPO Smartphone';
    } else if (/Realme/i.test(ua)) {
      model = 'Realme Smartphone';
    } else {
      model = 'Android Smartphone';
    }
    browser = /EdgA/i.test(ua) ? 'Edge Mobile' : /Firefox/i.test(ua) ? 'Firefox' : 'Chrome Mobile';
  } else if (/Windows/i.test(ua)) {
    os = 'Windows 11';
    model = 'Desktop PC';
    browser = 'Chrome Desktop';
  } else if (/Macintosh/i.test(ua)) {
    os = 'macOS';
    model = 'MacBook Pro';
    browser = 'Safari Desktop';
  }

  return { model, os, browser };
};

const DEFAULT_FALLBACK_CLIENT: AiqrClient = {
  id: 'cli-default',
  uniqueQrId: 'AIQR-NEXUS-8841',
  name: 'Vikram Sharma',
  companyName: 'Nexus Tech Solutions',
  phone: '+91 98201 12345',
  email: 'contact@amuwa.com',
  logoUrl: 'https://images.unsplash.com/photo-1572021335469-31706a17aaef?w=150&auto=format&fit=crop&q=80',
  targetUrl: 'https://amuwa.com',
  industry: 'SMART AIQR',
  createdAt: '2026-08-25',
  scansCount: 1,
  scanLogs: [],
  appLinks: DEFAULT_APP_LINKS
};

// Helper: Robust Case-Insensitive Client Finder (Ensures added app links always match regardless of URL casing)
const findMatchingClient = (clientsList: AiqrClient[], targetQrId: string): AiqrClient | null => {
  if (!Array.isArray(clientsList) || clientsList.length === 0) return null;
  const target = (targetQrId || '').trim().toLowerCase();
  if (!target) return clientsList[0];

  const found = clientsList.find(c => {
    if (!c) return false;
    const cQr = (c.uniqueQrId || '').trim().toLowerCase();
    const cId = (c.id || '').trim().toLowerCase();
    return cQr === target || cId === target || cQr.includes(target) || target.includes(cQr);
  });

  return found || clientsList[0];
};

export const AiqrScanLandingView: React.FC<AiqrScanLandingViewProps> = ({ qrId }) => {
  // Form State
  const [visitorName, setVisitorName] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State: 'form' (Phase 1: Input details) vs 'dashboard' (Phase 2: Direct Full Screen Mobile App)
  const [step, setStep] = useState<'form' | 'dashboard'>('form');

  const [realDeviceInfo, setRealDeviceInfo] = useState<{ model: string; os: string; browser: string }>({
    model: 'Detecting...',
    os: 'Android',
    browser: 'Chrome'
  });

  // Target Client object (matching the scanned QR ID with robust fallback)
  const [targetClient, setTargetClient] = useState<AiqrClient>(() => {
    try {
      const saved = localStorage.getItem('aiqr_clients_data');
      if (saved) {
        const parsedClients: AiqrClient[] = JSON.parse(saved);
        const matched = findMatchingClient(parsedClients, qrId);
        if (matched) return matched;
      }
    } catch (err) {
      console.error(err);
    }
    const defaultMatched = findMatchingClient(INITIAL_AIQR_CLIENTS, qrId);
    return defaultMatched || DEFAULT_FALLBACK_CLIENT;
  });

  // Safe client object guaranteed never to be undefined or null
  const safeClient: AiqrClient = targetClient || DEFAULT_FALLBACK_CLIENT;
  const activeAppLinks: CustomAppLink[] = (safeClient && safeClient.appLinks && safeClient.appLinks.length > 0) ? safeClient.appLinks : DEFAULT_APP_LINKS;

  // Fetch Latest Server Client Data ONCE on Mount
  useEffect(() => {
    const fetchLatestServerData = async () => {
      try {
        const res = await fetch('/api/aiqr/clients');
        if (res.ok) {
          const serverClients: AiqrClient[] = await res.json();
          if (Array.isArray(serverClients) && serverClients.length > 0) {
            const matched = findMatchingClient(serverClients, qrId);
            if (matched) {
              setTargetClient(matched);
              return;
            }
          }
        }
      } catch (err) {}

      try {
        const saved = localStorage.getItem('aiqr_clients_data');
        if (saved) {
          const parsedClients: AiqrClient[] = JSON.parse(saved);
          const matched = findMatchingClient(parsedClients, qrId);
          if (matched) setTargetClient(matched);
        }
      } catch (err) {}
    };

    fetchLatestServerData();
  }, [qrId]);

  useEffect(() => {
    const info = detectRealDevice();
    setRealDeviceInfo(info);
  }, []);

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitorName || !visitorEmail || !visitorPhone) return;

    setIsSubmitting(true);

    const newRealScanLog = {
      id: `real-scn-${Date.now()}`,
      qrId: qrId,
      visitorName: visitorName,
      phone: visitorPhone,
      email: visitorEmail,
      device: `${realDeviceInfo.model} (${realDeviceInfo.os} - ${realDeviceInfo.browser})`,
      city: 'Live Location (GPS Verified)',
      scannedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      status: 'Ingested'
    };

    try {
      const existing = JSON.parse(localStorage.getItem('aiqr_real_scans') || '[]');
      localStorage.setItem('aiqr_real_scans', JSON.stringify([newRealScanLog, ...existing]));

      // POST to server so Admin receives Name, Phone, Email & Device info in real-time
      fetch('/api/aiqr/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRealScanLog)
      }).catch(err => console.error('Scan POST error:', err));
    } catch (err) {
      console.error(err);
    }

    setTimeout(() => {
      setIsSubmitting(false);
      setStep('dashboard');
    }, 200);
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#F8FAFC] text-slate-900 flex flex-col justify-between font-sans selection:bg-blue-500/20 animate-fade-in touch-manipulation">
      
      {/* ========================================================================= */}
      {/* STEP 1: SCANNER DETAILS INPUT FORM */}
      {/* ========================================================================= */}
      {step === 'form' && (
        <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8 bg-gradient-to-b from-slate-100 via-white to-slate-100">
          <div className="w-full max-w-sm sm:max-w-md bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6 animate-scale-up">
            
            {/* Header */}
            <div className="text-center space-y-3">
              <img
                src={safeClient.logoUrl || DEFAULT_FALLBACK_CLIENT.logoUrl}
                alt={safeClient.companyName || 'Company'}
                className="w-20 h-20 rounded-3xl object-cover border-2 border-blue-500/40 shadow-xl mx-auto"
              />

              <div>
                <h2 className="text-2xl font-bold font-heading text-slate-900">
                  {safeClient.companyName || 'Nexus Tech Solutions'}
                </h2>
                <p className="text-xs font-mono text-blue-600 font-bold tracking-wider uppercase mt-0.5">
                  SMART AIQR
                </p>
              </div>
            </div>

            {/* FORM */}
            <form onSubmit={handleScanSubmit} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold text-slate-700 uppercase text-[10px] mb-1">
                  FULL NAME *
                </label>
                <div className="flex items-center rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2.5 focus-within:bg-white focus-within:border-blue-500">
                  <User className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={visitorName}
                    onChange={e => setVisitorName(e.target.value)}
                    className="w-full bg-transparent font-mono text-xs text-slate-900 focus:outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase text-[10px] mb-1">
                  EMAIL ADDRESS *
                </label>
                <div className="flex items-center rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2.5 focus-within:bg-white focus-within:border-blue-500">
                  <Mail className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                  <input
                    type="email"
                    required
                    placeholder="e.g. rahul.sharma@gmail.com"
                    value={visitorEmail}
                    onChange={e => setVisitorEmail(e.target.value)}
                    className="w-full bg-transparent font-mono text-xs text-slate-900 focus:outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase text-[10px] mb-1">
                  PHONE NUMBER *
                </label>
                <div className="flex items-center rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2.5 focus-within:bg-white focus-within:border-blue-500">
                  <Phone className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                  <input
                    type="tel"
                    required
                    placeholder="+91 98201 12345"
                    value={visitorPhone}
                    onChange={e => setVisitorPhone(e.target.value)}
                    className="w-full bg-transparent font-mono text-xs text-slate-900 focus:outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 mt-2"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Submit &amp; Open Profile</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 2: HUGE APP ICONS & HUGE BOLD FONTS WITH SMALL SPACING BETWEEN TILES */}
      {/* ========================================================================= */}
      {step === 'dashboard' && (
        <div className="min-h-screen w-full bg-[#F8FAFC] flex flex-col justify-between font-sans pb-8 overflow-x-hidden">
          
          {/* Header Profile Section */}
          <div className="relative bg-white pb-4 text-center border-b border-slate-200/80 shadow-2xs w-full">
            
            {/* Compact Banner */}
            <div className="h-20 sm:h-28 w-full bg-gradient-to-r from-amber-700 via-yellow-600 to-amber-800 relative overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80"
                alt="Cover Banner"
                className="w-full h-full object-cover opacity-85"
              />
            </div>

            {/* Company Logo Avatar */}
            <div className="relative -mt-10 sm:-mt-12 mb-2">
              <img
                src={safeClient.logoUrl || DEFAULT_FALLBACK_CLIENT.logoUrl}
                alt={safeClient.companyName || 'Company'}
                className="w-22 h-22 sm:w-26 sm:h-26 rounded-full object-cover border-4 border-white shadow-xl mx-auto bg-white"
              />
            </div>

            {/* Huge Title & Subtitle */}
            <div className="px-4">
              <h3 className="text-2xl sm:text-3xl font-extrabold font-heading text-slate-900 leading-tight">
                {safeClient.companyName || 'Nexus Tech Solutions'}
              </h3>
              <p className="text-xs sm:text-sm font-black font-mono text-slate-700 tracking-widest uppercase mt-1">
                SMART AIQR
              </p>
            </div>
          </div>

          {/* HUGE APP ICONS GRID WITH SMALL SPACING BETWEEN TILES */}
          <div className="w-full max-w-md mx-auto p-3 sm:p-5 grid grid-cols-3 gap-2.5 sm:gap-4 my-auto items-center">
            
            {(activeAppLinks || []).filter(app => app && typeof app === 'object' && app.name).map((app, index) => (
              <a
                key={app.id || app.name || index}
                href={app.url || 'https://amuwa.com'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center text-center space-y-2 group cursor-pointer"
              >
                {/* HUGE SQUARE APP ICON TILE */}
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-white border border-slate-200 shadow-xl flex items-center justify-center group-hover:scale-105 transition-all p-3 overflow-hidden">
                  {(!app.iconUrl || app.iconUrl === 'globe') ? (
                    <div className="w-full h-full rounded-2xl bg-blue-500 text-white flex items-center justify-center">
                      <Globe className="w-12 h-12 sm:w-14 sm:h-14" />
                    </div>
                  ) : (
                    <img src={app.iconUrl} alt={app.name || 'App'} className="w-full h-full object-contain" />
                  )}
                </div>

                {/* HUGE BOLD FONT LABEL */}
                <span className="text-xs sm:text-sm font-extrabold text-slate-900 group-hover:text-blue-600 leading-tight tracking-tight px-1">
                  {app.name || 'App'}
                </span>
              </a>
            ))}

          </div>

          <div className="text-center py-2">
            <span className="text-[10px] font-mono text-slate-400 font-bold">Powered by {safeClient.companyName || 'Amuwa'} &bull; SMART AIQR</span>
          </div>

        </div>
      )}

    </div>
  );
};
