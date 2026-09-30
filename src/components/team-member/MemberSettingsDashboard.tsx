import React, { useState } from 'react';
import {
  User,
  Bell,
  Shield,
  Award,
  Save,
  CheckCircle2,
  Lock,
  Mail,
  Phone
} from 'lucide-react';
import { SAMPLE_TEAM_MEMBERS } from '../../services/teamMemberStore';

interface MemberSettingsDashboardProps {
  currentUserId: string;
  userName: string;
}

export const MemberSettingsDashboard: React.FC<MemberSettingsDashboardProps> = ({
  currentUserId,
  userName
}) => {
  const user = SAMPLE_TEAM_MEMBERS.find(u => u.id === currentUserId);
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(user?.email || 'priya@amuwa.com');
  const [phone, setPhone] = useState('+91 98765 00123');
  const [savedToast, setSavedToast] = useState(false);

  // Notification Toggles
  const [notifications, setNotifications] = useState({
    leadAssigned: true,
    callReminder: true,
    dealUpdated: true,
    dailySummary: true
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {savedToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Profile settings updated successfully!</span>
        </div>
      )}

      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
          Account & Settings
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Manage your profile information, notification alerts, and sales quota preferences.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6 text-xs">
        {/* PROFILE CARD */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <User className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-sm">Personal Profile</h3>
          </div>

          <div className="flex items-center gap-4">
            <img
              src={
                user?.avatar ||
                'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80'
              }
              alt={name}
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-blue-500/20 shadow-xs"
            />
            <div>
              <button
                type="button"
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-xs transition-colors"
              >
                Change Avatar
              </button>
              <p className="text-[11px] text-slate-400 mt-1">Recommended size 200x200px (JPG, PNG)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Role & Title</label>
              <input
                type="text"
                disabled
                value={user?.title || 'Sales Executive'}
                className="w-full px-3.5 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* NOTIFICATION PREFERENCES */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Bell className="w-4 h-4 text-purple-600" />
            <h3 className="font-bold text-slate-900 text-sm">Notifications & Reminders</h3>
          </div>

          <div className="space-y-3">
            <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
              <div>
                <div className="font-semibold text-slate-800">New Lead Assignment</div>
                <div className="text-[11px] text-slate-500">Get notified when a new lead is assigned to you.</div>
              </div>
              <input
                type="checkbox"
                checked={notifications.leadAssigned}
                onChange={e => setNotifications({ ...notifications, leadAssigned: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
              <div>
                <div className="font-semibold text-slate-800">Follow-up Call Reminders</div>
                <div className="text-[11px] text-slate-500">Alert 15 minutes before a scheduled demo or call.</div>
              </div>
              <input
                type="checkbox"
                checked={notifications.callReminder}
                onChange={e => setNotifications({ ...notifications, callReminder: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
              <div>
                <div className="font-semibold text-slate-800">Deal Status Notifications</div>
                <div className="text-[11px] text-slate-500">Receive alerts when payments or contracts are verified.</div>
              </div>
              <input
                type="checkbox"
                checked={notifications.dealUpdated}
                onChange={e => setNotifications({ ...notifications, dealUpdated: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-xs hover:bg-blue-700 transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save Preferences</span>
          </button>
        </div>
      </form>
    </div>
  );
};
