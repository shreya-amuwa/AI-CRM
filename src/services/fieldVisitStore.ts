export interface FieldVisitStop {
  id: string;
  locationName: string;
  arrivedAt: string;
  departedAt?: string | null;
  durationMinutes: number;
  isExcessive: boolean; // true if durationMinutes > 15
  notes?: string;
}

export interface FieldVisit {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  employeePhone: string;
  employeeAvatar: string;
  clientName: string;
  clientAddress: string;
  clientContact: string;
  purpose: string;
  startTime: string;
  estimatedArrivalTime: string;
  actualArrivalTime?: string | null;
  currentStatus: 'In Transit' | 'Destination Reached' | 'At Client Site' | 'Stationary / Stopped' | 'Completed';
  reachedDestination: boolean;
  currentLocation: {
    address: string;
    lat: number;
    lng: number;
    speedKmH: number;
    batteryLevel: number;
    lastPingTime: string;
    gpsAccuracyMeters: number;
  };
  totalDistanceKm: number;
  distanceRemainingKm: number;
  stops: FieldVisitStop[];
  excessiveStopsCount: number; // count of stops > 15 min
  createdAt: string;
}

const STORAGE_KEY = 'unified_crm_field_visits';

const INITIAL_FIELD_VISITS: FieldVisit[] = [
  {
    id: 'FV-101',
    employeeId: 'tm-priya',
    employeeName: 'Priya Nair',
    employeeRole: 'Senior Sales Executive',
    employeePhone: '+91 98765 43210',
    employeeAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    clientName: 'TechCorp India Solutions',
    clientAddress: 'Tower B, 7th Floor, DLF Cyber City, Phase 2, Gurgaon',
    clientContact: 'Rajeev Malhotra (+91 98112 34567)',
    purpose: 'Enterprise WabaStore Product Demo & SLA Agreement Signing',
    startTime: '10:15 AM',
    estimatedArrivalTime: '11:25 AM',
    actualArrivalTime: null,
    currentStatus: 'In Transit',
    reachedDestination: false,
    currentLocation: {
      address: 'MG Road Junction, Sector 28, Gurgaon',
      lat: 28.4795,
      lng: 77.0869,
      speedKmH: 28,
      batteryLevel: 79,
      lastPingTime: '15 seconds ago',
      gpsAccuracyMeters: 4
    },
    totalDistanceKm: 16.5,
    distanceRemainingKm: 3.2,
    stops: [
      {
        id: 'STP-1',
        locationName: 'HP Petrol Pump & Fastag Toll, NH-48',
        arrivedAt: '10:32 AM',
        departedAt: '10:40 AM',
        durationMinutes: 8,
        isExcessive: false,
        notes: 'Refueling & Fastag tag scan'
      },
      {
        id: 'STP-2',
        locationName: 'Cyber Hub Service Road Junction',
        arrivedAt: '10:46 AM',
        departedAt: '11:09 AM',
        durationMinutes: 23,
        isExcessive: true,
        notes: 'Heavy bottleneck traffic & roadside waiting'
      }
    ],
    excessiveStopsCount: 1,
    createdAt: new Date().toISOString()
  },
  {
    id: 'FV-102',
    employeeId: 'tm-rahul',
    employeeName: 'Rahul Kumar',
    employeeRole: 'Account Executive - Sales',
    employeePhone: '+91 98123 45678',
    employeeAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    clientName: 'FinEdge Capital Advisors',
    clientAddress: 'Worldmark 1, Aerocity, New Delhi',
    clientContact: 'Sunita Mehra (+91 99555 12345)',
    purpose: 'Quarterly Commercial Review & Enterprise Upsell',
    startTime: '09:00 AM',
    estimatedArrivalTime: '09:45 AM',
    actualArrivalTime: '09:42 AM',
    currentStatus: 'Destination Reached',
    reachedDestination: true,
    currentLocation: {
      address: 'Worldmark 1 Visitor Reception, Aerocity, New Delhi',
      lat: 28.5529,
      lng: 77.1215,
      speedKmH: 0,
      batteryLevel: 91,
      lastPingTime: '2 minutes ago',
      gpsAccuracyMeters: 3
    },
    totalDistanceKm: 12.8,
    distanceRemainingKm: 0,
    stops: [
      {
        id: 'STP-3',
        locationName: 'Aerocity Security Checkpoint & Parking Entry',
        arrivedAt: '09:35 AM',
        departedAt: '09:42 AM',
        durationMinutes: 7,
        isExcessive: false,
        notes: 'Security badge verification & parking'
      }
    ],
    excessiveStopsCount: 0,
    createdAt: new Date().toISOString()
  }
];

