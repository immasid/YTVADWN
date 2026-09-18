import { useState, useEffect } from 'react';
import { X, Shield, Key, Cookie, Globe, Check, AlertCircle } from 'lucide-react';
import { SessionSettings } from '../types/media';
import { apiGetSessionSettings, apiUpdateSessionSettings } from '../services/tauriBridge';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<SessionSettings>({
    cookieMode: 'none',
    cookieFilePath: null,
    browserName: 'chrome',
    enablePoToken: false,
    poTokenValue: null,
    customExtractorArgs: null,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      apiGetSessionSettings().then((s) => {
        setSettings(s);
      });
      setSaved(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    await apiUpdateSessionSettings(settings);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#0b0f19] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-950/70 border border-indigo-500/40 text-indigo-400 flex items-center justify-center">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Session Authentication & Anti-Throttling</h3>
              <p className="text-xs text-slate-400">Ephemeral cookie resolution and Proof-of-Origin controls</p>
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
        <div className="p-6 space-y-6 overflow-y-auto text-xs text-slate-300">
          {/* Privacy Banner */}
          <div className="p-4 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs flex items-start gap-3">
            <Shield className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block text-slate-100">Zero-Persistence Privacy Standard</span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                PulseStream never stores raw cookie plaintext or user credentials in any database or config file.
                Authentication tokens are utilized strictly in-memory during the active session to bypass bot-checks and 429 rate limits.
              </p>
            </div>
          </div>

          {/* 1. Cookie Extraction Mode */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Cookie className="w-4 h-4 text-amber-400" />
              1. Ephemeral Cookie Source
            </label>

            <div className="grid grid-cols-3 gap-2">
              {[
                { mode: 'none', label: 'No Cookies' },
                { mode: 'file', label: 'Exported File' },
                { mode: 'browser', label: 'Browser Profile' },
              ].map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSettings({ ...settings, cookieMode: mode as any })}
                  className={`py-2 px-3 rounded-lg border text-center transition-all ${
                    settings.cookieMode === mode
                      ? 'bg-indigo-950/70 border-indigo-500 text-white font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {settings.cookieMode === 'file' && (
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[11px] text-slate-400">Path to exported cookies.txt:</span>
                <input
                  type="text"
                  value={settings.cookieFilePath || ''}
                  onChange={(e) => setSettings({ ...settings, cookieFilePath: e.target.value })}
                  placeholder="/path/to/cookies.txt"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {settings.cookieMode === 'browser' && (
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[11px] text-slate-400">Extract ephemeral cookies from local browser:</span>
                <select
                  value={settings.browserName || 'chrome'}
                  onChange={(e) => setSettings({ ...settings, browserName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="chrome">Google Chrome</option>
                  <option value="firefox">Mozilla Firefox</option>
                  <option value="brave">Brave Browser</option>
                  <option value="edge">Microsoft Edge</option>
                  <option value="safari">Apple Safari</option>
                </select>
              </div>
            )}
          </div>

          {/* 2. PO-Token & Anti-Throttling */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                2. Proof-of-Origin (PO-Token) Provider
              </label>

              <button
                type="button"
                onClick={() => setSettings({ ...settings, enablePoToken: !settings.enablePoToken })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  settings.enablePoToken ? 'bg-emerald-500' : 'bg-slate-800'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    settings.enablePoToken ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {settings.enablePoToken && (
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[11px] text-slate-400">Custom PO-Token Value (GVS Token):</span>
                <input
                  type="text"
                  value={settings.poTokenValue || ''}
                  onChange={(e) => setSettings({ ...settings, poTokenValue: e.target.value })}
                  placeholder="e.g. MnQ2..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            <div className="space-y-1.5 pt-2">
              <span className="text-[11px] text-slate-400">Custom Extractor Arguments (Optional):</span>
              <input
                type="text"
                value={settings.customExtractorArgs || ''}
                onChange={(e) => setSettings({ ...settings, customExtractorArgs: e.target.value })}
                placeholder="e.g. --extractor-args youtube:player_client=web"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-900/50">
          <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
            Applied in-memory for active session
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-indigo-600/20"
            >
              {saved ? <Check className="w-3.5 h-3.5" /> : null}
              {saved ? 'Saved!' : 'Apply Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
