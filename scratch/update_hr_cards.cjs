const fs = require('fs');
const path = 'c:/Users/Shreya/Desktop/wabastore-sales-os-uiux-improved/src/components/departments/hr/HRDepartmentPanel.tsx';

let content = fs.readFileSync(path, 'utf8');

const oldCardsRegex = /\{\/\* 6\. Award Management \*\/\}[\s\S]*?\{\/\* 9\. Project Management \*\/\}[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;

const newCards = `{/* 6. Award & Celebrations Management */}
                <div 
                  onClick={() => setActiveModule('awards')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-amber-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Award className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Recognition &amp; Milestones
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-700 transition-colors mt-3">
                      Award Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      Upcoming birthdays, work anniversaries, monthly top performers &amp; honors
                    </p>

                    {/* Upcoming Celebrations Ticker */}
                    <div className="mt-3.5 p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/70 space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between text-amber-900 font-bold truncate">
                        <span className="flex items-center gap-1 truncate">
                          <Cake className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span className="truncate">Birthday: Kavya Nair</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-950 font-bold shrink-0">In 4 Days</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-700 text-[11px] pt-1 border-t border-amber-200/50 truncate">
                        <span className="flex items-center gap-1 truncate">
                          <PartyPopper className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="truncate">1-Yr Anniv: Alexander Wright</span>
                        </span>
                        <span className="text-[10px] text-indigo-700 font-bold shrink-0">In 7 Days</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleWishBirthday('Kavya Nair', 'CEL-1'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <Cake className="w-3.5 h-3.5 text-amber-600" />
                        <span>Wish Birthday</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('awards'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <Award className="w-3.5 h-3.5 text-slate-500" />
                        <span>Milestones</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-amber-700 transition-colors">
                      <span>Open Workspace</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>

                {/* 7. Offer Letter Management */}
                <div 
                  onClick={() => setActiveModule('offer_letter')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <FileCheck2 className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        7-Page Automation
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition-colors mt-3">
                      Offer Letter Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      Automated candidate offer generation, CTC breakdown, appointment terms &amp; PDF
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-blue-700 font-bold">Auto CTC Structuring</span>
                      <span className="text-[11px] text-slate-400">PDF Ready</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('offer_letter'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                        <span>Generate Offer</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('offer_letter'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>Templates</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-blue-700 transition-colors">
                      <span>Open Workspace</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>

                {/* 8. Experience Letter Management */}
                <div 
                  onClick={() => setActiveModule('experience_letter')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-purple-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Award className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        Relieving &amp; Service
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-purple-700 transition-colors mt-3">
                      Experience Letter Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      Relieving certificates, tenure calculation, conduct ratings &amp; digital signatures
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-purple-700 font-bold">Auto Tenure Calc</span>
                      <span className="text-[11px] text-slate-400">Official Seal</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('experience_letter'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <Award className="w-3.5 h-3.5 text-purple-600" />
                        <span>Issue Letter</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('experience_letter'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>Certificates</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-purple-700 transition-colors">
                      <span>Open Workspace</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>

                {/* 9. NDA (Non-Disclosure Agreement) Management */}
                <div 
                  onClick={() => setActiveModule('nda_letter')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-emerald-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Legal IP Protection
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-emerald-700 transition-colors mt-3">
                      NDA Letter Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      Automated non-disclosure covenants, trade secret protection &amp; staff binding
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-emerald-700 font-bold">100% Enforceable</span>
                      <span className="text-[11px] text-slate-400">Digital Binding</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('nda_letter'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Generate NDA</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveModule('nda_letter'); }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>Clauses</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-emerald-700 transition-colors">
                      <span>Open Workspace</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              </div>
            </div>`;

if (oldCardsRegex.test(content)) {
  content = content.replace(oldCardsRegex, newCards);
  fs.writeFileSync(path, content, 'utf8');
  console.log('SUCCESS: Replaced cards 6-9 in HRDepartmentPanel.tsx');
} else {
  console.error('ERROR: oldCardsRegex did not match');
}
