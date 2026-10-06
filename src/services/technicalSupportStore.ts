/**
 * ==============================================================================
 * WABASTORE SUPPORT - TECHNICAL SUPPORT STORE
 * ==============================================================================
 * Stores real-time Leads, Potential Contacts (Payment Pending), and Customers (Paid)
 * for the Technical Support team member dashboard. Zero dummy data by default.
 */

export interface TechSupportLead {
  id: string;
  name: string;
  businessName: string;
  services: string[];
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
  status: 'New' | 'In Discussion' | 'Technical Review';
}

export interface TechSupportContact {
  id: string;
  leadId?: string;
  name: string;
  businessName: string;
  services: string[];
  phone?: string;
  email?: string;
  paymentStatus: 'Payment Pending';
  expectedAmount?: number;
  contactedAt: string;
  notes?: string;
}

export interface TechSupportCustomer {
  id: string;
  contactId?: string;
  leadId?: string;
  name: string;
  businessName: string;
  services: string[];
  phone?: string;
  email?: string;
  paymentStatus: 'Paid';
  paymentAmount?: number;
  paymentMode?: string;
  convertedAt: string;
  notes?: string;
}

interface TechSupportData {
  leads: TechSupportLead[];
  contacts: TechSupportContact[];
  customers: TechSupportCustomer[];
}

const STORAGE_KEY = 'wabastore_tech_support_data_v1';

class TechnicalSupportStore {
  private data: TechSupportData;

  constructor() {
    this.data = this.load();
  }

  private load(): TechSupportData {
    if (typeof window === 'undefined') {
      return { leads: [], contacts: [], customers: [] };
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          leads: Array.isArray(parsed.leads) ? parsed.leads : [],
          contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
          customers: Array.isArray(parsed.customers) ? parsed.customers : []
        };
      }
    } catch (e) {
      console.warn('Failed to parse TechnicalSupportStore data:', e);
    }
    // STRICTLY ZERO DUMMY DATA by requirement
    return { leads: [], contacts: [], customers: [] };
  }

  private save(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      window.dispatchEvent(new CustomEvent('tech_support_data_changed', { detail: this.data }));
    } catch (e) {
      console.error('Failed to save TechnicalSupportStore data:', e);
    }
  }

  public getLeads(): TechSupportLead[] {
    return [...this.data.leads];
  }

  public getContacts(): TechSupportContact[] {
    return [...this.data.contacts];
  }

  public getCustomers(): TechSupportCustomer[] {
    return [...this.data.customers];
  }

  /**
   * Manually add a new lead
   */
  public addLead(lead: {
    name: string;
    businessName: string;
    services: string[];
    phone?: string;
    email?: string;
    notes?: string;
  }): TechSupportLead {
    const newLead: TechSupportLead = {
      id: `LEAD-TS-${Date.now().toString().slice(-6)}`,
      name: lead.name.trim(),
      businessName: lead.businessName.trim(),
      services: lead.services.length > 0 ? lead.services : ['Technical Support'],
      phone: lead.phone?.trim() || '',
      email: lead.email?.trim() || '',
      notes: lead.notes?.trim() || '',
      createdAt: new Date().toISOString(),
      status: 'New'
    };

    this.data.leads.unshift(newLead);
    this.save();
    return newLead;
  }

  /**
   * Move lead into Contact (Potential Customer - Payment Not Done Yet)
   */
  public convertToContact(leadId: string, expectedAmount?: number): TechSupportContact | null {
    const leadIdx = this.data.leads.findIndex(l => l.id === leadId);
    if (leadIdx === -1) return null;

    const lead = this.data.leads[leadIdx];
    this.data.leads.splice(leadIdx, 1);

    const newContact: TechSupportContact = {
      id: `CONT-TS-${Date.now().toString().slice(-6)}`,
      leadId: lead.id,
      name: lead.name,
      businessName: lead.businessName,
      services: lead.services,
      phone: lead.phone,
      email: lead.email,
      paymentStatus: 'Payment Pending',
      expectedAmount: expectedAmount || 0,
      contactedAt: new Date().toISOString(),
      notes: lead.notes
    };

    this.data.contacts.unshift(newContact);
    this.save();
    return newContact;
  }

  /**
   * Convert directly from Lead into Customer (Payment Done)
   */
  public convertToCustomerFromLead(
    leadId: string,
    paymentAmount?: number,
    paymentMode?: string
  ): TechSupportCustomer | null {
    const leadIdx = this.data.leads.findIndex(l => l.id === leadId);
    if (leadIdx === -1) return null;

    const lead = this.data.leads[leadIdx];
    this.data.leads.splice(leadIdx, 1);

    const newCustomer: TechSupportCustomer = {
      id: `CUST-TS-${Date.now().toString().slice(-6)}`,
      leadId: lead.id,
      name: lead.name,
      businessName: lead.businessName,
      services: lead.services,
      phone: lead.phone,
      email: lead.email,
      paymentStatus: 'Paid',
      paymentAmount: paymentAmount || 0,
      paymentMode: paymentMode || 'UPI / Bank Transfer',
      convertedAt: new Date().toISOString(),
      notes: lead.notes
    };

    this.data.customers.unshift(newCustomer);
    this.save();
    return newCustomer;
  }

  /**
   * Convert from Contact (Potential Customer) into Customer (Payment Done)
   */
  public convertToCustomerFromContact(
    contactId: string,
    paymentAmount?: number,
    paymentMode?: string
  ): TechSupportCustomer | null {
    const contactIdx = this.data.contacts.findIndex(c => c.id === contactId);
    if (contactIdx === -1) return null;

    const contact = this.data.contacts[contactIdx];
    this.data.contacts.splice(contactIdx, 1);

    const newCustomer: TechSupportCustomer = {
      id: `CUST-TS-${Date.now().toString().slice(-6)}`,
      contactId: contact.id,
      leadId: contact.leadId,
      name: contact.name,
      businessName: contact.businessName,
      services: contact.services,
      phone: contact.phone,
      email: contact.email,
      paymentStatus: 'Paid',
      paymentAmount: paymentAmount !== undefined ? paymentAmount : (contact.expectedAmount || 0),
      paymentMode: paymentMode || 'UPI / Bank Transfer',
      convertedAt: new Date().toISOString(),
      notes: contact.notes
    };

    this.data.customers.unshift(newCustomer);
    this.save();
    return newCustomer;
  }

  public deleteLead(id: string): void {
    this.data.leads = this.data.leads.filter(l => l.id !== id);
    this.save();
  }

  public deleteContact(id: string): void {
    this.data.contacts = this.data.contacts.filter(c => c.id !== id);
    this.save();
  }

  public deleteCustomer(id: string): void {
    this.data.customers = this.data.customers.filter(c => c.id !== id);
    this.save();
  }

  public clearAll(): void {
    this.data = { leads: [], contacts: [], customers: [] };
    this.save();
  }
}

export const technicalSupportStore = new TechnicalSupportStore();
