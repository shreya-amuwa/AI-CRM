import React, { useState } from 'react';
import {
  LucideIcon,
  BookOpen, Search, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle,
  FileText, FolderUp, LifeBuoy, MessageCircle, Package, Sparkles,
  CalendarDays, ShieldCheck, ExternalLink, ChevronRight
} from 'lucide-react';
import { useShell, dashboardPath } from './shell';

interface GuideSection {
  id: string;
  title: string;
  shortTitle: string;
  icon: LucideIcon;
  description: string;
  readTime: string;
  screenshot?: { src: string; caption: string };
  actionLink?: { label: string; path: string };
  prereqs: string[];
  steps: { title: string; detail: string }[];
  statusGuide?: { badge: string; meaning: string; nextAction: string }[];
  whatHappensNext: string;
  importantNotes: string[];
}

const GUIDES: GuideSection[] = [
  {
    id: 'welcome',
    title: 'Welcome to the Amuwa Client Portal',
    shortTitle: 'Portal Overview',
    icon: BookOpen,
    description: 'Sign in to your Client Dashboard, set up your password, explore your account overview, and navigate the workspace.',
    readTime: '3 min read',
    screenshot: {
      src: '/assets/shots/client-portal-overview.png',
      caption: 'Client Dashboard Overview home screen showing active services, billing totals, and recent activity'
    },
    actionLink: { label: 'Go to Overview', path: dashboardPath('overview') },
    prereqs: [
      'Your Amuwa account manager has generated your client portal credentials.',
      'You have received the welcome or password setup email at your business email address.'
    ],
    steps: [
      {
        title: 'Sign in at /client/login',
        detail: 'Open your browser and navigate to /client/login. Enter your registered work email address and password, then click Sign in.'
      },
      {
        title: 'First-time setup via Forgot password',
        detail: 'If you have not set a password yet, click "Forgot password?" on the login page. Enter your email address to receive a secure link to /client/set-password.'
      },
      {
        title: 'Review the Overview dashboard',
        detail: 'Once signed in, the Overview screen summarizes your running services, payment balances, recent announcements, and account touches.'
      },
      {
        title: 'Navigate through the sidebar',
        detail: 'Use the left sidebar on desktop (or the top burger menu on mobile) to jump between My Services, Campaigns, Invoices, Documents, and Tickets.'
      }
    ],
    whatHappensNext: 'Your dashboard remains logged in during your session. You can return anytime to check real-time service progress, upload requested documents, or chat with your dedicated account team.',
    importantNotes: [
      'Client credentials work only on /client/login. Staff credentials work only on the main CRM portal.',
      'Passphrases must be at least 8 characters long.'
    ]
  },
  {
    id: 'services',
    title: 'Viewing Your Active Services and Campaign Usage',
    shortTitle: 'My Services & Usage',
    icon: Package,
    description: 'Inspect running communication services, monitor Meta WhatsApp and BolifyAI usage, and verify deliverable stages.',
    readTime: '4 min read',
    screenshot: {
      src: '/assets/shots/client-portal-services.png',
      caption: 'My Services workspace listing deployed solutions, live status indicators, and detailed feature breakdowns'
    },
    actionLink: { label: 'View My Services', path: dashboardPath('services') },
    prereqs: [
      'You must have at least one active or in-setup service with Amuwa Corporation.',
      'Your initial payment installment must be confirmed by the Accounts Department.'
    ],
    steps: [
      {
        title: 'Open My Services',
        detail: 'In the sidebar, click My Services (/client/dashboard/services) to view all provisioned products.'
      },
      {
        title: 'Check operational status chips',
        detail: 'Each card displays a live chip: Active (green), Setting up (amber), Paused (grey), or Completed (blue).'
      },
      {
        title: 'Click View details for technical telemetry',
        detail: 'Select View details on any service card to view WABA ID, phone numbers, API webhook status, or AI calling parameters.'
      },
      {
        title: 'Review campaign broadcast metrics',
        detail: 'Navigate to Campaigns (/client/dashboard/campaigns) to monitor delivered WhatsApp broadcasts, open rates, and replies.'
      }
    ],
    whatHappensNext: 'As your technical onboarding completes and Meta green badges or AI voice agents are provisioned, service status chips automatically transition to Active without requiring page reloads.',
    importantNotes: [
      'Official WhatsApp Business API setup typically takes 2-3 business days after Meta verification is completed.',
      'Custom telephony and AI calling features require an active voice credit balance.'
    ]
  },
  {
    id: 'invoices',
    title: 'Invoices, Receipts, and Payment Balances',
    shortTitle: 'Invoices & Receipts',
    icon: FileText,
    description: 'Download official GST-compliant tax invoices, track part-payment installments, and inspect verified receipts.',
    readTime: '3 min read',
    screenshot: {
      src: '/assets/shots/client-portal-invoices.png',
      caption: 'Invoices and Receipts screen displaying issued invoices, due dates, outstanding balances, and PDF downloads'
    },
    actionLink: { label: 'Open Invoices', path: dashboardPath('invoices') },
    prereqs: [
      'An invoice must have been generated or uploaded by the Amuwa Accounts Department.'
    ],
    steps: [
      {
        title: 'Navigate to Invoices',
        detail: 'Click Invoices in the sidebar (/client/dashboard/invoices). Review the top billing summary card showing Total Invoiced, Amount Paid, and Balance Due.'
      },
      {
        title: 'Filter by payment state',
        detail: 'Use the filter pills across the top: All, Paid, Unpaid, or Overdue.'
      },
      {
        title: 'Download official PDF statements',
        detail: 'Click the PDF download icon next to any invoice. All generated PDFs are lightweight (<500 KB) and include full HSN/SAC codes and GST breakdown.'
      },
      {
        title: 'Verify PAID watermark stamps',
        detail: 'Invoices that are fully settled automatically display an official PAID stamp on the generated receipt.'
      }
    ],
    whatHappensNext: 'When you transfer funds via NEFT/RTGS or UPI, our Accounts Department verifies the UTR number in their queue. Your balance automatically updates in real time.',
    importantNotes: [
      'For GST-exclusive agreements, GST is computed per-installment at the applicable statutory rate (standard 18%).',
      'Always retain downloaded invoice PDFs for your corporate accounting and input tax credit (ITC) filings.'
    ]
  },
  {
    id: 'documents',
    title: 'Uploading and Verifying Business Documents',
    shortTitle: 'Documents & KYC',
    icon: FolderUp,
    description: 'Submit mandatory KYC documents, GST certificates, and brand assets within authorized file limits.',
    readTime: '4 min read',
    screenshot: {
      src: '/assets/shots/client-portal-documents.png',
      caption: 'Client Documents checklist showing required business files, submission statuses, and re-upload options'
    },
    actionLink: { label: 'Open Documents', path: dashboardPath('documents') },
    prereqs: [
      'Prepare clear, legible digital copies of your corporate documents in PDF or JPEG format.',
      'Ensure the single combined PDF for All Important Documents does not exceed 2 MB.'
    ],
    steps: [
      {
        title: 'Open Documents Checklist',
        detail: 'Click Documents in the sidebar (/client/dashboard/documents). The checklist lists every required item for your purchased services.'
      },
      {
        title: 'Inspect item guidelines',
        detail: 'Review the description for each item (e.g., GST Certificate, PAN Card, Business Registration, Brand Logo, Website URL).'
      },
      {
        title: 'Upload your file',
        detail: 'Click "Upload document" or drag your file onto the drop area. The system confirms the file size and type immediately.'
      },
      {
        title: 'Track verification review',
        detail: 'Once uploaded, the status chip switches from "To provide" to "In review". Our Technical Consultant inspects the file.'
      }
    ],
    statusGuide: [
      { badge: 'To provide', meaning: 'Document has not yet been submitted.', nextAction: 'Upload the requested file.' },
      { badge: 'In review', meaning: 'File received and awaiting Technical Consultant inspection.', nextAction: 'No action required; review takes 1-2 hours.' },
      { badge: 'Verified', meaning: 'Document approved and authorized.', nextAction: 'Item complete; unlocks service activation.' },
      { badge: 'Needs your attention', meaning: 'File rejected (e.g., blurry scan or missing page).', nextAction: 'Read the consultant note and upload a replacement.' }
    ],
    whatHappensNext: 'Once all mandatory items reach Verified status, your technical setup progresses immediately to Department Head handover and delivery configuration.',
    importantNotes: [
      'File limit: Item 2 (All Important Documents) requires a single combined PDF under 2 MB (2,097,152 bytes).',
      'Uploads up to 10 MB are permitted on custom supplemental slots.'
    ]
  },
  {
    id: 'tickets',
    title: 'Raising and Tracking Support Tickets',
    shortTitle: 'Support Tickets',
    icon: LifeBuoy,
    description: 'Submit technical inquiries, report service interruptions, attach diagnostic logs, and track ticket resolution SLAs.',
    readTime: '3 min read',
    screenshot: {
      src: '/assets/shots/client-portal-tickets.png',
      caption: 'Support Tickets workspace showing active tickets, priority tags, SLA response timers, and conversation threads'
    },
    actionLink: { label: 'Go to Tickets', path: dashboardPath('tickets') },
    prereqs: [
      'Have details of the issue ready, including affected phone numbers, error messages, or screenshots.'
    ],
    steps: [
      {
        title: 'Open Tickets and click Raise a ticket',
        detail: 'In the sidebar, click Tickets (/client/dashboard/tickets), then click the gold "Raise a ticket" button.'
      },
      {
        title: 'Choose Service and Category',
        detail: 'Select the affected service from your active subscriptions (e.g., Wabastore WhatsApp API, BolifyAI Voice, Digitree Website).'
      },
      {
        title: 'Select Priority level',
        detail: 'Choose Normal (general inquiry), High (feature degradation), or Urgent (complete system downtime).'
      },
      {
        title: 'Attach files and submit',
        detail: 'You can attach up to 5 files (up to 10 MB each, such as error screenshots or logs). Click Submit Ticket.'
      }
    ],
    whatHappensNext: 'Your ticket is routed directly to the designated department support squad. You will receive an immediate acknowledgment and can reply directly in the ticket thread.',
    importantNotes: [
      'Urgent priority tickets trigger automated high-priority alerts to the on-call Technical Lead.',
      'You can reopen a resolved ticket within 7 calendar days if you need further assistance.'
    ]
  },
  {
    id: 'chat',
    title: 'Messaging Your Dedicated Account Team in Chat',
    shortTitle: 'Team Live Chat',
    icon: MessageCircle,
    description: 'Communicate directly with your assigned Relationship Manager and technical team members in real time.',
    readTime: '2 min read',
    screenshot: {
      src: '/assets/shots/shared-chat-workspace.png',
      caption: 'Direct customer communication workspace showing message history, file attachments, and delivery status'
    },
    actionLink: { label: 'Open Live Chat', path: dashboardPath('chat') },
    prereqs: [
      'An assigned Relationship Manager or Support Consultant is connected to your account.'
    ],
    steps: [
      {
        title: 'Open Chat',
        detail: 'Click Chat in the sidebar (/client/dashboard/chat) or click Live chat in the bottom phone bar.'
      },
      {
        title: 'Type and send your message',
        detail: 'Enter your inquiry in the message composer. Press Enter or click the send button to dispatch.'
      },
      {
        title: 'Share attachments',
        detail: 'Click the paperclip icon to upload sample spreadsheets, images, or briefs (up to 5 MB per file, max 5 files).'
      },
      {
        title: 'Track read receipts and unread badges',
        detail: 'The sidebar displays an unread counter badge whenever your account manager sends you an update.'
      }
    ],
    whatHappensNext: 'Messages are delivered immediately over secure realtime channels. When team members reply, notifications appear in your Notification Center.',
    importantNotes: [
      'Client chat threads are strictly private between your organization and your authorized Amuwa account team.',
      'Internal staff notes and other client conversations are never visible.'
    ]
  },
  {
    id: 'explore',
    title: 'Exploring the Services Catalog and Add-on Orders',
    shortTitle: 'Catalog & Add-ons',
    icon: Search,
    description: 'Browse available digital commerce, messaging, voice AI, and branding solutions, and submit add-on expansion requests.',
    readTime: '3 min read',
    screenshot: {
      src: '/assets/shots/client-portal-services.png',
      caption: 'Services Catalog showcasing available solutions, feature breakdowns, and Add service buttons'
    },
    actionLink: { label: 'Explore Services', path: dashboardPath('explore') },
    prereqs: [
      'Review your business requirements (e.g., additional WhatsApp numbers, voice calling minutes, website redesign).'
    ],
    steps: [
      {
        title: 'Open Explore Services',
        detail: 'Click Explore Services in the sidebar (/client/dashboard/explore) to view solutions across Wabastore, D Talk, Digitree, and Design Studio.'
      },
      {
        title: 'Compare features and capabilities',
        detail: 'Each product card outlines core capabilities, included deliverables, and compatibility.'
      },
      {
        title: 'Click Add service to request',
        detail: 'Click the blue "Add service" button on the desired card. Enter any specific notes or project requirements in the prompt.'
      },
      {
        title: 'Submit your order proposal',
        detail: 'Click Submit Request. The status badge on the card updates to "Requested / In Review".'
      }
    ],
    whatHappensNext: 'Your add-on request is routed to the Accounts Department and your Technical Consultant. Accounts prepares a transparent ADDON invoice without disrupting your existing services.',
    importantNotes: [
      'Add-on requests never block or delay your core onboarding deliverables.',
      'You can track issued add-on invoices directly under Invoices.'
    ]
  },
  {
    id: 'plans',
    title: 'Managing Monthly Retainer Plans',
    shortTitle: 'Monthly Plans',
    icon: Sparkles,
    description: 'Subscribe to recurring monthly service plans, monitor billing cycles, and adjust tier allocations.',
    readTime: '3 min read',
    actionLink: { label: 'View Monthly Plans', path: dashboardPath('plans') },
    prereqs: [
      'Your account must be in active standing with verified company KYC.'
    ],
    steps: [
      {
        title: 'Open Monthly Plans',
        detail: 'In the sidebar, click Monthly Plans (/client/dashboard/plans).'
      },
      {
        title: 'Review active subscriptions',
        detail: 'Inspect active retainer packages, recurring monthly amounts, and next renewal billing dates.'
      },
      {
        title: 'Request a plan change or upgrade',
        detail: 'Select "Request upgrade" or "Change plan" to modify your recurring allocation of messages, server hosting, or design hours.'
      },
      {
        title: 'Confirm billing adjustments',
        detail: 'Accounts reviews the adjustment and issues a revised monthly plan statement for the upcoming cycle.'
      }
    ],
    whatHappensNext: 'Monthly plan invoices are generated automatically at the start of each billing cycle and appear in your Invoices tab for prompt payment.',
    importantNotes: [
      'Retainer hours and message quotas refresh on the 1st of each calendar month unless otherwise stipulated in your contract.'
    ]
  },
  {
    id: 'profile',
    title: 'Account Profile, Security, and Password Resets',
    shortTitle: 'Profile & Security',
    icon: ShieldCheck,
    description: 'Manage your authorized business contact information, understand session protection, and reset passwords safely.',
    readTime: '2 min read',
    screenshot: {
      src: '/assets/shots/client-portal-login.png',
      caption: 'Client Portal secure sign-in and password recovery gateway'
    },
    prereqs: [
      'Access to the business email address registered to your customer profile.'
    ],
    steps: [
      {
        title: 'Review account details in top right menu',
        detail: 'Click your profile avatar in the top right header to view your legal business name, registered email, and assigned team.'
      },
      {
        title: 'Resetting your password',
        detail: 'To change your password, sign out to /client/login and click "Forgot password?". Enter your email to receive a password reset link.'
      },
      {
        title: 'Choose a strong password',
        detail: 'Create a password with at least 8 characters including letters and numbers.'
      },
      {
        title: 'Sign out safely at the end of each session',
        detail: 'Always click "Log out" in the account menu when using shared or office workstations.'
      }
    ],
    whatHappensNext: 'Your session token is invalidated immediately upon sign-out. All uploaded KYC documents and payment records remain encrypted and protected by Supabase Row-Level Security.',
    importantNotes: [
      'Never share your client portal login credentials with external agencies or unauthorized third parties.',
      'If you need to change your registered business contact email or phone number, raise a ticket with your account team.'
    ]
  },
  {
    id: 'calendar',
    title: 'Client Activity and Milestone Calendar',
    shortTitle: 'Activity Calendar',
    icon: CalendarDays,
    description: 'Track scheduled milestone check-ins, delivery updates, support follow-ups, and service renewal timelines.',
    readTime: '2 min read',
    actionLink: { label: 'Open Calendar', path: dashboardPath('calendar') },
    prereqs: [
      'Milestones and customer touchpoints are scheduled by your assigned account team.'
    ],
    steps: [
      {
        title: 'Open Calendar',
        detail: 'Click Calendar in the sidebar (/client/dashboard/calendar).'
      },
      {
        title: 'Inspect scheduled events',
        detail: 'View chronological entries for onboarding kickoff calls, technical verification milestones, and scheduled service launches.'
      },
      {
        title: 'Read milestone notes',
        detail: 'Click any entry to view discussion notes, agenda items, and contact person details recorded by your Relationship Manager.'
      }
    ],
    whatHappensNext: 'Your account manager logs notes on milestones as deliverables are completed, keeping your entire organization aligned on project progress.',
    importantNotes: [
      'The calendar is a read-only record of official milestones and meetings. To request a new meeting, send a message in Chat or raise a ticket.'
    ]
  }
];

