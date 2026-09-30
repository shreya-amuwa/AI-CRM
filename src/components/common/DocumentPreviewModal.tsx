import React from 'react';
import { X, Download, FileText, Eye, ZoomIn } from 'lucide-react';
import { UploadedDocument } from '../../types/amuwaHq';

interface DocumentPreviewModalProps {
  document: UploadedDocument | null;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ document, onClose }) => {
  if (!document) return null;

  const isImage = document.fileType?.startsWith('image/') || 
    /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(document.name) ||
    document.fileUrl.startsWith('data:image/');

  return (
    <div className="fixed inset-0 z-70 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-up border border-white/20 max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-heading text-white">{document.name}</h3>
              <span className="text-[10px] font-mono text-slate-400">Uploaded: {document.uploadedAt}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={document.fileUrl}
              download={document.name}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>

            <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Document Content View Area */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-100 flex items-center justify-center min-h-[350px]">
          {isImage ? (
            <div className="relative max-h-[60vh] max-w-full overflow-auto rounded-2xl border border-slate-300 shadow-md bg-white p-2">
              <img 
                src={document.fileUrl} 
                alt={document.name} 
                className="max-h-[55vh] w-auto object-contain rounded-xl mx-auto" 
              />
            </div>
          ) : (
            <div className="w-full h-[60vh] bg-white rounded-2xl border border-slate-300 shadow-md overflow-hidden flex flex-col items-center justify-center p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center">
                <FileText className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold font-heading text-slate-900">{document.name}</h4>
                <p className="text-xs text-slate-500 font-mono mt-1">PDF / Office Document Format</p>
              </div>
              <iframe
                src={document.fileUrl}
                title={document.name}
                className="w-full h-full rounded-xl border border-slate-200"
                onError={() => {}}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs font-mono text-slate-500">
          <span>Amuwa Corporation Document Viewer</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800"
          >
            Close Viewer
          </button>
        </div>

      </div>
    </div>
  );
};
