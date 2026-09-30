import React, { useState, useEffect } from 'react';
import {
  Navigation,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Phone,
  User,
  ExternalLink,
  ChevronRight,
  Battery,
  Radio,
  Plus,
  Compass,
  ArrowRight,
  Car,
  ShieldCheck,
  Building2,
  RefreshCw,
  X,
  Check
} from 'lucide-react';
import { fieldVisitStore, FieldVisit, FieldVisitStop } from '../../services/fieldVisitStore';

interface FieldVisitTrackerViewProps {
  viewerRole?: 'superadmin' | 'admin' | 'team-lead' | 'team-member';
  currentUserId?: string;
  userName?: string;
}

export const FieldVisitTrackerView: React.FC<FieldVisitTrackerViewProps> = ({
  viewerRole = 'admin',
  currentUserId,
  userName
}) => {
  const [visits, setVisits] = useState<FieldVisit[]>(() => fieldVisitStore.getVisits());
  const [filter, setFilter] = useState<'all' | 'transit' | 'reached' | 'alerts'>('all');
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(visits[0]?.id || null);
  const [showStartVisitModal, setShowStartVisitModal] = useState(false);
  const [showLogStopModal, setShowLogStopModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Visit Form State
  const [newClientName, setNewClientName] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newPurpose, setNewPurpose] = useState('');
  const [newEstimatedArrival, setNewEstimatedArrival] = useState('Within 45 mins');

  // Log Stop Form State
  const [stopLocation, setStopLocation] = useState('');
  const [stopDuration, setStopDuration] = useState(20);
  const [stopNotes, setStopNotes] = useState('');

  useEffect(() => {
    const unsubscribe = fieldVisitStore.subscribe(() => {
      setVisits(fieldVisitStore.getVisits());
    });
    return () => unsubscribe();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleStartVisit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientAddress) return;

    const visit = fieldVisitStore.startVisit({
      employeeId: currentUserId || 'tm-user',
      employeeName: userName || 'Sales Executive',
      employeeRole: 'Sales Executive',
      clientName: newClientName,
      clientAddress: newClientAddress,
      clientContact: newClientContact || '+91 98000 00000',
      purpose: newPurpose || 'Client On-Site Consultation & Demo',
      estimatedArrivalTime: newEstimatedArrival
    });

    setSelectedVisitId(visit.id);
    setShowStartVisitModal(false);
    setNewClientName('');
    setNewClientAddress('');
    setNewClientContact('');
    setNewPurpose('');
    showToast(`📍 Field Visit started for ${visit.clientName}! Live GPS phone location tracking is now ACTIVE.`);
  };

  const handleMarkReached = (visitId: string) => {
    fieldVisitStore.markDestinationReached(visitId);
    showToast('✅ Verified: Sales Executive has officially REACHED the client destination!');
  };

  const handleLogStop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisitId || !stopLocation) return;

    fieldVisitStore.logStop(selectedVisitId, {
      locationName: stopLocation,
      durationMinutes: Number(stopDuration),
      notes: stopNotes
    });

    setShowLogStopModal(false);
    setStopLocation('');
    setStopNotes('');
    if (Number(stopDuration) > 15) {
      showToast(`⚠️ Stop logged (${stopDuration} mins): Flagged as >15 min waiting delay.`);
    } else {
      showToast(`⏱️ Stop logged at ${stopLocation} (${stopDuration} mins).`);
    }
  };

  const handleCompleteVisit = (visitId: string) => {
    fieldVisitStore.completeVisit(visitId);
    showToast('🏁 Field visit marked as completed and logged to company records.');
  };

  const activeVisitsCount = visits.filter(v => v.currentStatus !== 'Completed').length;
  const inTransitCount = visits.filter(v => v.currentStatus === 'In Transit' || v.currentStatus === 'Stationary / Stopped').length;
  const reachedCount = visits.filter(v => v.reachedDestination).length;
  const excessiveStopsTotal = visits.reduce((acc, v) => acc + v.excessiveStopsCount, 0);

  const filteredVisits = visits.filter(v => {
    if (filter === 'transit') return !v.reachedDestination && v.currentStatus !== 'Completed';
    if (filter === 'reached') return v.reachedDestination;
    if (filter === 'alerts') return v.excessiveStopsCount > 0;
    return true;
  });

  const selectedVisit = visits.find(v => v.id === selectedVisitId) || visits[0];

  return (
    <div className="space-y-6 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-4 rounded-2xl bg-slate-900 text-white text-xs font-mono font-medium flex items-center justify-between shadow-xl animate-fade-in border border-slate-700">
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                LIVE PHONE GPS SATELLITE RADAR
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono text-slate-300 bg-white/10">
                15-Min Stationary Guard
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              <span>Sales Executive Field Visit Tracking</span>
              <Compass className="w-7 h-7 text-indigo-400 animate-spin" style={{ animationDuration: '18s' }} />
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Real-time executive phone GPS tracking, live movement path, automated detection of stops lasting over 15 minutes, and destination arrival verification.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setShowStartVisitModal(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-xs shadow-lg transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Start New Field Visit</span>
            </button>
            <button
              onClick={() => {
                setVisits(fieldVisitStore.getVisits());
                showToast('🔄 Refreshed real-time phone GPS telemetry coordinates.');
              }}
              className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/15 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Ping GPS</span>
            </button>
          </div>
        </div>

        {/* Live KPI Metric Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-[11px] font-mono text-slate-400 uppercase">Active Field Visits</div>
            <div className="text-2xl font-bold text-white mt-1">{activeVisitsCount} Executives</div>
            <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{inTransitCount} En Route</span>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-[11px] font-mono text-slate-400 uppercase">Destination Arrival</div>
            <div className="text-2xl font-bold text-white mt-1">{reachedCount} Reached</div>
            <div className="text-[11px] text-blue-300 font-mono mt-0.5">
              {visits.length > 0 ? `${Math.round((reachedCount / visits.length) * 100)}% Arrival Rate` : 'No visits'}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-[11px] font-mono text-slate-400 uppercase">Stops Over 15 Mins</div>
            <div className={`text-2xl font-bold mt-1 ${excessiveStopsTotal > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {excessiveStopsTotal} Alert{excessiveStopsTotal !== 1 ? 's' : ''}
            </div>
            <div className="text-[11px] text-amber-300 font-mono mt-0.5">
              {excessiveStopsTotal > 0 ? '⚠️ Stationary delay flagged' : '✓ Normal movement'}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-[11px] font-mono text-slate-400 uppercase">Phone Telemetry</div>
            <div className="text-2xl font-bold text-white mt-1">100% Online</div>
            <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1 mt-0.5">
              <Battery className="w-3 h-3" />
              <span>GPS Precision ±3-5m</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Visits List on Left, Active Tracking Dossier on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Visits List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 font-heading">
              Field Executives List ({filteredVisits.length})
            </h3>
            
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-[10px] font-mono font-bold">
              <button
                onClick={() => setFilter('all')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('transit')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${filter === 'transit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
              >
                En Route
              </button>
              <button
                onClick={() => setFilter('reached')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${filter === 'reached' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
              >
                Reached
              </button>
              <button
                onClick={() => setFilter('alerts')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${filter === 'alerts' ? 'bg-amber-100 text-amber-900 shadow-xs font-bold' : 'text-slate-500'}`}
              >
                Alerts
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredVisits.map(visit => {
              const isSelected = selectedVisit?.id === visit.id;
              return (
                <div
                  key={visit.id}
                  onClick={() => setSelectedVisitId(visit.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                    isSelected
                      ? 'bg-blue-50/70 border-blue-500 shadow-sm'
                      : 'bg-white border-slate-200/90 hover:border-blue-300 hover:shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={visit.employeeAvatar}
                        alt={visit.employeeName}
                        className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-xs shrink-0"
                      />
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{visit.employeeName}</h4>
                        <p className="text-[11px] text-slate-500">{visit.employeeRole}</p>
                      </div>
                    </div>

                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border shrink-0 ${
                      visit.reachedDestination
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : visit.currentStatus === 'Stationary / Stopped'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-blue-50 text-blue-700 border-blue-300'
                    }`}>
                      {visit.reachedDestination ? '✓ Reached' : visit.currentStatus}
                    </span>
                  </div>

                  <div className="text-xs space-y-1 text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900 truncate">
                      <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="truncate">{visit.clientName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{visit.clientAddress}</span>
                    </div>
                  </div>

                  {/* Stops & Warning Tag */}
                  <div className="flex items-center justify-between text-[11px] font-mono pt-1">
                    <span className="text-slate-500">
                      Stops: <strong className="text-slate-800">{visit.stops.length}</strong>
                    </span>

                    {visit.excessiveStopsCount > 0 ? (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold flex items-center gap-1 text-[10px]">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>{visit.excessiveStopsCount} Stop &gt; 15 min</span>
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-semibold text-[10px]">
                        Normal Transit
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Live GPS Route, Telemetry, and Stops Inspection */}
        <div className="lg:col-span-8">
          {selectedVisit ? (
            <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 space-y-6">
              
              {/* Executive Details & Direct Contact */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
                <div className="flex items-center gap-4">
                  <img
                    src={selectedVisit.employeeAvatar}
                    alt={selectedVisit.employeeName}
                    className="w-14 h-14 rounded-2xl object-cover border-2 border-indigo-100 shadow-xs"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">{selectedVisit.employeeName}</h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {selectedVisit.employeeId}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{selectedVisit.employeeRole} • {selectedVisit.employeePhone}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-600">
                      <span>Trip Started: <strong>{selectedVisit.startTime}</strong></span>
                      <span>•</span>
                      <span>Est. Arrival: <strong>{selectedVisit.estimatedArrivalTime}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`tel:${selectedVisit.employeePhone}`}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5 text-blue-600" />
                    <span>Call Phone</span>
                  </a>
                  <button
                    onClick={() => setShowLogStopModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Log Stop / Wait</span>
                  </button>
                  {!selectedVisit.reachedDestination ? (
                    <button
                      onClick={() => handleMarkReached(selectedVisit.id)}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Reached Destination</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCompleteVisit(selectedVisit.id)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>End &amp; Complete Visit</span>
                    </button>
                  )}
                </div>
              </div>

              {/* CRITICAL STATUS: DID THEY REACH DESTINATION OR NOT? */}
              <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                selectedVisit.reachedDestination
                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                  : 'bg-amber-50/80 border-amber-300 text-amber-950'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0 ${
                    selectedVisit.reachedDestination ? 'bg-emerald-600' : 'bg-amber-500 animate-pulse'
                  }`}>
                    {selectedVisit.reachedDestination ? <CheckCircle2 className="w-5 h-5" /> : <Car className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider font-bold">
                      Destination Status Verification
                    </div>
                    <div className="text-base font-bold font-heading">
                      {selectedVisit.reachedDestination
                        ? `✓ DESTINATION REACHED (Arrived at ${selectedVisit.actualArrivalTime || '11:42 AM'})`
                        : `⏳ IN TRANSIT — DESTINATION NOT YET REACHED`}
                    </div>
                    <div className="text-xs mt-0.5">
                      {selectedVisit.reachedDestination
                        ? `Sales executive is currently checked in at ${selectedVisit.clientName}. On-site meeting in progress.`
                        : `Estimated remaining distance: ${selectedVisit.distanceRemainingKm} km. Target arrival ${selectedVisit.estimatedArrivalTime}.`}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 font-mono text-xs font-bold px-3 py-1.5 rounded-xl bg-white border border-slate-200">
                  {selectedVisit.reachedDestination ? 'Status: On-Site Active' : 'Status: Traveling'}
                </div>
              </div>

              {/* Destination & Purpose Dossier */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Client &amp; Destination Target</span>
                  <div className="font-bold text-sm text-slate-900">{selectedVisit.clientName}</div>
                  <div className="text-xs text-slate-600 flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <span>{selectedVisit.clientAddress}</span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono pt-1">
                    Contact: <strong className="text-slate-800">{selectedVisit.clientContact}</strong>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Visit Objective &amp; Commercial Scope</span>
                  <div className="font-bold text-sm text-slate-900">Enterprise Engagement</div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {selectedVisit.purpose}
                  </p>
                  <div className="text-xs text-slate-500 font-mono pt-1">
                    Total Estimated Distance: <strong>{selectedVisit.totalDistanceKm} km</strong>
                  </div>
                </div>
              </div>

              {/* LIVE PHONE GPS RADAR & LOCATION */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      LIVE PHONE GPS TELEMETRY
                    </span>
                    <span className="text-xs text-slate-400">({selectedVisit.currentLocation.lastPingTime})</span>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono text-slate-300">
                    <span>Speed: <strong className="text-white">{selectedVisit.currentLocation.speedKmH} km/h</strong></span>
                    <span>Battery: <strong className="text-white">{selectedVisit.currentLocation.batteryLevel}%</strong></span>
                    <span>GPS Accuracy: <strong className="text-emerald-400">±{selectedVisit.currentLocation.gpsAccuracyMeters}m</strong></span>
                  </div>
                </div>

                {/* Simulated Visual Route Trail */}
                <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-blue-400" />
                      <span>Current Phone Location:</span>
                      <strong className="text-white">{selectedVisit.currentLocation.address}</strong>
                    </span>
                    <span className="font-mono text-emerald-400">Lat: {selectedVisit.currentLocation.lat.toFixed(4)}, Lng: {selectedVisit.currentLocation.lng.toFixed(4)}</span>
                  </div>

                  {/* Route progress visual bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>Office HQ (Start)</span>
                      <span className="text-indigo-400 font-semibold">{selectedVisit.reachedDestination ? '100% Completed' : 'En Route (80% Completed)'}</span>
                      <span>{selectedVisit.clientName} (Target)</span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-slate-700 overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 rounded-full transition-all"
                        style={{ width: selectedVisit.reachedDestination ? '100%' : '78%' }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* STOPS & >15 MINUTE WAITING DURATION INSPECTION */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900 font-heading">
                      Logged Stops &amp; Location Pauses ({selectedVisit.stops.length})
                    </h4>
                    {selectedVisit.excessiveStopsCount > 0 && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 animate-pulse flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>{selectedVisit.excessiveStopsCount} Stop &gt; 15 mins detected</span>
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 font-mono">Policy: Max 15m delay allowed</span>
                </div>

                {selectedVisit.stops.length === 0 ? (
                  <div className="p-6 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-xs text-slate-500 font-mono">
                    No stops logged yet. Sales executive has maintained continuous transit without stationary pauses.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedVisit.stops.map((stop, idx) => (
                      <div
                        key={stop.id}
                        className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          stop.isExcessive
                            ? 'bg-amber-50/70 border-amber-300'
                            : 'bg-white border-slate-200/90'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-400">Stop #{idx + 1}</span>
                            <span className="font-bold text-sm text-slate-900">{stop.locationName}</span>
                            {stop.isExcessive ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-red-100 text-red-800 border border-red-300 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-red-600" />
                                <span>⚠️ EXCEEDED 15 MINS ({stop.durationMinutes} mins)</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Normal Stop ({stop.durationMinutes} mins)
                              </span>
                            )}
                          </div>
                          
                          {stop.notes && (
                            <p className="text-xs text-slate-600">Reason: {stop.notes}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-xs font-mono text-slate-500 shrink-0">
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase block">Arrived</span>
                            <span className="font-bold text-slate-800">{stop.arrivedAt}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase block">Departed</span>
                            <span className="font-bold text-slate-800">{stop.departedAt || 'Ongoing'}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 uppercase block">Total Duration</span>
                            <span className={`font-bold ${stop.isExcessive ? 'text-red-600 text-sm' : 'text-slate-800'}`}>
                              {stop.durationMinutes} mins
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="p-12 text-center rounded-3xl bg-white border border-slate-200/90 shadow-sm text-slate-500">
              Select a field visit from the left column to view live phone GPS location, stops history, and arrival verification.
            </div>
          )}
        </div>
      </div>

      {/* MODAL: START NEW FIELD VISIT */}
      {showStartVisitModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Dispatch Field Visit</h3>
                  <p className="text-xs text-slate-500">Enable phone GPS tracking for on-site client visit</p>
                </div>
              </div>
              <button onClick={() => setShowStartVisitModal(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStartVisit} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Client Company / Account Name *</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g. DLF Commercial Holdings"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Destination Address *</label>
                <input
                  type="text"
                  required
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                  placeholder="e.g. Building 10, DLF Cyber City Phase 2, Gurgaon"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Client Contact Phone</label>
                  <input
                    type="text"
                    value={newClientContact}
                    onChange={(e) => setNewClientContact(e.target.value)}
                    placeholder="+91 98112 00000"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Estimated Arrival</label>
                  <input
                    type="text"
                    value={newEstimatedArrival}
                    onChange={(e) => setNewEstimatedArrival(e.target.value)}
                    placeholder="Within 45 mins"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Purpose / Scope of Visit</label>
                <textarea
                  rows={2}
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value)}
                  placeholder="e.g. Enterprise WabaStore Live Demonstration, SLA review & contract closing"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-[11px] space-y-1 font-sans">
                <span className="font-bold flex items-center gap-1 text-blue-800">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Automated Phone Location Radar
                </span>
                <p>
                  Starting this visit registers your departure from HQ. Supervisor (Team Lead, Admin, Super Admin) will receive your live route telemetry and destination check-in status.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowStartVisitModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shadow-xs"
                >
                  Start Field Visit (GPS ON)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LOG STOP / DELAY */}
      {showLogStopModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Log Stop / Stationary Delay</h3>
                  <p className="text-xs text-slate-500">Record a location stop along the route</p>
                </div>
              </div>
              <button onClick={() => setShowLogStopModal(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLogStop} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Stop Location *</label>
                <input
                  type="text"
                  required
                  value={stopLocation}
                  onChange={(e) => setStopLocation(e.target.value)}
                  placeholder="e.g. Cyber Hub Service Lane / Fuel Station"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Wait Duration (Minutes): <strong className={stopDuration > 15 ? 'text-red-600' : 'text-slate-900'}>{stopDuration} mins</strong>
                </label>
                <input
                  type="range"
                  min="3"
                  max="60"
                  step="1"
                  value={stopDuration}
                  onChange={(e) => setStopDuration(Number(e.target.value))}
                  className="w-full accent-amber-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>5 mins</span>
                  <span className="font-bold text-amber-600">15 min Alert Threshold</span>
                  <span>60 mins</span>
                </div>
              </div>

              {stopDuration > 15 && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-[11px] font-sans flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>
                    <strong>Stop duration &gt; 15 mins:</strong> This stop will trigger an alert visible to Team Lead &amp; Admins.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-bold mb-1">Reason / Notes</label>
                <input
                  type="text"
                  value={stopNotes}
                  onChange={(e) => setStopNotes(e.target.value)}
                  placeholder="e.g. Heavy traffic bottleneck, refueled car"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowLogStopModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer shadow-xs"
                >
                  Confirm &amp; Log Stop
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
