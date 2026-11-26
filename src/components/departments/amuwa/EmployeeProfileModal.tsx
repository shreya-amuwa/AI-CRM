import React, { useEffect, useState, useRef } from 'react';
import { formatDay } from '../../../lib/officeTime';
import { 
  X, User, ShieldCheck, AlertCircle, Upload, Download, 
  FileText, Calendar, CheckCircle2, UserMinus, Clock, Mail, Paperclip,
  Trash2, XCircle, Plus, DollarSign, Eye, Sparkles
} from 'lucide-react';
import { Employee, UploadedDocument, DetailedLeaveRecord } from '../../../types/amuwaHq';
import { DocumentPreviewModal } from '../../common/DocumentPreviewModal';
import { HR_EMPLOYEE_FILE_KIND_LABEL, HR_EMPLOYEE_FILE_KINDS, type HrEmployeeFile, type HrEmployeeFileKind } from '../../../../shared/contracts';
import { hrEmployeeFilesApi } from '../../../lib/api/endpoints';
import { hrEmployeeKeyOf, uploadHrEmployeeFile } from '../../../lib/hrEmployeeFiles';
import { confirmAction } from '../../feedback/AppFeedback';

/** What HR picks from when uploading to the documents vault (leave mails are uploaded from the leave form). */
const VAULT_KINDS = HR_EMPLOYEE_FILE_KINDS.filter(k => k !== 'LEAVE_MAIL' && k !== 'LEAVE_CANCELLATION_MAIL');
const FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.eml';
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

interface EmployeeProfileModalProps {
  employee: Employee;
  onClose: () => void;
  onUpdateEmployee: (updatedEmployee: Employee) => void;
  /** Offered in the profile (not in the list): make a trainee / intern a permanent employee, or mark as left. */
  onConvert?: () => void;
  onMarkLeft?: () => void;
  /** HR staff / the Super Admin: correct the member's own contact number and emergency contact number (kept separate). */
  onSaveContacts?: (contact: string | null, emergency: string | null) => Promise<{ contactNumber: string | null; emergencyContact: string | null }>;
}

