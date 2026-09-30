import React, { useState } from 'react';
import {
  LifeBuoy, Search, Filter, MessageSquare, Mail, Phone, Globe,
  AlertCircle, CheckCircle2, Clock, ShieldAlert, Eye, X, Send,
  User, ChevronRight, ArrowUpDown, Tag, Check, ArrowRight
} from 'lucide-react';

export interface SupportTicket {
  id: string;
  customer: string;
  company: string;
  tier: 'Enterprise' | 'Premium' | 'Growth' | 'Standard';
  subject: string;
  category: 'Meta Templates' | 'API & Webhooks' | 'Catalog Sync' | 'Payments' | 'User Access';
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'New' | 'Open' | 'Pending' | 'Escalated' | 'Resolved';
  channel: 'WhatsApp' | 'Email' | 'Portal' | 'Phone';
  assignedTo: string;
  createdAt: string;
  lastUpdated: string;
  firstResponseTime: string;
  slaBreach: boolean;
  messages: { sender: string; time: string; text: string; isAgent: boolean }[];
}

export const INITIAL_SUPPORT_TICKETS: SupportTicket[] = [
  {
    id: 'TICK-801',
    customer: 'Rajesh Mehta',
    company: 'Mehta Traders',
    tier: 'Enterprise',
    subject: 'Meta WhatsApp Template 504 Gateway Timeout on Bulk Campaign',
    category: 'Meta Templates',
    priority: 'Critical',
    status: 'Open',
    channel: 'WhatsApp',
    assignedTo: 'Neha Kulkarni',
    createdAt: 'Today, 09:15 AM',
    lastUpdated: '12m ago',
    firstResponseTime: '8m',
    slaBreach: false,
    messages: [
      { sender: 'Rajesh Mehta', time: '09:15 AM', text: 'Our festive promotional template campaign failed with 504 Gateway Timeout. 4,500 messages are blocked!', isAgent: false },
      { sender: 'Neha Kulkarni', time: '09:23 AM', text: 'Hello Rajesh, checking the Meta Graph API response logs right now. Isolating rate limit threshold.', isAgent: true }
    ]
  },
  {
    id: 'TICK-802',
    customer: 'Sneha Patil',
    company: 'Patil Enterprises',
    tier: 'Enterprise',
    subject: 'Inventory Catalog webhook sync mismatch on 12 SKU variants',
    category: 'Catalog Sync',
    priority: 'Critical',
    status: 'Escalated',
    channel: 'WhatsApp',
    assignedTo: 'Aakash Singhal',
    createdAt: 'Today, 08:30 AM',
    lastUpdated: '22m ago',
    firstResponseTime: '11m',
    slaBreach: true,
    messages: [
      { sender: 'Sneha Patil', time: '08:30 AM', text: 'Our wholesale inventory in WabaStore shows 0 units for 12 top selling apparel items!', isAgent: false },
      { sender: 'Aakash Singhal', time: '08:41 AM', text: 'Checking the webhook ingestion logs. Tier-2 engineering has been paged to re-run the payload parser.', isAgent: true }
    ]
  },
  {
    id: 'TICK-803',
    customer: 'Amit Joshi',
    company: 'NextGen Living',
    tier: 'Corporate' as any,
    subject: 'Razorpay webhook confirmation not triggering order confirmation SMS',
    category: 'Payments',
    priority: 'High',
    status: 'Open',
    channel: 'Email',
    assignedTo: 'Kavita Roy',
    createdAt: 'Today, 09:45 AM',
    lastUpdated: '15m ago',
    firstResponseTime: '9m',
    slaBreach: false,
    messages: [
      { sender: 'Amit Joshi', time: '09:45 AM', text: 'Payment was captured in Razorpay but customer did not receive the WhatsApp confirmation message.', isAgent: false }
    ]
  },
  {
    id: 'TICK-804',
    customer: 'Isha Verma',
    company: 'Fashion House',
    tier: 'Premium',
    subject: 'Request to add 3 new telecaller agents to WabaStore Support Desk',
    category: 'User Access',
    priority: 'Medium',
    status: 'New',
    channel: 'Portal',
    assignedTo: 'Unassigned',
    createdAt: 'Today, 10:10 AM',
    lastUpdated: '5m ago',
    firstResponseTime: 'Pending',
    slaBreach: false,
    messages: [
      { sender: 'Isha Verma', time: '10:10 AM', text: 'Please add rohit@fashionhouse.com, sunita@fashionhouse.com as agents with tier-1 permissions.', isAgent: false }
    ]
  },
  {
    id: 'TICK-805',
    customer: 'Vikram Malhotra',
    company: 'Zenith Retail Chain',
    tier: 'Enterprise',
    subject: 'Inbound Webhook payload signature verification failing (HMAC-SHA256)',
    category: 'API & Webhooks',
    priority: 'Critical',
    status: 'Escalated',
    channel: 'WhatsApp',
    assignedTo: 'Neha Kulkarni',
    createdAt: 'Today, 07:50 AM',
    lastUpdated: '35m ago',
    firstResponseTime: '7m',
    slaBreach: true,
    messages: [
      { sender: 'Vikram Malhotra', time: '07:50 AM', text: 'Our webhook receiver is dropping payloads due to HMAC signature validation failure.', isAgent: false }
    ]
  },
  {
    id: 'TICK-806',
    customer: 'Pooja Singhania',
    company: 'Singhania Textiles',
    tier: 'Premium',
    subject: 'How to configure automated out-of-office autoreply for Sunday night shifts',
    category: 'Meta Templates',
    priority: 'Low',
    status: 'Pending',
    channel: 'WhatsApp',
    assignedTo: 'Manish Sharma',
    createdAt: 'Today, 09:00 AM',
    lastUpdated: '40m ago',
    firstResponseTime: '12m',
    slaBreach: false,
    messages: [
      { sender: 'Pooja Singhania', time: '09:00 AM', text: 'Can we schedule autoreplies between 8 PM and 8 AM daily on WhatsApp Business API?', isAgent: false },
      { sender: 'Manish Sharma', time: '09:12 AM', text: 'Yes, I have sent you the automation workflow guide. Awaiting your test confirmation.', isAgent: true }
    ]
  },
  {
    id: 'TICK-807',
    customer: 'Deepak Deshmukh',
    company: 'Deshmukh Agro',
    tier: 'Growth',
    subject: 'Catalog image resolution requirements for WhatsApp Carousel template',
    category: 'Catalog Sync',
    priority: 'Low',
    status: 'Resolved',
    channel: 'Phone',
    assignedTo: 'Pooja Nair',
    createdAt: 'Yesterday, 04:30 PM',
    lastUpdated: 'Today, 08:00 AM',
    firstResponseTime: '5m',
    slaBreach: false,
    messages: [
      { sender: 'Deepak Deshmukh', time: '04:30 PM', text: 'Images look cropped on mobile devices in the catalog carousel.', isAgent: false },
      { sender: 'Pooja Nair', time: '04:35 PM', text: 'Guided client to use 1080x1080 1:1 aspect ratio PNGs. Client verified fix.', isAgent: true }
    ]
  },
  {
    id: 'TICK-808',
    customer: 'Karan Mehra',
    company: 'Urban Crafts Studio',
    tier: 'Standard',
    subject: 'Need assistance setting up QR code deep links for offline pop-up store',
    category: 'API & Webhooks',
    priority: 'Medium',
    status: 'Open',
    channel: 'Portal',
    assignedTo: 'Ritu Sen',
    createdAt: 'Today, 08:45 AM',
    lastUpdated: '1h ago',
    firstResponseTime: '14m',
    slaBreach: false,
    messages: [
      { sender: 'Karan Mehra', time: '08:45 AM', text: 'We need 5 distinct QR codes for our retail booths in Mumbai mall.', isAgent: false }
    ]
  },
  {
    id: 'TICK-809',
    customer: 'Anil Agarwal',
    company: 'FreshRoot Organics',
    tier: 'Premium',
    subject: 'Delivery notification template rejected by Meta due to promotional wording',
    category: 'Meta Templates',
    priority: 'High',
    status: 'Pending',
    channel: 'WhatsApp',
    assignedTo: 'Deepak Verma',
    createdAt: 'Today, 09:20 AM',
    lastUpdated: '25m ago',
    firstResponseTime: '10m',
    slaBreach: false,
    messages: [
      { sender: 'Anil Agarwal', time: '09:20 AM', text: 'Meta rejected our UTILITY template saying it contains MARKETING content.', isAgent: false }
    ]
  },
  {
    id: 'TICK-810',
    customer: 'Naveen Reddy',
    company: 'Kuber Logistics Hub',
    tier: 'Enterprise',
    subject: 'High webhook latency on tracking updates during peak hours (12PM - 3PM)',
    category: 'API & Webhooks',
    priority: 'High',
    status: 'Open',
    channel: 'Email',
    assignedTo: 'Aakash Singhal',
    createdAt: 'Today, 09:35 AM',
    lastUpdated: '18m ago',
    firstResponseTime: '11m',
    slaBreach: false,
    messages: [
      { sender: 'Naveen Reddy', time: '09:35 AM', text: 'Webhook ingestion pings take >1.8s during peak hours.', isAgent: false }
    ]
  },
  {
    id: 'TICK-811',
    customer: 'Divya Sharma',
    company: 'Nova Digital Agency',
    tier: 'Standard',
    subject: 'Reset 2FA authentication for support agent account (lost phone)',
    category: 'User Access',
    priority: 'Medium',
    status: 'New',
    channel: 'Email',
    assignedTo: 'Unassigned',
    createdAt: 'Today, 10:15 AM',
    lastUpdated: '2m ago',
    firstResponseTime: 'Pending',
    slaBreach: false,
    messages: [
      { sender: 'Divya Sharma', time: '10:15 AM', text: 'Please reset 2FA for agent divya@novadigital.in after verifying identity.', isAgent: false }
    ]
  },
  {
    id: 'TICK-812',
    customer: 'Gaurav Kothari',
    company: 'Apex Auto Spares',
    tier: 'Growth',
    subject: 'Cashfree webhook payload JSON formatting parsing error',
    category: 'Payments',
    priority: 'High',
    status: 'Open',
    channel: 'Portal',
    assignedTo: 'Siddharth Jain',
    createdAt: 'Today, 08:10 AM',
    lastUpdated: '45m ago',
    firstResponseTime: '16m',
    slaBreach: false,
    messages: [
      { sender: 'Gaurav Kothari', time: '08:10 AM', text: 'Receiving 400 Bad Request on payment status callback payload.', isAgent: false }
    ]
  }
];

