import React, { useState, useRef } from 'react';
import { 
  X, User, ShieldCheck, AlertCircle, Upload, Download, 
  FileText, Calendar, CheckCircle2, UserMinus, Clock, Mail, Paperclip,
  Trash2, XCircle, Plus, DollarSign, Eye, Sparkles
} from 'lucide-react';
import { Employee, UploadedDocument, DetailedLeaveRecord } from '../../../types/amuwaHq';
import { DocumentPreviewModal } from '../../common/DocumentPreviewModal';

interface EmployeeProfileModalProps {
  employee: Employee;
  onClose: () => void;
  onUpdateEmployee: (updatedEmployee: Employee) => void;
}

export const EmployeeProfileModal: React.FC<EmployeeProfileModalProps> = ({
  employee,
  onClose,
  onUpdateEmployee
}) => {
  const [emp, setEmp] = useState<Employee>(employee);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<UploadedDocument | null>(null);

  // File Inputs Refs
  const docInputRef = useRef<HTMLInputElement>(null);

  // Leave Form State with Custom Time Inputs
  const [showAddLeave, setShowAddLeave] = useState(false);
  const [leaveType, setLeaveType] = useState<'Half-Day' | 'Full-Day Leave'>('Half-Day');
  const [leaveDate, setLeaveDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Custom Time Inputs
  const [customStartTime, setCustomStartTime] = useState('11:00 AM');
  const [customEndTime, setCustomEndTime] = useState('03:30 PM');
  
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveMailFile, setLeaveMailFile] = useState<File | null>(null);

  // Cancellation State
  const [cancellingLeaveId, setCancellingLeaveId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelMailFile, setCancelMailFile] = useState<File | null>(null);

  // 2. Document Upload Handler
  const handleDocumentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newDocs: UploadedDocument[] = [];
    Array.from(files).forEach((file, index) => {
      const url = URL.createObjectURL(file);
      newDocs.push({
        id: `DOC-${Date.now()}-${index}`,
        name: file.name,
        fileUrl: url,
        fileType: file.type,
        uploadedAt: new Date().toISOString().split('T')[0]
      });
    });

    const updated = {
      ...emp,
      uploadedDocs: [...newDocs, ...(emp.uploadedDocs || [])]
    };
    setEmp(updated);
    onUpdateEmployee(updated);
  };

  // 3. Toggle Documents Collected Status (Green vs Red)
  const handleToggleDocuments = () => {
    const updated = { ...emp, documentsCollected: !emp.documentsCollected };
    setEmp(updated);
    onUpdateEmployee(updated);
  };

  // 4. File New Leave / Half-Day with Custom Time Inputs & Mandatory Mail Attachment
  const handleFileLeaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveMailFile) {
      alert('Mandatory Mail Attachment Required: Please attach approval email screenshot or PDF file from your computer!');
      return;
    }

    const mailUrl = URL.createObjectURL(leaveMailFile);
    const newRecord: DetailedLeaveRecord = {
      id: `LR-${Date.now()}`,
      employeeId: emp.id,
      leaveType,
      date: leaveDate,
      customStartTime: customStartTime || '09:30 AM',
      customEndTime: customEndTime || '06:30 PM',
      reason: leaveReason || `${leaveType} noted`,
      mailAttachmentName: leaveMailFile.name,
      mailAttachmentUrl: mailUrl,
      status: 'Active',
      submittedAt: new Date().toISOString()
    };

    const newHalfDays = leaveType === 'Half-Day' ? emp.halfDaysCount + 1 : emp.halfDaysCount;
    const newTotalLeaves = leaveType === 'Full-Day Leave' ? emp.totalLeavesCount + 1 : emp.totalLeavesCount;

    const updated = {
      ...emp,
      leaveHistory: [newRecord, ...(emp.leaveHistory || [])],
      halfDaysCount: newHalfDays,
      totalLeavesCount: newTotalLeaves
    };

    setEmp(updated);
    onUpdateEmployee(updated);

    setShowAddLeave(false);
    setLeaveReason('');
    setLeaveMailFile(null);
  };

  // 5. Cancel Leave with Mandatory Cancellation Mail Attachment
  const handleConfirmCancelLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingLeaveId || !cancelMailFile) {
      alert('Mandatory Cancellation Mail Attachment Required: Please attach cancellation approval mail file!');
      return;
    }

    const cancelMailUrl = URL.createObjectURL(cancelMailFile);

    const targetLeave = emp.leaveHistory.find(l => l.id === cancellingLeaveId);
    let newHalfDays = emp.halfDaysCount;
    let newTotalLeaves = emp.totalLeavesCount;

    if (targetLeave && targetLeave.status === 'Active') {
      if (targetLeave.leaveType === 'Half-Day' && newHalfDays > 0) newHalfDays -= 1;
      if (targetLeave.leaveType === 'Full-Day Leave' && newTotalLeaves > 0) newTotalLeaves -= 1;
    }

    const updatedHistory = emp.leaveHistory.map(record => {
      if (record.id === cancellingLeaveId) {
        return {
          ...record,
          status: 'Cancelled' as const,
          cancellationMailName: cancelMailFile.name,
          cancellationMailUrl: cancelMailUrl,
          cancellationReason: cancelReason || 'Leave cancelled by HR approval'
        };
      }
      return record;
    });

    const updated = {
      ...emp,
      leaveHistory: updatedHistory,
      halfDaysCount: newHalfDays,
      totalLeavesCount: newTotalLeaves
    };

    setEmp(updated);
    onUpdateEmployee(updated);

    setCancellingLeaveId(null);
    setCancelReason('');
    setCancelMailFile(null);
  };

  // 6. Action: Convert Trainee / Intern to Permanent Employee
  const handleConvertStatus = () => {
    const updated = {
      ...emp,
      status: 'Full-Time' as const,
      designation: emp.designation.replace(/(Trainee|Intern)/gi, 'Executive'),
      notes: `Converted to Permanent Full-Time Employee on ${new Date().toLocaleDateString()}`
    };
    setEmp(updated);
    onUpdateEmployee(updated);
  };

  // 7. Action: Mark as Left Company
  const handleMarkLeft = () => {
    const confirmLeft = window.confirm(`Are you sure you want to mark ${emp.name} as "Left Company"?`);
    if (!confirmLeft) return;

    const updated = {
      ...emp,
      status: 'Left' as const,
      leftDate: new Date().toISOString().split('T')[0],
      notes: `Left company on ${new Date().toLocaleDateString()}`
    };
    setEmp(updated);
    onUpdateEmployee(updated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden animate-scale-up max-h-[92vh] flex flex-col">
        
        {/* Top Profile Banner & Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-slate-800 to-red-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-4">
            
            <div className="w-16 h-16 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-white font-bold text-xl font-mono shadow-md">
              <span>{emp.name.charAt(0)}</span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold font-heading text-white">{emp.name}</h3>
                
                {/* Employment Status Badge */}
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                  emp.status === 'Full-Time'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : emp.status === 'Left'
                    ? 'bg-slate-700 text-slate-300 border-slate-600'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {emp.status === 'Full-Time' ? 'Employee' : emp.status === 'Training / Probation' ? 'In-Training' : emp.status}
                </span>
              </div>

              <p className="text-xs text-slate-300 font-sans mt-0.5">{emp.designation}</p>
              <p className="text-[11px] font-mono text-slate-400 mt-1">
                ID: {emp.id} &bull; Joined: {emp.joiningDate} {emp.leftDate ? `&bull; Left: ${emp.leftDate}` : ''}
              </p>
            </div>

          </div>

          <button onClick={onClose} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-slate-900">
          
          {/* Quick Details Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase block">WORKING HOURS / TIMINGS</span>
              <span className="text-xs font-bold font-mono text-slate-900 mt-0.5 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                {emp.workingHours || '09:30 AM - 06:30 PM (Mon-Sat)'}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase block">MONTHLY SALARY / PACKAGE</span>
              <span className="text-xs font-bold font-mono text-emerald-700 mt-0.5 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                {emp.monthlySalary || '₹65,000'} {emp.annualCTC ? `(${emp.annualCTC})` : ''}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase block">LEAVE COUNTS</span>
              <span className="text-xs font-bold font-mono text-amber-700 mt-0.5 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-amber-600" />
                Half-Days: <strong>{emp.halfDaysCount}</strong> &bull; Full-Days: <strong>{emp.totalLeavesCount}</strong>
              </span>
            </div>
          </div>

          {/* e] DOCUMENTS SECTION (With Preview & Download options) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold font-heading text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span>Employee Documents Vault</span>
                </h4>
                <p className="text-xs text-slate-500">Collect, preview, and verify employee ID proofs, marksheets, and documents.</p>
              </div>

              {/* Documents Collected Toggle Box (GREEN IF YES, RED IF NO) */}
              <button
                type="button"
                onClick={handleToggleDocuments}
                className={`px-4 py-2 rounded-2xl text-xs font-mono font-bold flex items-center gap-2 shadow-sm transition-all border ${
                  emp.documentsCollected
                    ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
                    : 'bg-rose-600 text-white border-rose-700 hover:bg-rose-700'
                }`}
              >
                {emp.documentsCollected ? (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>DOCUMENTS COLLECTED (VERIFIED)</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>DOCUMENTS PENDING (VERIFY NOW)</span>
                  </>
                )}
              </button>
            </div>

            {/* Document Upload Button & File List */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-mono font-bold text-slate-700 uppercase">
                  Uploaded Document Files ({emp.uploadedDocs?.length || 0})
                </span>

                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-mono font-bold border border-blue-200 flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Documents from Computer</span>
                </button>

                <input
                  ref={docInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  onChange={handleDocumentUpload}
                  className="hidden"
                />
              </div>

              {emp.uploadedDocs && emp.uploadedDocs.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {emp.uploadedDocs.map(doc => (
                    <div key={doc.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                        <div className="truncate">
                          <span className="font-semibold text-slate-900 block truncate">{doc.name}</span>
                          <span className="text-[10px] font-mono text-slate-400">Uploaded: {doc.uploadedAt}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* PREVIEW BUTTON */}
                        <button
                          type="button"
                          onClick={() => setSelectedPreviewDoc(doc)}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-mono font-bold flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Preview</span>
                        </button>

                        {/* DOWNLOAD BUTTON */}
                        <a
                          href={doc.fileUrl}
                          download={doc.name}
                          className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono font-bold flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2 text-center">No document files uploaded yet. Click above to upload files from your computer.</p>
              )}
            </div>
          </div>

          {/* LEAVES & HALF-DAYS DETAILED SECTION WITH CUSTOM TIME INPUTS */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold font-heading text-slate-900 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  <span>Leaves &amp; Half-Days Register</span>
                </h4>
                <p className="text-xs text-slate-500">Specify custom start &amp; end times for leaves with mandatory mail approval attachments.</p>
              </div>

              <button
                type="button"
                onClick={() => setShowAddLeave(!showAddLeave)}
                className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>File Custom Leave / Half-Day</span>
              </button>
            </div>

            {/* FORM: File Leave / Half-Day with Custom Start & End Times */}
            {showAddLeave && (
              <form onSubmit={handleFileLeaveSubmit} className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-3 text-xs animate-fade-in">
                <h5 className="font-bold text-amber-950 font-mono uppercase text-[11px]">New Custom Time Leave Entry</h5>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">TYPE OF LEAVE</label>
                    <select
                      value={leaveType}
                      onChange={e => setLeaveType(e.target.value as any)}
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                    >
                      <option value="Half-Day">Half-Day</option>
                      <option value="Full-Day Leave">Full-Day Leave</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">DATE OF LEAVE</label>
                    <input
                      type="date"
                      required
                      value={leaveDate}
                      onChange={e => setLeaveDate(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>

                  {/* CUSTOM START TIME */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CUSTOM START TIME</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 11:00 AM"
                      value={customStartTime}
                      onChange={e => setCustomStartTime(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl font-mono text-xs"
                    />
                  </div>

                  {/* CUSTOM END TIME */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CUSTOM END TIME</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 03:30 PM"
                      value={customEndTime}
                      onChange={e => setCustomEndTime(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">REASON</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter reason for leave..."
                    value={leaveReason}
                    onChange={e => setLeaveReason(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                  />
                </div>

                {/* MANDATORY MAIL ATTACHMENT */}
                <div className="p-3 bg-white border border-amber-300 rounded-xl space-y-1">
                  <label className="block text-[10px] font-bold text-amber-900 font-mono uppercase flex items-center gap-1">
                    <Paperclip className="w-3.5 h-3.5 text-amber-600" />
                    <span>MANDATORY MAIL ATTACHMENT (IMAGE OR PDF) *</span>
                  </label>
                  <p className="text-[10px] text-slate-500">Without mail screenshot/PDF attachment, this leave cannot be accepted.</p>
                  
                  <div className="flex items-center gap-3 pt-1">
                    <input
                      type="file"
                      required
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={e => setLeaveMailFile(e.target.files?.[0] || null)}
                      className="text-xs font-mono"
                    />
                    {leaveMailFile && (
                      <span className="text-[11px] font-mono text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Attached: {leaveMailFile.name}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddLeave(false)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-amber-600 text-white font-bold font-mono shadow-sm"
                  >
                    Submit Leave Request
                  </button>
                </div>
              </form>
            )}

            {/* Leave History List */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              {emp.leaveHistory && emp.leaveHistory.length > 0 ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase">
                    <tr>
                      <th className="p-3">Type &amp; Date</th>
                      <th className="p-3">Custom Timings / Hours</th>
                      <th className="p-3">Reason &amp; Mail Approval</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Cancellation Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {emp.leaveHistory.map(rec => (
                      <tr key={rec.id} className={rec.status === 'Cancelled' ? 'bg-slate-50/60 opacity-60' : 'hover:bg-slate-50'}>
                        <td className="p-3 font-mono">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            rec.leaveType === 'Half-Day' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'
                          }`}>
                            {rec.leaveType}
                          </span>
                          <span className="block font-bold text-slate-900 mt-1">{rec.date}</span>
                        </td>

                        <td className="p-3 font-mono text-[11px] text-slate-700">
                          {rec.customStartTime && rec.customEndTime 
                            ? `${rec.customStartTime} - ${rec.customEndTime}`
                            : rec.halfDayShift || 'Full Day'}
                        </td>

                        <td className="p-3">
                          <p className="text-slate-800">{rec.reason}</p>
                          {rec.mailAttachmentName && (
                            <a
                              href={rec.mailAttachmentUrl || '#'}
                              download={rec.mailAttachmentName}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-blue-600 underline mt-0.5"
                            >
                              <Paperclip className="w-3 h-3" />
                              <span>{rec.mailAttachmentName}</span>
                            </a>
                          )}
                          {rec.status === 'Cancelled' && (
                            <p className="text-[10px] font-mono text-rose-600 mt-1 italic">
                              Cancelled: {rec.cancellationReason} (Mail: {rec.cancellationMailName})
                            </p>
                          )}
                        </td>

                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            rec.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {rec.status}
                          </span>
                        </td>

                        <td className="p-3 text-right">
                          {rec.status === 'Active' ? (
                            <button
                              type="button"
                              onClick={() => setCancellingLeaveId(rec.id)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-mono font-bold flex items-center gap-1 ml-auto"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>Cancel Leave</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-slate-400">Cancelled</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-slate-400 italic py-4 text-center">No leaves or half-days filed for this employee.</p>
              )}
            </div>
          </div>

          {/* f] ACTIONS SECTION: Trainee Conversion & Left Company */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <h4 className="text-xs font-mono font-bold text-slate-700 uppercase">Employee Actions &amp; Lifecycle Management</h4>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {(emp.status === 'Training / Probation' || emp.status === 'Intern') && (
                  <button
                    type="button"
                    onClick={handleConvertStatus}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-md active:scale-95"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>CONFIRM &amp; CONVERT TO PERMANENT EMPLOYEE</span>
                  </button>
                )}
                {emp.status === 'Full-Time' && (
                  <span className="text-xs font-mono text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Confirmed Permanent Employee</span>
                  </span>
                )}
              </div>

              {emp.status !== 'Left' ? (
                <button
                  type="button"
                  onClick={handleMarkLeft}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  <UserMinus className="w-4 h-4 text-rose-400" />
                  <span>MARK AS LEFT COMPANY</span>
                </button>
              ) : (
                <span className="px-3 py-1 rounded-xl bg-slate-200 text-slate-700 text-xs font-mono font-bold">
                  Status: Exited / Left Company
                </span>
              )}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-mono font-bold shadow-sm hover:bg-slate-800"
          >
            Close Profile
          </button>
        </div>

      </div>

      {/* DOCUMENT PREVIEW MODAL */}
      {selectedPreviewDoc && (
        <DocumentPreviewModal
          document={selectedPreviewDoc}
          onClose={() => setSelectedPreviewDoc(null)}
        />
      )}

      {/* MODAL: LEAVE CANCELLATION MAIL ATTACHMENT MODAL */}
      {cancellingLeaveId && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-4">
            <h3 className="text-lg font-bold font-heading text-rose-950 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-600" />
              <span>Cancel Leave &amp; Attach Cancellation Mail</span>
            </h3>

            <form onSubmit={handleConfirmCancelLeave} className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CANCELLATION REASON</label>
                <input
                  type="text"
                  required
                  placeholder="Enter reason for leave cancellation..."
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              {/* MANDATORY CANCELLATION MAIL ATTACHMENT */}
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                <label className="block text-[10px] font-bold text-rose-900 font-mono uppercase flex items-center gap-1">
                  <Paperclip className="w-3.5 h-3.5 text-rose-600" />
                  <span>MANDATORY CANCELLATION MAIL ATTACHMENT *</span>
                </label>
                <p className="text-[10px] text-slate-500">Please attach email screenshot or PDF requesting leave cancellation.</p>

                <input
                  type="file"
                  required
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={e => setCancelMailFile(e.target.files?.[0] || null)}
                  className="text-xs font-mono pt-1"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancellingLeaveId(null)}
                  className="w-1/2 py-2 rounded-xl bg-slate-100 text-slate-700"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2 rounded-xl bg-rose-600 text-white font-bold font-mono shadow-sm"
                >
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
