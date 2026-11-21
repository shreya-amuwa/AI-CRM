// A stand-in Supabase client for the reminders browser test: the reminder settings, the device list, and a record of every call.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const company = { enabled: true, punchIn: '10:00', lunch: '14:00', punchOut: '19:00', followUpMinutes: 15, lunchWarningMinutes: 5, days: [1, 2, 3, 4, 5, 6], resumeFollowUpMinutes: 10, lunchAllowanceMinutes: 45 };
const state: any = (window as any).__state = {
  role: 'staff',            // 'staff' | 'hr' | 'sa'
  thisDevice: 'd1',         // the row of the browser under test (null: removed from the list)
  mine: { enabled: true, punchIn: null, lunch: null, punchOut: null },
  pausedToday: false,
  chatPush: true,
  devices: [
    { id: 'd1', label: 'Chrome on Android', createdAt: '2026-11-10T05:00:00Z', lastSuccessAt: '2026-11-17T04:30:00Z', active: true },
    { id: 'd2', label: 'Edge on Windows', createdAt: '2026-11-12T05:00:00Z', lastSuccessAt: null, active: true }
  ]
};
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const settings = () => {
  const staff = state.role !== 'sa';
  const eff = { enabled: company.enabled && state.mine.enabled, punchIn: state.mine.punchIn ?? company.punchIn, lunch: state.mine.lunch ?? company.lunch, punchOut: state.mine.punchOut ?? company.punchOut };
  return { company: { ...company }, mine: staff ? { ...state.mine } : null, effective: staff ? eff : null, pausedToday: state.pausedToday, canManage: state.role !== 'staff', chatPush: state.chatPush };
};
const fail = (message: string) => { throw Object.assign(new Error(message), { isRpcError: true }); };
const handlers: Record<string, (a: any) => any> = {
  attendance_reminder_settings: () => settings(),
  attendance_reminder_save_mine: a => {
    if (a.p_punch_in && (a.p_punch_in < '06:00' || a.p_punch_in > '13:00')) fail('VALIDATION_ERROR: Punch In reminder must be between 06:00 and 13:00');
    state.mine = { enabled: a.p_enabled, punchIn: hhmm(a.p_punch_in), lunch: hhmm(a.p_lunch), punchOut: hhmm(a.p_punch_out) };
    return settings();
  },
  hr_attendance_reminder_defaults_save: a => {
    if (state.role === 'staff') fail('FORBIDDEN: Only HR can change the company reminder settings.');
    Object.assign(company, { enabled: a.p_enabled, punchIn: hhmm(a.p_punch_in), lunch: hhmm(a.p_lunch), punchOut: hhmm(a.p_punch_out),
      followUpMinutes: a.p_follow_up, lunchWarningMinutes: a.p_warning, days: a.p_days });
    return settings();
  },
  hr_attendance_reminders_pause_today: a => { state.pausedToday = !!a.p_paused; return settings(); },
  push_chat_set: a => { state.chatPush = !!a.p_enabled; return settings(); },
  push_subscription_save: () => 'new-device-id',
  push_subscription_remove: () => null,
  push_subscription_remove_by_id: a => { state.devices = state.devices.filter((d: any) => d.id !== a.p_id); if (a.p_id === state.thisDevice) state.thisDevice = null; return null; },
  push_subscription_claim: () => state.thisDevice !== null,
  my_push_devices: () => state.devices,
  // notification reliability (20270125000200)
  push_test_confirm: () => null,
  notification_sound_confirm: () => null,
  notification_sound_save: () => settings(),
  notification_client_check: () => null,
  hr_attendance_resume_follow_up_save: a => {
    if (a.p_minutes < 0 || a.p_minutes > 60) fail('VALIDATION_ERROR: The Resume Work follow-up must be between 0 (none) and 60 minutes');
    company.resumeFollowUpMinutes = a.p_minutes;
    return settings();
  }
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => {
    calls.push({ fn, args });
    const h = handlers[fn];
    if (!h) return { data: null, error: { message: `unexpected ${fn}` } };
    try { return { data: h(args), error: null }; } catch (e: any) { return { data: null, error: { message: e.message } }; }
  },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
