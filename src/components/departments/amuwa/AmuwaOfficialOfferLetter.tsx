import React, { useState } from 'react';
import { X, Printer, Send, Eye, ArrowLeft } from 'lucide-react';
import { OfferLetter } from '../../../types/amuwaHq';

interface AmuwaOfficialOfferLetterProps {
  onClose: () => void;
  onIssueOfferLetter?: (offer: OfferLetter) => void;
}

export const AmuwaOfficialOfferLetter: React.FC<AmuwaOfficialOfferLetterProps> = ({
  onClose,
  onIssueOfferLetter
}) => {
  // Input Form State matching the PDF
  const [salutation, setSalutation] = useState<'Miss.' | 'Mr.' | 'Mrs.'>('Miss.');
  const [candidateName, setCandidateName] = useState('Shrushti Gole');
  const [candidateEmail, setCandidateEmail] = useState('shrushti.gole@example.com');
  const [candidatePhone, setCandidatePhone] = useState('+91 9359 734 757');
  const [designation, setDesignation] = useState('AI Video Editor');
  const [refNumber, setRefNumber] = useState('AMU/AL/2026/34');
  const [letterDate, setLetterDate] = useState('10th August 2026');
  const [joiningDate, setJoiningDate] = useState('10th July 2026');
  const [stipendAmount, setStipendAmount] = useState('₹10,000/-');
  const [stipendWords, setStipendWords] = useState('Rupees Ten Thousand Only');
  const [hrSignatoryName, setHrSignatoryName] = useState('Miss. Aarti Kalange');
  
  // Roles & Responsibilities list
  const [responsibilitiesText, setResponsibilitiesText] = useState(
    "• Create and edit AI-powered videos.\n• Develop reels, promotional videos, and social media content.\n• Use AI tools for visuals, voiceovers, effects, and animations.\n• Convert scripts and ideas into engaging videos.\n• Maintain daily sales reports, lead status, and follow-up records\n• Add captions, music, transitions, and branding.\n• Coordinate with the Amuwa Design Studio and Marketing teams.\n• Stay updated with the latest AI video generation and editing tools and trends."
  );

  const [dutiesOverview, setDutiesOverview] = useState(
    "creating and editing engaging video content using AI-powered tools and technologies, supporting the company's digital marketing and social media initiatives, and delivering high-quality creative content as per business requirements.."
  );

  const [activeTab, setActiveTab] = useState<'form' | 'document'>('document');

  // Trigger Print to PDF
  const handlePrint = () => {
    window.print();
  };

  const handleIssue = () => {
    if (onIssueOfferLetter) {
      const newOffer: OfferLetter = {
        id: refNumber,
        candidateName: `${salutation} ${candidateName}`,
        candidateEmail,
        candidatePhone,
        designation,
        departmentName: 'Amuwa Corporation',
        monthlySalary: stipendAmount,
        annualCTC: '₹1.2 LPA',
        joiningDate,
        workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
        generatedAt: new Date().toISOString(),
        status: 'Issued'
      };
      onIssueOfferLetter(newOffer);
    }
    onClose();
  };

  const responsibilitiesList = responsibilitiesText
    .split('\n')
    .map(line => line.trim().replace(/^•\s*/, ''))
    .filter(Boolean);

  // EXACT HEADER IMAGE SUPPLIED BY USER
  const ExactHeaderImage = () => (
    <div className="w-full mb-6 select-none pointer-events-none">
      <img 
        src="/letterhead/header.png" 
        alt="Amuwa Corporation Letterhead Header" 
        className="w-full h-auto object-contain max-h-44 mx-auto" 
      />
    </div>
  );

  // EXACT FOOTER IMAGE SUPPLIED BY USER
  const ExactFooterImage = ({ pageNum }: { pageNum: string }) => (
    <div className="w-full mt-8 select-none pointer-events-none relative">
      <img 
        src="/letterhead/footer.png" 
        alt="Amuwa Corporation Letterhead Footer" 
        className="w-full h-auto object-contain max-h-36 mx-auto" 
      />
      {/* Page Number Overlay if needed */}
      <div className="absolute bottom-2 right-4 text-[11px] font-bold font-mono text-slate-900 bg-white/90 px-2 py-0.5 rounded">
        {pageNum}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[96vh] flex flex-col my-auto">
        
        {/* Top Control Header Bar */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab(activeTab === 'form' ? 'document' : 'form')}
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-all"
            >
              {activeTab === 'form' ? <Eye className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              <span>{activeTab === 'form' ? 'View Document Preview' : 'Edit Candidate Fields'}</span>
            </button>
            <span className="text-xs font-mono text-slate-300 hidden sm:inline">
              Official Amuwa Corporation Appointment Letter (Exact Header &amp; Footer Images)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save as PDF</span>
            </button>

            <button
              type="button"
              onClick={handleIssue}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95"
            >
              <Send className="w-4 h-4" />
              <span>Issue &amp; Save Letter</span>
            </button>

            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Main Area */}
        <div className="flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-8">
          
          {/* TAB 1: FORM INPUTS MODE */}
          {activeTab === 'form' && (
            <div className="max-w-2xl mx-auto bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4 text-xs font-sans">
              <h3 className="text-lg font-bold font-heading text-slate-900">Configure Appointment Letter Candidate Details</h3>
              <p className="text-slate-500 font-mono">Fill in candidate details to dynamically generate the middle portion of the letter.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">SALUTATION</label>
                  <select
                    value={salutation}
                    onChange={e => setSalutation(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="Miss.">Miss.</option>
                    <option value="Mr.">Mr.</option>
                    <option value="Mrs.">Mrs.</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CANDIDATE FULL NAME *</label>
                  <input
                    type="text"
                    value={candidateName}
                    onChange={e => setCandidateName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CANDIDATE EMAIL</label>
                  <input
                    type="email"
                    value={candidateEmail}
                    onChange={e => setCandidateEmail(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CANDIDATE PHONE</label>
                  <input
                    type="text"
                    value={candidatePhone}
                    onChange={e => setCandidatePhone(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">DESIGNATION / ROLE *</label>
                  <input
                    type="text"
                    value={designation}
                    onChange={e => setDesignation(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">REF NUMBER</label>
                  <input
                    type="text"
                    value={refNumber}
                    onChange={e => setRefNumber(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">LETTER DATE</label>
                  <input
                    type="text"
                    value={letterDate}
                    onChange={e => setLetterDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">DATE OF JOINING (DOJ)</label>
                  <input
                    type="text"
                    value={joiningDate}
                    onChange={e => setJoiningDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">STIPEND / SALARY AMOUNT</label>
                  <input
                    type="text"
                    value={stipendAmount}
                    onChange={e => setStipendAmount(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">AMOUNT IN WORDS</label>
                  <input
                    type="text"
                    value={stipendWords}
                    onChange={e => setStipendWords(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-sans"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">DUTIES OVERVIEW SUMMARY</label>
                <textarea
                  rows={2}
                  value={dutiesOverview}
                  onChange={e => setDutiesOverview(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-sans"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">ROLES &amp; RESPONSIBILITIES (BULLET LIST)</label>
                <textarea
                  rows={6}
                  value={responsibilitiesText}
                  onChange={e => setResponsibilitiesText(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                />
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('document')}
                className="w-full py-3 rounded-2xl bg-slate-900 text-white font-mono font-bold text-xs shadow-md hover:bg-slate-800"
              >
                Generate Document Preview &rarr;
              </button>
            </div>
          )}

          {/* TAB 2: EXACT 7-PAGE DOCUMENT PREVIEW MODE (WITH INCREASED FONT SIZES) */}
          {activeTab === 'document' && (
            <div className="max-w-4xl mx-auto space-y-8 print:p-0 print:m-0 print:max-w-none print:shadow-none">
              
              {/* PAGE 1: APPOINTMENT LETTER MAIN */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  {/* Ref & Date */}
                  <div className="flex items-center justify-between font-sans text-sm sm:text-base font-bold text-slate-900 my-6">
                    <span>REF NO: {refNumber}</span>
                    <span>Date:{letterDate}</span>
                  </div>

                  {/* Document Title */}
                  <h2 className="text-2xl font-black font-heading tracking-wider text-center uppercase text-slate-950 mb-6">
                    APPOINTMENT LETTER
                  </h2>

                  {/* Body Paragraph */}
                  <p className="mb-5 text-base sm:text-lg text-slate-800 leading-relaxed">
                    We are pleased to appoint <strong>{salutation} {candidateName}</strong> as <strong>{designation}</strong> with Amuwa Corporation, effective from <strong>{joiningDate}</strong>, on the following terms and conditions:
                  </p>

                  <div className="space-y-5 text-sm sm:text-base text-slate-800">
                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">1. Designation</h4>
                      <p className="leading-relaxed">You are appointed as <strong>{designation}</strong>. Your duties will include {dutiesOverview}</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">2. Date of Joining</h4>
                      <p>Your Date of Joining (DOJ) shall be <strong>{joiningDate}</strong>.</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">3. Stipend</h4>
                      <p>
                        You will be paid a consolidated stipend of <strong>{stipendAmount}</strong> ({stipendWords}) per month. Stipend shall be paid monthly, subject to statutory deductions and company policies.
                      </p>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg mb-2">4. Roles &amp; Responsibilities:</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        {responsibilitiesList.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="1/7" />
              </div>

              {/* PAGE 2: TERMS AND CONDITIONS */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  <div className="space-y-5 text-sm sm:text-base text-slate-800">
                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">5. Probation Period</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>You will be on probation for a period of six (6) months from your date of joining.</li>
                        <li>Your confirmation after probation shall depend upon satisfactory performance, discipline, attendance, and management approval. (Refer– Annexure A )</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">6. Working Hours &amp; Attendance</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>You shall follow the official office timings and maintain punctuality. Attendance, late marks, half-day deductions, and discipline rules shall be applicable as per Company Policy. (Refer–Annexure A )</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">7. Leave Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Your leave entitlement, paid leave rules, leave without pay, sandwich leave, encashment, and approval process shall be governed strictly as per Company Policy. (Refer– Annexure A )</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">8. Increment / Incentive</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Any salary increment, bonus, incentive, or performance reward shall be entirely based on management discretion and performance review. (Refer– Annexure A )</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">9. Confidentiality</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>You shall maintain complete confidentiality regarding client data, passwords, pricing, creative files, leads, internal processes, and business information.</li>
                        <li>Any breach shall invite disciplinary/legal action. (Refer– Annexure A )</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">10. Company Assets</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Any company equipment, software login, mobile, laptop, camera, accessories, or tools issued to you must be handled responsibly and returned upon separation.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">11. Transfer / Additional Duties</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>The company reserves the right to assign additional responsibilities or modify job duties based on business requirements.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">12. Termination / Separation</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Your employment may be terminated by either side by serving notice period as applicable (Refer– Annexure A ).</li>
                        <li>Full &amp; Final Settlement shall be subject to handover of work, assets, passwords, and pending dues.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="2/7" />
              </div>

              {/* PAGE 3: ACCEPTANCE & SIGNATURES */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  <div className="space-y-6 text-sm sm:text-base text-slate-800">
                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">13. Acceptance</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Please sign and return a copy of this letter as a token of your acceptance of the above terms.</li>
                      </ul>
                    </div>

                    <p className="text-base font-semibold text-slate-900">
                      We welcome you to <strong>Amuwa Corporation</strong> and wish you a successful career with us.
                    </p>

                    {/* HR Signatory Block */}
                    <div className="pt-6 space-y-2">
                      <p className="font-bold text-slate-900">Regards,</p>
                      <p className="font-bold text-slate-950 text-base">Amuwa Corporation</p>
                      <p className="font-bold text-slate-900">{hrSignatoryName}</p>
                      <div className="pt-2 font-mono">
                        Signature: ___________________________
                      </div>
                    </div>

                    {/* Employee Acceptance Block */}
                    <div className="pt-8 border-t border-slate-200 space-y-4">
                      <h4 className="font-bold text-slate-950 text-base uppercase font-heading">Employee Acceptance</h4>
                      <p className="text-base">
                        I, <strong>{candidateName}</strong> accept the above appointment terms and agree to follow company rules.
                      </p>

                      <div className="space-y-3 pt-2 font-mono text-sm sm:text-base">
                        <div>Employee Signature: ___________________________</div>
                        <div>Name: ___________________________</div>
                        <div>Date: ___________________________</div>
                      </div>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="3/7" />
              </div>

              {/* PAGE 4: ANNEXURE A - POLICIES PART 1 */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  <h3 className="text-lg sm:text-xl font-black font-heading uppercase text-center text-slate-950 mb-6">
                    ANNEXURE A – Company Policies (Part of Appointment Letter)
                  </h3>

                  <div className="space-y-5 text-sm sm:text-base text-slate-800">
                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">1. Leave Policy</h4>
                      <p className="italic text-slate-600">Purpose This policy outlines the leave structure applicable to employees of the company and ensures consistency, transparency, and fairness in leave management.</p>
                      
                      <div className="mt-3 space-y-3">
                        <h5 className="font-bold text-slate-900">Probation Period</h5>
                        <ul className="list-disc pl-6 space-y-1.5">
                          <li>All newly hired employees will be on probation for six (6) months from their date of joining.</li>
                          <li>During this period, employees’ performance, attendance, discipline, and suitability for permanent employment will be evaluated.</li>
                          <li>If total leaves / absenteeism during probation is 15 days or more, probation will be extended by one (1) month.</li>
                        </ul>

                        <h5 className="font-bold text-slate-900">Leave During Probation</h5>
                        <ul className="list-disc pl-6 space-y-1.5">
                          <li>No paid leave during probation.</li>
                          <li>Any leave availed will be treated as Leave Without Pay (LWP).</li>
                          <li>Excessive absenteeism may impact confirmation.</li>
                        </ul>

                        <h5 className="font-bold text-slate-900">Confirmation</h5>
                        <ul className="list-disc pl-6 space-y-1.5">
                          <li>Upon successful completion of probation, employees may be confirmed subject to satisfactory performance and management approval.</li>
                        </ul>

                        <h5 className="font-bold text-slate-900">Leave After Confirmation</h5>
                        <ul className="list-disc pl-6 space-y-1.5">
                          <li>Confirmed employees are entitled to two (2) paid leaves per month.</li>
                          <li>Paid leave is credited monthly.</li>
                          <li>If absenteeism in a particular month is more than 10 days, only one (1) paid leave will be credited for that month.</li>
                        </ul>

                        <h5 className="font-bold text-slate-900">Carry Forward Rule</h5>
                        <ul className="list-disc pl-6 space-y-1.5">
                          <li>No leaves will be carried forward to the next calendar year.</li>
                          <li>Any leave balance more than 50% of total yearly entitled leaves will automatically lapse.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="4/7" />
              </div>

              {/* PAGE 5: ANNEXURE A - POLICIES PART 2 */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  <div className="space-y-5 text-sm sm:text-base text-slate-800">
                    <div>
                      <h5 className="font-bold text-slate-900">Leave Encashment</h5>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Up to 50% of total yearly entitled paid leaves may be eligible for encashment.</li>
                        <li>Encashment shall be processed annually or during Full &amp; Final Settlement, subject to management approval.</li>
                      </ul>
                    </div>

                    <div>
                      <h5 className="font-bold text-slate-900">Sandwich Leave Policy</h5>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>If an employee remains absent immediately before and after weekly off / public holiday without approval, intervening holiday(s) may be counted as leave.</li>
                        <li>Applicability shall be subject to management review.</li>
                      </ul>
                    </div>

                    <div>
                      <h5 className="font-bold text-slate-900">Leave Approval Process</h5>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Planned leaves must be applied in advance and approved by reporting manager.</li>
                        <li>Leave requests are subject to work requirements.</li>
                      </ul>
                    </div>

                    <div>
                      <h5 className="font-bold text-slate-900">Emergency Leave</h5>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Employees must inform the reporting manager at the earliest possible time. Such requests will be reviewed case-by-case.</li>
                      </ul>
                    </div>

                    <div>
                      <h5 className="font-bold text-slate-900">General Conditions</h5>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Unauthorized absence may lead to disciplinary action.</li>
                        <li>Habitual absenteeism may affect increment, incentives, confirmation, or continuation.</li>
                        <li>Company reserves the right to amend this policy.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg mt-4">2. Increment Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Salary increments are performance-based and not automatic.</li>
                        <li>The increment will take place annually.</li>
                        <li>Performance, discipline, attendance, quality of work, and contribution will be considered.</li>
                        <li>Employees with poor attendance or warnings may not be eligible.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="5/7" />
              </div>

              {/* PAGE 6: ANNEXURE A - POLICIES PART 3 */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  <div className="space-y-5 text-sm sm:text-base text-slate-800">
                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">3. Bonus / Incentive Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Incentives / bonuses may be monthly, quarterly, yearly, or project-based.</li>
                        <li>Incentives depend on targets, punctuality, productivity, revenue generation, and client satisfaction.</li>
                        <li>Incentives are not part of fixed salary.</li>
                        <li>Final decision remains with management.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">4. Code of Conduct Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Maintain professionalism, discipline, punctuality, and respectful behavior.</li>
                        <li>Misconduct or misuse of company reputation/data may invite action.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">5. Attendance &amp; Working Hours Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Employees must follow official office timings.</li>
                        <li>Repeated late coming or attendance issues may lead to deductions or disciplinary action.</li>
                        <li>Late marks beyond three (3) in a month will lead to one half-day present / deduction as per payroll policy.</li>
                        <li>Attendance must be maintained through approved system/register.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">6. Confidentiality Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Company data, passwords, client information, pricing, creatives, leads, and internal systems are confidential.</li>
                        <li>Unauthorized sharing may lead to termination and legal action.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="6/7" />
              </div>

              {/* PAGE 7: ANNEXURE A - POLICIES PART 4 & DECLARATION */}
              <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-2xl space-y-6 text-slate-900 font-sans text-sm sm:text-base leading-relaxed print:rounded-none print:border-none print:shadow-none min-h-[1100px] flex flex-col justify-between">
                <div>
                  <ExactHeaderImage />

                  <div className="space-y-5 text-sm sm:text-base text-slate-800">
                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">7. Asset / Equipment Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Company-issued laptop, mobile, camera, accessories, SIM, software login, or other assets must be used responsibly.</li>
                        <li>Damage due to negligence may be recovered from employee.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-950 font-heading text-base sm:text-lg">8. Separation / Notice Period Policy</h4>
                      <ul className="list-disc pl-6 space-y-1.5">
                        <li>Employees must serve notice period as mentioned Below.</li>
                        <li>During Probition Period –5 Day’s</li>
                        <li>After Confirmation– 2 Months</li>
                        <li>Pending dues, assets handover, and work handover are mandatory before Full &amp; Final Settlement.</li>
                      </ul>
                    </div>

                    {/* Declaration Block */}
                    <div className="pt-6 border-t border-slate-200 space-y-4">
                      <h4 className="font-bold text-slate-950 text-base uppercase font-heading">Declaration</h4>
                      <p className="text-sm sm:text-base">
                        I <strong>{candidateName}</strong> have read, understood, and agreed to abide by the above <strong>Annexure A policies</strong>.
                      </p>

                      <div className="space-y-3 pt-2 font-mono text-sm sm:text-base">
                        <div>Employee Signature: ___________________________</div>
                        <div>Name: ___________________________</div>
                        <div>Date: ___________________________</div>
                      </div>

                      <div className="pt-6 space-y-2">
                        <p className="font-bold text-slate-950">For Amuwa Corporation</p>
                        <p className="font-bold text-slate-900">{hrSignatoryName}</p>
                        <div className="pt-2 font-mono">
                          Signature: ___________________________
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <ExactFooterImage pageNum="7/7" />
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
};
