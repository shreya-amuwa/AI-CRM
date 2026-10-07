import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabaseClient';

/**
 * Field visits are stored in Supabase (`field_visits`, see migration
 * 20261007000200_member_workspace.sql), so they are the same on every device
 * and visible to the executive's team head / department head.
 *
 * Location is the phone's real position from the browser Geolocation API,
 * captured when a visit starts, when the executive taps "Update location",
 * arrives, or logs a stop. Nothing is simulated.
 */

export interface FieldVisitStop {
  id: string;
  locationName: string;
  arrivedAt: string;
  departedAt?: string | null;
  durationMinutes: number;
  isExcessive: boolean; // true if durationMinutes > 15
  notes?: string;
}

export interface FieldVisitLocation {
  lat: number;
  lng: number;
  accuracyMeters: number;
  capturedAt: string; // ISO
}

export interface FieldVisit {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  employeePhone: string;
  clientName: string;
  clientAddress: string;
  clientContact: string;
  purpose: string;
  startTime: string;
  estimatedArrivalTime: string;
  actualArrivalTime?: string | null;
  currentStatus: 'In Transit' | 'Destination Reached' | 'At Client Site' | 'Stationary / Stopped' | 'Completed';
  reachedDestination: boolean;
  currentLocation: FieldVisitLocation | null;
  locationError?: string | null;
  stops: FieldVisitStop[];
  excessiveStopsCount: number; // count of stops > 15 min
  createdAt: string;
}

type Details = Omit<FieldVisit, 'id' | 'employeeId' | 'currentStatus' | 'createdAt'>;

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Reads the device's current position; resolves to null when unavailable or denied. */
export function captureLocation(): Promise<{ location: FieldVisitLocation | null; error: string | null }> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ location: null, error: 'Location is not available on this device.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos =>
        resolve({
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyMeters: Math.round(pos.coords.accuracy),
            capturedAt: new Date().toISOString()
          },
          error: null
        }),
      err =>
        resolve({
          location: null,
          error: err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' : 'Could not read the location.'
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function toVisit(row: Record<string, any>): FieldVisit {
  const d = row.details || {};
  return {
    employeeName: '',
    employeeRole: '',
    employeePhone: '',
    clientName: '',
    clientAddress: '',
    clientContact: '',
    purpose: '',
    startTime: '',
    estimatedArrivalTime: '',
    actualArrivalTime: null,
    reachedDestination: false,
    currentLocation: null,
    stops: [],
    excessiveStopsCount: 0,
    ...d,
    id: row.id,
    employeeId: row.owner_id,
    currentStatus: row.status,
    createdAt: row.created_at
  };
}

class FieldVisitStore {
  private visits: FieldVisit[] = [];
  private listeners = new Set<() => void>();
  private channel: RealtimeChannel | null = null;
  private connected = false;
  public lastError: string | null = null;

  /** Subscribing loads the visits and keeps them live while anyone listens. */
  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (!this.connected) void this.connect();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  private async connect() {
    const supabase = getSupabase();
    if (!supabase) return;
    this.connected = true;
    await this.reload();
    if (!this.connected || this.channel) return; // unsubscribed or connected meanwhile
    this.channel = supabase
      .channel('field-visits')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'field_visits' }, () => void this.reload())
      .subscribe();
  }

  private disconnect() {
    const supabase = getSupabase();
    if (this.channel && supabase) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.connected = false;
    this.visits = [];
  }

  private async reload() {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('field_visits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      this.lastError = error.message;
      console.error('[fieldVisitStore] load failed:', error.message);
      return;
    }
    this.visits = (data || []).map(toVisit);
    this.notify();
  }

  private db() {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Not connected to the CRM database.');
    return supabase;
  }

  private async save(visit: FieldVisit) {
    const { id, employeeId, currentStatus, createdAt, ...details } = visit;
    const { error } = await this.db().from('field_visits').update({ status: currentStatus, details }).eq('id', id);
    if (error) throw new Error(error.message);
    await this.reload();
  }

  private async update(visitId: string, change: (v: FieldVisit) => FieldVisit) {
    const visit = this.visits.find(v => v.id === visitId);
    if (!visit) throw new Error('Visit not found.');
    await this.save(change(visit));
  }

  public getVisits(): FieldVisit[] {
    return [...this.visits];
  }

  public getVisitById(id: string): FieldVisit | undefined {
    return this.visits.find(v => v.id === id);
  }

  public getActiveVisitForEmployee(employeeId: string): FieldVisit | undefined {
    return this.visits.find(v => v.employeeId === employeeId && v.currentStatus !== 'Completed');
  }

  public async startVisit(data: {
    employeeName: string;
    employeeRole: string;
    employeePhone?: string;
    clientName: string;
    clientAddress: string;
    clientContact: string;
    purpose: string;
    estimatedArrivalTime?: string;
  }): Promise<FieldVisit> {
    const { location, error: locationError } = await captureLocation();
    const details: Details = {
      employeeName: data.employeeName,
      employeeRole: data.employeeRole,
      employeePhone: data.employeePhone || '',
      clientName: data.clientName,
      clientAddress: data.clientAddress,
      clientContact: data.clientContact,
      purpose: data.purpose,
      startTime: nowTime(),
      estimatedArrivalTime: data.estimatedArrivalTime || '',
      actualArrivalTime: null,
      reachedDestination: false,
      currentLocation: location,
      locationError,
      stops: [],
      excessiveStopsCount: 0
    };
    const { data: row, error } = await this.db()
      .from('field_visits')
      .insert({ status: 'In Transit', details })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await this.reload();
    return toVisit(row);
  }

  /** Records the phone's current position on the visit. */
  public async pingLocation(visitId: string): Promise<string | null> {
    const { location, error } = await captureLocation();
    await this.update(visitId, v => ({ ...v, currentLocation: location || v.currentLocation, locationError: error }));
    return error;
  }

  public async markDestinationReached(visitId: string): Promise<void> {
    const { location, error } = await captureLocation();
    await this.update(visitId, v => ({
      ...v,
      reachedDestination: true,
      actualArrivalTime: nowTime(),
      currentStatus: 'Destination Reached',
      currentLocation: location || v.currentLocation,
      locationError: error
    }));
  }

  public async logStop(visitId: string, stop: { locationName: string; durationMinutes: number; notes?: string }): Promise<void> {
    const { location, error } = await captureLocation();
    await this.update(visitId, v => {
      const isExcessive = stop.durationMinutes > 15;
      const stops: FieldVisitStop[] = [
        ...v.stops,
        {
          id: `STP-${Date.now()}`,
          locationName: stop.locationName,
          arrivedAt: nowTime(),
          departedAt: null,
          durationMinutes: stop.durationMinutes,
          isExcessive,
          notes: stop.notes
        }
      ];
      return {
        ...v,
        stops,
        excessiveStopsCount: stops.filter(s => s.isExcessive).length,
        currentStatus: isExcessive ? 'Stationary / Stopped' : v.currentStatus,
        currentLocation: location || v.currentLocation,
        locationError: error
      };
    });
  }

  public async completeVisit(visitId: string): Promise<void> {
    await this.update(visitId, v => ({ ...v, currentStatus: 'Completed' }));
  }
}

export const fieldVisitStore = new FieldVisitStore();