export const Docs: React.FC = () => {
  const { go } = useShell();
  const [activeGuideId, setActiveGuideId] = useState<string>('welcome');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredGuides = searchQuery.trim()
    ? GUIDES.filter(g =>
        g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.shortTitle.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : GUIDES;

  const currentGuide = GUIDES.find(g => g.id === activeGuideId) || GUIDES[0];
  const currentIndex = GUIDES.findIndex(g => g.id === currentGuide.id);
  const prevGuide = currentIndex > 0 ? GUIDES[currentIndex - 1] : null;
  const nextGuide = currentIndex < GUIDES.length - 1 ? GUIDES[currentIndex + 1] : null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header Banner */}
      <div className="cd-card cd-manual-banner" style={{ background: '#0b4f3c', color: '#fff', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ maxWidth: 640 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(255,255,255,0.15)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
              <BookOpen size={16} /> Client User Manual & Guide
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>How to use your Client Dashboard</h1>
            <p style={{ color: 'var(--on-dark-soft)', fontSize: 15, lineHeight: 1.5 }}>
              Official guide for Amuwa clients. Learn how to track active services, download GST invoices, upload KYC documents, raise support tickets, and chat with your account team.
            </p>
          </div>
          <div className="cd-manual-search">
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search client guides..."
                style={{
                  width: '100%',
                  height: 44,
                  padding: '0 16px 0 42px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#fff',
                  color: 'var(--fg)',
                  fontSize: 14
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid: Sidebar + Active Article */}
      <div className="cd-manual-grid">
        {/* Guides Navigation List */}
        <div className="cd-card" style={{ padding: 16, borderRadius: 'var(--radius-md)' }}>
          <div style={{ padding: '8px 12px 12px', borderBottom: '1px solid var(--border-soft)', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              Client Manual Topics ({filteredGuides.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredGuides.map(guide => {
              const Icon = guide.icon;
              const isActive = guide.id === currentGuide.id;
              return (
                <button
                  key={guide.id}
                  onClick={() => setActiveGuideId(guide.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: isActive ? 'var(--green-light)' : 'transparent',
                    color: isActive ? 'var(--green-house)' : 'var(--fg)',
                    fontWeight: isActive ? 700 : 500,
                    textAlign: 'left',
                    fontSize: 14,
                    transition: 'background var(--motion-fast)'
                  }}
                >
                  <Icon size={18} style={{ flexShrink: 0, color: isActive ? 'var(--green-brand)' : 'var(--muted)' }} />
                  <span style={{ flex: 1, minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {guide.shortTitle}
                  </span>
                  {isActive && <ChevronRight size={16} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Article Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="cd-card cd-manual-article" style={{ borderRadius: 'var(--radius-md)' }}>
            {/* Guide Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--border-soft)', paddingBottom: 20, marginBottom: 24 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{currentGuide.readTime}</span>
                <h2 style={{ fontSize: 24, fontWeight: 800, marginTop: 4, marginBottom: 8, color: 'var(--fg)' }}>{currentGuide.title}</h2>
                <p style={{ color: 'var(--muted)', fontSize: 15, lineHeight: 1.5 }}>{currentGuide.description}</p>
              </div>
              {currentGuide.actionLink && (
                <button
                  className="cd-btn gold sm"
                  onClick={() => go(currentGuide.actionLink!.path)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
                >
                  <span>{currentGuide.actionLink.label}</span>
                  <ExternalLink size={15} />
                </button>
              )}
            </div>

            {/* Embedded Screenshot */}
            {currentGuide.screenshot && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#fff', boxShadow: 'var(--elev-raised)' }}>
                  <img
                    src={currentGuide.screenshot.src}
                    alt={currentGuide.screenshot.caption}
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center', fontStyle: 'italic' }}>
                  {currentGuide.screenshot.caption}
                </p>
              </div>
            )}

            {/* Prerequisites */}
            <div className="cd-banner info" style={{ marginBottom: 28, borderRadius: 'var(--radius-sm)' }}>
              <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <b style={{ display: 'block', marginBottom: 4 }}>Before you begin</b>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {currentGuide.prereqs.map((prereq, i) => (
                    <li key={i} style={{ marginTop: 2 }}>{prereq}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Step-by-Step Instructions */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Step-by-step instructions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {currentGuide.steps.map((step, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: 16,
                      padding: 16,
                      background: 'var(--surface-warm)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-soft)'
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        color: '#fff',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 700,
                        fontSize: 13,
                        flexShrink: 0
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <b style={{ display: 'block', fontSize: 15, marginBottom: 4, color: 'var(--fg)' }}>{step.title}</b>
                      <p style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Status Dictionary Table (if applicable) */}
            {currentGuide.statusGuide && (
              <div style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Status dictionary</h3>
                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <table className="cd-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Status badge</th>
                        <th>Meaning</th>
                        <th>Action required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentGuide.statusGuide.map((item, idx) => (
                        <tr key={idx}>
                          <td><b>{item.badge}</b></td>
                          <td>{item.meaning}</td>
                          <td>{item.nextAction}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* What happens next */}
            <div className="cd-card" style={{ padding: 18, background: 'var(--surface-warm)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 28 }}>
              <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: 'var(--accent)' }}>What happens next</h4>
              <p style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>{currentGuide.whatHappensNext}</p>
            </div>

            {/* Important Notes */}
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--pill-warn-fg)' }}>
                <AlertCircle size={16} />
                <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Important guidelines</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--muted)' }}>
                {currentGuide.importantNotes.map((note, idx) => (
                  <li key={idx} style={{ marginTop: 4 }}>{note}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Previous / Next Article Navigation Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            {prevGuide ? (
              <button
                className="cd-btn secondary"
                onClick={() => setActiveGuideId(prevGuide.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <ArrowLeft size={16} />
                <span>Previous: {prevGuide.shortTitle}</span>
              </button>
            ) : <div />}

            {nextGuide ? (
              <button
                className="cd-btn secondary"
                onClick={() => setActiveGuideId(nextGuide.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <span>Next: {nextGuide.shortTitle}</span>
                <ArrowRight size={16} />
              </button>
            ) : <div />}
          </div>
        </div>
      </div>
    </div>
  );
};
