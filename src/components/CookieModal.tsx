import { useState } from 'react';
import { Cookie, X, KeyRound, Check, FileText } from 'lucide-react';

interface CookieModalProps {
  isOpen: boolean;
  onClose: () => void;
  cookiePath: string;
  onSaveCookiePath: (path: string) => void;
}

export function CookieModal({ isOpen, onClose, cookiePath, onSaveCookiePath }: CookieModalProps) {
  const [localPath, setLocalPath] = useState(cookiePath);
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveCookiePath(localPath.trim());
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0b0f19] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Cookie className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Browser Cookies & Session Bypass</h3>
              <p className="text-xs text-slate-400">Overcomes YouTube bot verification & HTTP 429 rate limits</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl space-y-2 text-slate-300">
            <div className="flex items-center gap-2 font-medium text-amber-300">
              <KeyRound className="w-4 h-4 text-amber-400" />
              <span>When is a cookie file needed?</span>
            </div>
            <p className="leading-relaxed text-slate-400">
              YouTube occasionally challenges requests with <code className="text-cyan-300 font-mono">Sign in to confirm you’re not a bot (HTTP 429)</code> or age restrictions. Providing a Netscape-formatted <code className="text-cyan-300 font-mono">cookies.txt</code> allows PulseStream to download without interruption.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-slate-200 font-medium block">
              Cookie File Path (e.g. <span className="font-mono text-cyan-400">/home/user/cookies.txt</span>):
            </label>
            <div className="relative">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/path/to/cookies.txt"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-slate-400 space-y-1">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" /> Quick Guide:
            </span>
            <ul className="list-disc list-inside space-y-0.5 pl-1 text-[11px]">
              <li>Export cookies from Chrome/Firefox using extensions like <em>Get cookies.txt LOCALLY</em>.</li>
              <li>Save to your preferred folder and paste the absolute path above.</li>
              <li>PulseStream stores only the path locally; your credentials are never uploaded.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800 bg-slate-900/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isSaved
                ? 'bg-emerald-600 text-white'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20'
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : null}
            {isSaved ? 'Saved' : 'Save Cookie Path'}
          </button>
        </div>
      </div>
    </div>
  );
}
