import { LeadSource, LeadSourceId } from '../types/crm';

export const LEAD_SOURCES: Record<LeadSourceId, LeadSource> = {
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp API',
    badgeLabel: 'WhatsApp API',
    color: '#10B981',
    bgClass: 'bg-emerald-500/15',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
    glowClass: 'glow-whatsapp',
    description: 'Inbound customer chats & bot webhooks via Meta WhatsApp Business Cloud API',
    defaultPayload: {
      event: 'messages.upsert',
      phone_number_id: '109823491823',
      from: '+919876543210',
      profile_name: 'Rahul Sharma',
      message: {
        text: 'Hi, I would like a quote for enterprise cloud subscription.',
        timestamp: Math.floor(Date.now() / 1000)
      }
    }
  },
  meta: {
    id: 'meta',
    name: 'Meta Ads',
    badgeLabel: 'Meta Ads',
    color: '#3B82F6',
    bgClass: 'bg-blue-500/15',
    textClass: 'text-blue-400',
    borderClass: 'border-blue-500/30',
    glowClass: 'glow-meta',
    description: 'Instant lead form submissions from Facebook & Instagram ad campaigns',
    defaultPayload: {
      ad_id: '23851092830192',
      form_id: '891023910293',
      campaign_name: 'Q3_Enterprise_Growth_Campaign',
      field_data: [
        { name: 'full_name', values: ['Ananya Roy'] },
        { name: 'phone_number', values: ['+919812345678'] },
        { name: 'email', values: ['ananya.r@techsol.io'] },
        { name: 'company', values: ['TechSol Global'] }
      ]
    }
  },
  telecaller: {
    id: 'telecaller',
    name: 'Telecaller',
    badgeLabel: 'Telecaller',
    color: '#F59E0B',
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    glowClass: 'glow-telecaller',
    description: 'Manual & automated agent call logs from internal tele-sales team',
    defaultPayload: {
      agent_id: 'AGENT_402',
      agent_name: 'Priya Verma',
      call_duration_seconds: 245,
      disposition: 'Interested / Demo Requested',
      prospect: {
        name: 'Vikramaditya Das',
        phone: '+919711223344',
        email: 'v.das@apexcorp.com',
        budget: '$15,000'
      }
    }
  },
  bizdev: {
    id: 'bizdev',
    name: 'Business Developer',
    badgeLabel: 'Business Dev',
    color: '#8B5CF6',
    bgClass: 'bg-purple-500/15',
    textClass: 'text-purple-400',
    borderClass: 'border-purple-500/30',
    glowClass: 'glow-bizdev',
    description: 'Field executive meetings, networking events, and B2B partnership deals',
    defaultPayload: {
      bd_executive: 'Karan Mehra',
      meeting_type: 'In-Person Executive Pitch',
      company_name: 'Starlight Ventures',
      contact_person: 'Siddharth Nair',
      email: 'siddharth@starlight.com',
      phone: '+919988776655',
      estimated_deal_value: 45000
    }
  },
  aicalling: {
    id: 'aicalling',
    name: 'AI Calling',
    badgeLabel: 'AI Calling',
    color: '#06B6D4',
    bgClass: 'bg-cyan-500/15',
    textClass: 'text-cyan-400',
    borderClass: 'border-cyan-500/30',
    glowClass: 'glow-aicalling',
    description: 'Autonomous Conversational AI Voice Agent outbound/inbound calls',
    defaultPayload: {
      ai_agent_id: 'VOICE_BOT_V4',
      call_sid: 'CA109823901823091',
      transcript_summary: 'Customer qualified for custom API integration package.',
      lead: {
        name: 'Meera Deshmukh',
        phone: '+919654321098',
        email: 'meera.d@fintech-plus.in',
        intent_score: 0.92
      }
    }
  },
  rcs: {
    id: 'rcs',
    name: 'RCS Messages',
    badgeLabel: 'RCS Messages',
    color: '#EC4899',
    bgClass: 'bg-pink-500/15',
    textClass: 'text-pink-400',
    borderClass: 'border-pink-500/30',
    glowClass: 'glow-rcs',
    description: 'Rich Communication Services interactive card clicks & direct replies',
    defaultPayload: {
      rcs_campaign_id: 'RCS_FESTIVE_OFFER_09',
      button_clicked: 'Request_Callback_Now',
      user_msisdn: '+919543210987',
      user_name: 'Rajesh Kumar',
      location: 'Mumbai, IN'
    }
  },
  website: {
    id: 'website',
    name: 'Website',
    badgeLabel: 'Website',
    color: '#6366F1',
    bgClass: 'bg-indigo-500/15',
    textClass: 'text-indigo-400',
    borderClass: 'border-indigo-500/30',
    glowClass: 'glow-website',
    description: 'Official company website contact forms, demo requests & chatbot leads',
    defaultPayload: {
      form_name: 'Enterprise_Demo_Request_Form',
      page_url: 'https://amuwa.com/enterprise/pricing',
      visitor: {
        name: 'Neha Kapoor',
        email: 'neha.k@summittech.org',
        phone: '+919432109876',
        team_size: '50-100'
      }
    }
  },
  references: {
    id: 'references',
    name: 'References',
    badgeLabel: 'References',
    color: '#14B8A6',
    bgClass: 'bg-teal-500/15',
    textClass: 'text-teal-400',
    borderClass: 'border-teal-500/30',
    glowClass: 'glow-references',
    description: 'Client referral program submissions and executive network intros',
    defaultPayload: {
      referred_by_client_id: 'CLI_9921',
      referrer_name: 'Dr. Alok Chatterjee',
      referee: {
        name: 'Deepak Patel',
        company: 'Patel Logistics Solutions',
        email: 'deepak@patellogistics.com',
        phone: '+919321098765'
      }
    }
  },
  coldcalling: {
    id: 'coldcalling',
    name: 'Cold Calling',
    badgeLabel: 'Cold Calling',
    color: '#F97316',
    bgClass: 'bg-orange-500/15',
    textClass: 'text-orange-400',
    borderClass: 'border-orange-500/30',
    glowClass: 'glow-coldcalling',
    description: 'Outbound prospecting call lists and SDR direct contact discovery',
    defaultPayload: {
      sdr_name: 'Amitabh Joshi',
      prospect_list_id: 'LST_BANGALORE_B2B_IT',
      contact: {
        name: 'Rohan Gupta',
        designation: 'CTO',
        phone: '+919210987654',
        email: 'rgupta@innovate.co'
      }
    }
  },
  thirdparty: {
    id: 'thirdparty',
    name: 'Third Party Sources',
    badgeLabel: '3rd Party',
    color: '#F43F5E',
    bgClass: 'bg-rose-500/15',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
    glowClass: 'glow-thirdparty',
    description: 'Aggregator marketplaces, IndiaMART, Justdial, and external lead APIs',
    defaultPayload: {
      provider: 'IndiaMART_Enterprise_Feed',
      query: 'Industrial Automation Software',
      lead_details: {
        sender_name: 'Suresh Rao',
        sender_mobile: '+919109876543',
        sender_email: 'suresh@raomfg.com',
        subject: 'Requirement for Bulk License'
      }
    }
  }
};

export const LEAD_SOURCE_LIST = Object.values(LEAD_SOURCES);
