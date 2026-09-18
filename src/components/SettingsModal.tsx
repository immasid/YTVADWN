import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Key, Cookie, Globe, Check, Sliders } from 'lucide-react';
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

  const handleSave = async () => {
    await apiUpdateSessionSettings(settings);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm"
              />
            </Dialog.Overlay>

            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <Dialog.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 10 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col focus:outline-none"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/40">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 text-indigo-400 flex items-center justify-center">
                        <Sliders className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <Dialog.Title className="text-sm font-semibold text-zinc-100">
                          Session & Anti-Throttling Settings
                        </Dialog.Title>
                        <p className="text-xs text-zinc-400">
                          Ephemeral credentials and Proof-of-Origin bypass controls
                        </p>
                      </div>
                    </div>
                    <Dialog.Close asChild>
                      <button className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </Dialog.Close>
                  </div>

                  {/* Body */}
                  <div className="p-6 space-y-6 overflow-y-auto text-xs text-zinc-300">
                    {/* Privacy Banner */}
                    <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-700/30 text-cyan-200 text-xs flex items-start gap-3">
                      <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="font-semibold block text-zinc-100">Zero-Persistence Privacy Standard</span>
                        <p className="text-zinc-300 text-[11px] leading-relaxed">
                          PulseStream never stores raw cookie plaintext or user credentials permanently on disk.
                          Tokens are held strictly in-memory during active requests to resolve bot-challenges and 429
                          rate limits.
                        </p>
                      </div>
                    </div>

                    {/* 1. Cookie Extraction Mode */}
                    <div className="space-y-3">
                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
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
                            className={`py-2 px-3 rounded-lg border text-center text-xs transition-all ${
                              settings.cookieMode === mode
                                ? 'bg-indigo-950/60 border-indigo-500/80 text-zinc-100 font-semibold'
                                : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {settings.cookieMode === 'file' && (
                        <div className="space-y-1.5 pt-1">
                          <label className="text-[11px] text-zinc-400">Path to cookies.txt:</label>
                          <input
                            type="text"
                            value={settings.cookieFilePath || ''}
                            onChange={(e) => setSettings({ ...settings, cookieFilePath: e.target.value })}
                            placeholder="/home/user/cookies.txt"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      )}

                      {settings.cookieMode === 'browser' && (
                        <div className="space-y-1.5 pt-1">
                          <label className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-cyan-400" />
                            Select Installed Browser Profile:
                          </label>
                          <select
                            value={settings.browserName || 'chrome'}
                            onChange={(e) => setSettings({ ...settings, browserName: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:border-cyan-500 focus:outline-none"
                          >
                            <option value="chrome">Google Chrome</option>
                            <option value="firefox">Mozilla Firefox</option>
                            <option value="brave">Brave Browser</option>
                            <option value="edge">Microsoft Edge</option>
                            <option value="safari">Apple Safari</option>
                            <option value="chromium">Chromium</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* 2. PO-Token Anti-Throttling */}
                    <div className="space-y-3 pt-2 border-t border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                          <Key className="w-4 h-4 text-cyan-400" />
                          2. Proof-of-Origin (PO-Token)
                        </label>
                        <input
                          type="checkbox"
                          checked={settings.enablePoToken}
                          onChange={(e) => setSettings({ ...settings, enablePoToken: e.target.checked })}
                          className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-400 focus:ring-offset-zinc-950"
                        />
                      </div>

                      {settings.enablePoToken && (
                        <div className="space-y-1.5 pt-1 animate-in fade-in duration-200">
                          <label className="text-[11px] text-zinc-400">Custom PO-Token string:</label>
                          <input
                            type="text"
                            value={settings.poTokenValue || ''}
                            onChange={(e) => setSettings({ ...settings, poTokenValue: e.target.value })}
                            placeholder="Enter po_token value..."
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>

                    {/* 3. Custom Extractor Arguments */}
                    <div className="space-y-3 pt-2 border-t border-zinc-800/80">
                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                        3. Custom yt-dlp Extractor Arguments
                      </label>
                      <input
                        type="text"
                        value={settings.customExtractorArgs || ''}
                        onChange={(e) => setSettings({ ...settings, customExtractorArgs: e.target.value })}
                        placeholder="e.g. --extractor-args youtube:player_client=web"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:border-cyan-500 focus:outline-none"
                      />
                      <p className="text-[11px] text-zinc-500">
                        Passed safely to sidecar commands. Re-encoding flags (-c:v, -vf) are strictly disallowed by
                        backend audit.
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="p-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-end gap-2">
                    <Dialog.Close asChild>
                      <button className="px-4 py-2 text-xs font-medium rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
                        Cancel
                      </button>
                    </Dialog.Close>

                    <button
                      onClick={handleSave}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400 transition-colors flex items-center gap-1.5"
                    >
                      {saved ? (
                        <>
                          <Check className="w-4 h-4" />
                          Saved
                        </>
                      ) : (
                        'Save Configuration'
                      )}
                    </button>
                  </div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