export const SupportHeadTicketsView: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>(INITIAL_SUPPORT_TICKETS);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'New' | 'Open' | 'Pending' | 'Escalated' | 'Resolved'>('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [channelFilter, setChannelFilter] = useState('All');
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = useState('');

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;
    if (channelFilter !== 'All' && t.channel !== channelFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        t.id.toLowerCase().includes(q) ||
        t.customer.toLowerCase().includes(q) ||
        t.company.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case 'Critical':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Critical</span>;
      case 'High':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">High</span>;
      case 'Medium':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Medium</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">Low</span>;
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'New':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">New</span>;
      case 'Open':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">Open</span>;
      case 'Pending':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">Pending</span>;
      case 'Escalated':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">Escalated</span>;
      case 'Resolved':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Resolved</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">{s}</span>;
    }
  };

  const getChannelIcon = (c: string) => {
    switch (c) {
      case 'WhatsApp':
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />;
      case 'Email':
        return <Mail className="w-3.5 h-3.5 text-blue-600" />;
      case 'Phone':
        return <Phone className="w-3.5 h-3.5 text-amber-600" />;
      default:
        return <Globe className="w-3.5 h-3.5 text-purple-600" />;
    }
  };

  const handleSendReply = () => {
    if (!replyText.trim() || !selectedTicket) return;
    const newMsg = {
      sender: 'Department Head',
      time: 'Just now',
      text: replyText,
      isAgent: true
    };
    const updated = tickets.map(t => {
      if (t.id === selectedTicket.id) {
        return {
          ...t,
          status: 'Open' as const,
          lastUpdated: 'Just now',
          messages: [...t.messages, newMsg]
        };
      }
      return t;
    });
    setTickets(updated);
    setSelectedTicket({
      ...selectedTicket,
      status: 'Open',
      lastUpdated: 'Just now',
      messages: [...selectedTicket.messages, newMsg]
    });
    setReplyText('');
  };

  const handleResolveTicket = (ticketId: string) => {
    const updated = tickets.map(t => {
      if (t.id === ticketId) {
        return { ...t, status: 'Resolved' as const, lastUpdated: 'Just now' };
      }
      return t;
    });
    setTickets(updated);
    if (selectedTicket && selectedTicket.id === ticketId) {
      setSelectedTicket({ ...selectedTicket, status: 'Resolved', lastUpdated: 'Just now' });
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <LifeBuoy className="w-6 h-6 text-teal-600" />
              <span>Customer Support Tickets Hub</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage incoming tickets across New, Open, Pending, Escalated, and Resolved states
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-semibold">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  viewMode === 'table' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Table View
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Stage Board
              </button>
            </div>
          </div>
        </div>

        {/* Status Tab Strip */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-100">
          {(['All', 'New', 'Open', 'Pending', 'Escalated', 'Resolved'] as const).map(tab => {
            const count = tab === 'All' ? tickets.length : tickets.filter(t => t.status === tab).length;
            const isActive = statusFilter === tab;
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                  isActive
                    ? 'bg-teal-600 text-white shadow-2xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                <span>{tab}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isActive ? 'bg-teal-700 text-white' : 'bg-white text-slate-700'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters and Search Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ticket ID, customer, subject..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Priority:</span>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
            >
              <option value="All">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Channel:</span>
            <select
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
            >
              <option value="All">All Inbound Channels</option>
              <option value="WhatsApp">WhatsApp Inbound</option>
              <option value="Email">Email Support</option>
              <option value="Portal">Web Portal</option>
              <option value="Phone">Phone Call</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content: Table or Kanban */}
      {viewMode === 'table' ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Customer & Account</th>
                  <th className="py-3 px-4">Category & Subject</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Assigned Agent</th>
                  <th className="py-3 px-4">SLA / Updated</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTickets.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(t.channel)}
                        <span className="font-mono font-bold text-slate-900">{t.id}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{t.createdAt}</span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900 block">{t.customer}</span>
                      <span className="text-[11px] text-slate-500">{t.company}</span>
                      <span className="text-[10px] font-bold text-teal-700 block mt-0.5">{t.tier} Tier</span>
                    </td>

                    <td className="py-3 px-4 max-w-xs">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                          {t.category}
                        </span>
                      </div>
                      <p className="font-semibold text-slate-800 line-clamp-1">{t.subject}</p>
                    </td>

                    <td className="py-3 px-4">
                      {getPriorityBadge(t.priority)}
                    </td>

                    <td className="py-3 px-4">
                      {getStatusBadge(t.status)}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-800 block">{t.assignedTo}</span>
                      <span className="text-[10px] text-slate-400">First Resp: {t.firstResponseTime}</span>
                    </td>

                    <td className="py-3 px-4">
                      {t.slaBreach ? (
                        <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                          SLA Breached
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                          On Track
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 block mt-1">{t.lastUpdated}</span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedTicket(t)}
                        className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-700 font-semibold text-xs transition-colors border border-slate-200 hover:border-teal-200 inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Kanban Stage Board */
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 overflow-x-auto pb-4">
          {(['New', 'Open', 'Pending', 'Escalated', 'Resolved'] as const).map(stage => {
            const stageTickets = filteredTickets.filter(t => t.status === stage);
            return (
              <div key={stage} className="bg-slate-50/70 border border-slate-200 rounded-2xl p-3 flex flex-col gap-3 min-w-[240px]">
                <div className="flex items-center justify-between px-1">
                  <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider">{stage}</h4>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-slate-700 border border-slate-200">
                    {stageTickets.length}
                  </span>
                </div>

                <div className="space-y-2.5 flex-1">
                  {stageTickets.map(t => (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTicket(t)}
                      className="bg-white border border-slate-200 hover:border-teal-500 rounded-xl p-3 shadow-2xs hover:shadow-md transition-all cursor-pointer space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-900">{t.id}</span>
                        {getPriorityBadge(t.priority)}
                      </div>
                      <p className="text-xs font-semibold text-slate-800 line-clamp-2">{t.subject}</p>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="truncate max-w-[110px] font-semibold">{t.company}</span>
                        <span className="text-slate-400">{t.assignedTo}</span>
                      </div>
                    </div>
                  ))}
                  {stageTickets.length === 0 && (
                    <div className="py-8 text-center text-slate-400 text-xs italic">
                      No tickets in {stage}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ticket Details & Timeline Drawer */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-end animate-in fade-in">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between overflow-hidden">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-slate-900">{selectedTicket.id}</span>
                  {getStatusBadge(selectedTicket.status)}
                  {getPriorityBadge(selectedTicket.priority)}
                </div>
                <h3 className="font-bold text-sm text-slate-900 mt-1">{selectedTicket.subject}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedTicket.customer} &bull; {selectedTicket.company} ({selectedTicket.tier})
                </p>
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body - Timeline & Metadata */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Category</span>
                  <span className="font-semibold text-slate-800">{selectedTicket.category}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Inbound Channel</span>
                  <span className="font-semibold text-slate-800">{selectedTicket.channel}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Assigned Lead</span>
                  <span className="font-semibold text-slate-800">{selectedTicket.assignedTo}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">First Response Speed</span>
                  <span className="font-mono font-semibold text-teal-700">{selectedTicket.firstResponseTime}</span>
                </div>
              </div>

              {/* Message Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Conversation &amp; Audit Trail
                </h4>
                <div className="space-y-3">
                  {selectedTicket.messages.map((m, idx) => (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-2xl text-xs space-y-1 ${
                        m.isAgent
                          ? 'bg-teal-50/80 border border-teal-100 ml-6 text-slate-800'
                          : 'bg-slate-100 border border-slate-200 mr-6 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-bold text-slate-700">{m.sender}</span>
                        <span>{m.time}</span>
                      </div>
                      <p className="leading-relaxed">{m.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-slate-200 bg-white space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Type an internal note or reply to customer..."
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendReply()}
                  className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-teal-500"
                />
                <button
                  onClick={handleSendReply}
                  className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-2xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  onClick={() => handleResolveTicket(selectedTicket.id)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark as Resolved</span>
                </button>
                <button
                  onClick={() => {
                    alert(`Paging engineering tier-2 lead for ticket ${selectedTicket.id}`);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Escalate Issue</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