export const EmployeeProfileModal: React.FC<EmployeeProfileModalProps> = ({
  employee,
  onClose,
  onUpdateEmployee,
  onConvert,
  onMarkLeft,
  onSaveContacts
}) => {
  const [emp, setEmp] = useState<Employee>(employee);
  const [editContacts, setEditContacts] = useState(false);
  const [contactDraft, setContactDraft] = useState({ contact: '', emergency: '' });
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const saveContacts = async () => {
    if (!onSaveContacts || contactBusy) return;
    setContactBusy(true);
    setContactError(null);
    try {
      const saved = await onSaveContacts(contactDraft.contact.trim() || null, contactDraft.emergency.trim() || null);
      setEmp(e => ({ ...e, contactNumber: saved.contactNumber ?? undefined, emergencyContact: saved.emergencyContact ?? undefined }));
      setEditContacts(false);
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Could not save the numbers.');
    } finally {
      setContactBusy(false);
    }
  };
  const isTrainee = emp.status === 'Training / Probation' || emp.status === 'Intern';
  const hasLeft = emp.status === 'Left';
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
  // shown inside each leave form (a missing attachment, an upload that failed), never as a browser alert
  const [leaveFormError, setLeaveFormError] = useState<string | null>(null);
  const [cancelFormError, setCancelFormError] = useState<string | null>(null);

  // 2. Documents vault: files are stored in R2 through the API (only their metadata in the database) and listed from there,
  //    so they survive a refresh. HR staff upload / delete; every preview / download gets a short-lived signed link.
  const employeeKey = emp.profileId || emp.id ? hrEmployeeKeyOf(emp) : null;
  const [files, setFiles] = useState<HrEmployeeFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<HrEmployeeFileKind>('IDENTITY');
  const [uploading, setUploading] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);

  useEffect(() => {
    if (!employeeKey) return;
    let live = true;
    setFilesLoading(true);
    hrEmployeeFilesApi.list(employeeKey).then(
      list => { if (live) { setFiles(list); setFilesError(null); } },
      err => { if (live) setFilesError(errorText(err, 'Could not load the documents.')); }
    ).finally(() => { if (live) setFilesLoading(false); });
    return () => { live = false; };
  }, [employeeKey]);

  const fileById = (id?: string) => (id ? files.find(f => f.id === id) : undefined);

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (!picked.length || uploading) return;
    setUploading(true);
    setFilesError(null);
    const problems: string[] = [];
    for (const file of picked) {
      try {
        const saved = await uploadHrEmployeeFile(emp, file, uploadKind);
        setFiles(prev => [saved, ...prev]);
      } catch (err) {
        problems.push(`${file.name}: ${errorText(err, 'upload failed.')}`);
      }
    }
    if (problems.length) setFilesError(problems.join(' '));
    setUploading(false);
  };

  const openFile = async (file: HrEmployeeFile, action: 'view' | 'download') => {
    try {
      const link = await hrEmployeeFilesApi.url(file.id, action);
      if (action === 'download') {
        window.location.assign(link.url);
        return;
      }
      setSelectedPreviewDoc({ id: file.id, name: file.fileName, fileUrl: link.url, fileType: file.mimeType, uploadedAt: file.createdAt.slice(0, 10) });
    } catch (err) {
      setFilesError(errorText(err, 'Could not open the document.'));
    }
  };

  const deleteFile = async (file: HrEmployeeFile) => {
    if (!(await confirmAction({
      title: `Delete "${file.fileName}"?`,
      description: "It is removed from this employee's documents. This cannot be undone.",
      confirmLabel: 'Delete document', cancelLabel: 'Keep document', variant: 'destructive'
    }))) return;
    try {
      await hrEmployeeFilesApi.remove(file.id);
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (err) {
      setFilesError(errorText(err, 'Could not delete the document.'));
    }
  };

  // 3. Toggle Documents Collected Status (Green vs Red)
  const handleToggleDocuments = () => {
    const updated = { ...emp, documentsCollected: !emp.documentsCollected };
    setEmp(updated);
    onUpdateEmployee(updated);
  };

  // 4. File New Leave / Half-Day with Custom Time Inputs & Mandatory Mail Attachment
  const handleFileLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leaveBusy) return;
    if (!leaveMailFile) {
      setLeaveFormError('Attach the approval e-mail (a screenshot or PDF) before filing this leave.');
      return;
    }
    setLeaveFormError(null);

    const leaveId = `LR-${Date.now()}`;
    let mail: HrEmployeeFile;
    setLeaveBusy(true);
    try {
      mail = await uploadHrEmployeeFile(emp, leaveMailFile, 'LEAVE_MAIL', { leaveRef: leaveId });
    } catch (err) {
      setLeaveFormError(`The mail attachment could not be saved: ${errorText(err, 'upload failed.')}`);
      setLeaveBusy(false);
      return;
    }
    setLeaveBusy(false);
    setFiles(prev => [mail, ...prev]);
    const newRecord: DetailedLeaveRecord = {
      id: leaveId,
      employeeId: emp.id,
      leaveType,
      date: leaveDate,
      customStartTime: customStartTime || '09:30 AM',
      customEndTime: customEndTime || '06:30 PM',
      reason: leaveReason || `${leaveType} noted`,
      mailAttachmentName: mail.fileName,
      mailFileId: mail.id,
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
  const handleConfirmCancelLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leaveBusy) return;
    if (!cancellingLeaveId || !cancelMailFile) {
      setCancelFormError('Attach the cancellation approval e-mail (a screenshot or PDF) before confirming.');
      return;
    }
    setCancelFormError(null);

    let cancelMail: HrEmployeeFile;
    setLeaveBusy(true);
    try {
      cancelMail = await uploadHrEmployeeFile(emp, cancelMailFile, 'LEAVE_CANCELLATION_MAIL', { leaveRef: cancellingLeaveId, note: cancelReason || null });
    } catch (err) {
      setCancelFormError(`The cancellation mail could not be saved: ${errorText(err, 'upload failed.')}`);
      setLeaveBusy(false);
      return;
    }
    setLeaveBusy(false);
    setFiles(prev => [cancelMail, ...prev]);

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
          cancellationMailName: cancelMail.fileName,
          cancellationMailFileId: cancelMail.id,
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
  const handleMarkLeft = async () => {
    const confirmLeft = await confirmAction({
      title: `Mark ${emp.name} as left the company?`,
      description: "Today is recorded as their leaving date and their status becomes Left.",
      confirmLabel: 'Mark as left', cancelLabel: 'Keep as active', variant: 'destructive'
    });
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
              {((onConvert && isTrainee) || (onMarkLeft && !hasLeft)) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {onConvert && isTrainee && (
                    <button type="button" onClick={onConvert} className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold">
                      Make permanent employee
                    </button>
                  )}
                  {onMarkLeft && !hasLeft && (
                    <button type="button" onClick={onMarkLeft} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold border border-white/20">
                      Mark as left
                    </button>
                  )}
                </div>
              )}
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

          {(emp.dateOfBirth || emp.bloodGroup || emp.emergencyContact || emp.contactNumber || emp.designationType || onSaveContacts) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200" aria-label="Personal details">
              {[
                ['DESIGNATION', emp.designationType],
                ['DATE OF BIRTH', emp.dateOfBirth ? formatDay(emp.dateOfBirth) : undefined],
                ['BLOOD GROUP', emp.bloodGroup],
                ['CONTACT NUMBER', emp.contactNumber],
                ['EMERGENCY CONTACT', emp.emergencyContact]
              ].map(([label, value]) => (
                <div key={label as string}>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">{label}</span>
                  <span className="text-xs font-bold font-mono text-slate-900 mt-0.5 block" data-testid={`personal-${String(label).toLowerCase().replace(/\s+/g, '-')}`}>{value || '-'}</span>
                </div>
              ))}
              {onSaveContacts && !editContacts && (
                <div className="col-span-2 sm:col-span-4">
                  <button type="button" className="text-xs font-bold text-blue-600 hover:underline" data-testid="edit-contacts" onClick={() => { setContactDraft({ contact: emp.contactNumber || '', emergency: emp.emergencyContact || '' }); setContactError(null); setEditContacts(true); }}>
                    Edit contact numbers
                  </button>
                </div>
              )}
              {onSaveContacts && editContacts && (
                <div className="col-span-2 sm:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="contacts-form">
                  <label className="block text-xs font-semibold text-slate-700">
                    Team member contact number
                    <input type="tel" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" value={contactDraft.contact} onChange={e => setContactDraft(d => ({ ...d, contact: e.target.value }))} placeholder="+91 98765 43210" autoComplete="off" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Emergency contact number
                    <input type="tel" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" value={contactDraft.emergency} onChange={e => setContactDraft(d => ({ ...d, emergency: e.target.value }))} placeholder="+91 98765 43210" autoComplete="off" />
                  </label>
                  {contactError && <p role="alert" className="sm:col-span-2 text-xs text-rose-600">{contactError}</p>}
                  <div className="sm:col-span-2 flex gap-2">
                    <button type="button" disabled={contactBusy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50" onClick={() => void saveContacts()}>{contactBusy ? 'Saving…' : 'Save numbers'}</button>
                    <button type="button" disabled={contactBusy} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold" onClick={() => setEditContacts(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

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
                  Uploaded Document Files ({files.length})
                </span>

                <div className="flex items-center gap-2">
                  <select
                    aria-label="Document kind"
                    value={uploadKind}
                    onChange={e => setUploadKind(e.target.value as HrEmployeeFileKind)}
                    className="px-2 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-mono text-slate-700"
                  >
                    {VAULT_KINDS.map(k => <option key={k} value={k}>{HR_EMPLOYEE_FILE_KIND_LABEL[k]}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!employeeKey || uploading}
                    onClick={() => docInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-mono font-bold border border-blue-200 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploading ? 'Uploading…' : 'Upload Documents from Computer'}</span>
                  </button>
                </div>

                <input
                  ref={docInputRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  onChange={handleDocumentUpload}
                  className="hidden"
                />
              </div>
              <p className="text-[10px] font-mono text-slate-400">PDF, JPG, PNG, Word (.docx) or e-mail (.eml), up to 5 MB each. Visible only to HR and to the employee.</p>
              {filesError && <p role="alert" className="text-xs text-rose-600">{filesError}</p>}

              {files.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {files.map(doc => (
                    <div key={doc.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                        <div className="truncate">
                          <span className="font-semibold text-slate-900 block truncate">{doc.fileName}</span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {HR_EMPLOYEE_FILE_KIND_LABEL[doc.kind]} · Uploaded: {doc.createdAt.slice(0, 10)}{doc.uploadedBy ? ` by ${doc.uploadedBy}` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* PREVIEW BUTTON */}
                        <button
                          type="button"
                          onClick={() => openFile(doc, 'view')}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-mono font-bold flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Preview</span>
                        </button>

                        {/* DOWNLOAD BUTTON */}
                        <button
                          type="button"
                          onClick={() => openFile(doc, 'download')}
                          className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono font-bold flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download</span>
                        </button>

                        <button
                          type="button"
                          aria-label={`Delete ${doc.fileName}`}
                          onClick={() => deleteFile(doc)}
                          className="p-1 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 text-rose-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2 text-center">
                  {filesLoading ? 'Loading documents…' : 'No document files uploaded yet. Click above to upload files from your computer.'}
                </p>
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
                      accept={FILE_ACCEPT}
                      onChange={e => { setLeaveMailFile(e.target.files?.[0] || null); setLeaveFormError(null); }}
                      aria-invalid={leaveFormError ? true : undefined}
                      className="text-xs font-mono"
                    />
                    {leaveMailFile && (
                      <span className="text-[11px] font-mono text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Attached: {leaveMailFile.name}</span>
                      </span>
                    )}
                  </div>
                  {leaveFormError ? <p role="alert" className="text-[11px] font-semibold text-rose-700" data-testid="leave-form-error">{leaveFormError}</p> : null}
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
                    disabled={leaveBusy}
                    className="px-4 py-1.5 rounded-xl bg-amber-600 text-white font-bold font-mono shadow-sm disabled:opacity-50"
                  >
                    {leaveBusy ? 'Saving…' : 'Submit Leave Request'}
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
                            <button
                              type="button"
                              disabled={!fileById(rec.mailFileId)}
                              onClick={() => { const f = fileById(rec.mailFileId); if (f) openFile(f, 'view'); }}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-blue-600 underline mt-0.5 disabled:text-slate-400 disabled:no-underline"
                            >
                              <Paperclip className="w-3 h-3" />
                              <span>{rec.mailAttachmentName}</span>
                            </button>
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
                  accept={FILE_ACCEPT}
                  onChange={e => { setCancelMailFile(e.target.files?.[0] || null); setCancelFormError(null); }}
                  aria-invalid={cancelFormError ? true : undefined}
                  className="text-xs font-mono pt-1"
                />
                {cancelFormError ? <p role="alert" className="text-[11px] font-semibold text-rose-700">{cancelFormError}</p> : null}
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
                  disabled={leaveBusy}
                  className="w-1/2 py-2 rounded-xl bg-rose-600 text-white font-bold font-mono shadow-sm disabled:opacity-50"
                >
                  {leaveBusy ? 'Saving…' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