class FieldVisitStore {
  private visits: FieldVisit[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.visits = JSON.parse(data);
      } else {
        this.visits = INITIAL_FIELD_VISITS;
        this.saveToStorage();
      }
    } catch {
      this.visits = INITIAL_FIELD_VISITS;
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.visits));
    } catch (e) {
      console.warn('[FieldVisitStore] Failed to save to localStorage:', e);
    }
    this.notify();
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
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

  public startVisit(data: {
    employeeId: string;
    employeeName: string;
    employeeRole: string;
    employeePhone?: string;
    employeeAvatar?: string;
    clientName: string;
    clientAddress: string;
    clientContact: string;
    purpose: string;
    estimatedArrivalTime?: string;
  }): FieldVisit {
    const newVisit: FieldVisit = {
      id: `FV-${Date.now().toString().slice(-4)}`,
      employeeId: data.employeeId,
      employeeName: data.employeeName,
      employeeRole: data.employeeRole || 'Sales Executive',
      employeePhone: data.employeePhone || '+91 98765 00000',
      employeeAvatar: data.employeeAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      clientName: data.clientName,
      clientAddress: data.clientAddress,
      clientContact: data.clientContact,
      purpose: data.purpose,
      startTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      estimatedArrivalTime: data.estimatedArrivalTime || 'Within 45 mins',
      actualArrivalTime: null,
      currentStatus: 'In Transit',
      reachedDestination: false,
      currentLocation: {
        address: 'Starting from Corporate Office',
        lat: 28.4595,
        lng: 77.0266,
        speedKmH: 22,
        batteryLevel: 98,
        lastPingTime: 'Just now',
        gpsAccuracyMeters: 5
      },
      totalDistanceKm: 14.0,
      distanceRemainingKm: 14.0,
      stops: [],
      excessiveStopsCount: 0,
      createdAt: new Date().toISOString()
    };

    this.visits = [newVisit, ...this.visits];
    this.saveToStorage();
    return newVisit;
  }

  public markDestinationReached(visitId: string, arrivalTime?: string): void {
    const time = arrivalTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.visits = this.visits.map(v => {
      if (v.id === visitId) {
        return {
          ...v,
          reachedDestination: true,
          actualArrivalTime: time,
          currentStatus: 'Destination Reached',
          distanceRemainingKm: 0,
          currentLocation: {
            ...v.currentLocation,
            address: `At Destination: ${v.clientName} (${v.clientAddress})`,
            speedKmH: 0,
            lastPingTime: 'Just now'
          }
        };
      }
      return v;
    });
    this.saveToStorage();
  }

  public logStop(visitId: string, stop: { locationName: string; durationMinutes: number; notes?: string }): void {
    this.visits = this.visits.map(v => {
      if (v.id === visitId) {
        const isExcessive = stop.durationMinutes > 15;
        const newStop: FieldVisitStop = {
          id: `STP-${Date.now().toString().slice(-4)}`,
          locationName: stop.locationName,
          arrivedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          departedAt: null,
          durationMinutes: stop.durationMinutes,
          isExcessive,
          notes: stop.notes
        };
        const updatedStops = [...v.stops, newStop];
        const excessiveCount = updatedStops.filter(s => s.isExcessive).length;
        return {
          ...v,
          stops: updatedStops,
          excessiveStopsCount: excessiveCount,
          currentStatus: isExcessive ? 'Stationary / Stopped' : v.currentStatus,
          currentLocation: {
            ...v.currentLocation,
            address: stop.locationName,
            speedKmH: 0,
            lastPingTime: 'Just now'
          }
        };
      }
      return v;
    });
    this.saveToStorage();
  }

  public completeVisit(visitId: string): void {
    this.visits = this.visits.map(v => {
      if (v.id === visitId) {
        return {
          ...v,
          currentStatus: 'Completed',
          distanceRemainingKm: 0
        };
      }
      return v;
    });
    this.saveToStorage();
  }
}

export const fieldVisitStore = new FieldVisitStore();
