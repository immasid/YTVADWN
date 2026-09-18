import { useState, useEffect } from 'react';
import { Search, Clipboard, Loader2, AlertCircle, Cookie, Sparkles } from 'lucide-react';

interface UrlBarProps {
  url: string;
  setUrl: (url: string) => void;
  onInspect: () => void;
  isLoading: boolean;
  error: string | null;
  onOpenCookieModal: () => void;
  hasCookieConfigured: boolean;
}

export function UrlBar({
  url,
  setUrl,
  onInspect,
  isLoading,
  error,
  onOpenCookieModal,
  hasCookieConfigured,
}: UrlBarProps) {
  const [canPaste, setCanPaste] = useState(false);

  useEffect(() => {
    // Check if navigator clipboard is available
    if (typeof navigator !== 'undefined' && 'clipboard' in navigator && typeof navigator.clipboard.readText === 'function') {
      setCanPaste(true);
    }
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim().startsWith('http')) {
        setUrl(text.trim());
      }
    } catch {
      // Ignore clipboard permission errors gracefully
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && url.trim() && !isLoading) {
      onInspect();
    }
  };

  const isBotOr429Error = error && (
    error.toLowerCase().includes('bot') ||
    error.toLowerCase().includes('429') ||
    error.toLowerCase().includes('sign in') ||
    error.toLowerCase().includes('confirm you’re not')
  );

  return (
    <div className="space-y-3">
      {/* Input Bar */}
      <div className="relative flex items-center gap-2 p-1.5 bg-[#0e1424] border border-slate-700/80 rounded-2xl shadow-xl focus-within:border-cyan-500/80 focus-within:ring-1 focus-within:ring-cyan-500/30 transition-all">
        <div className="pl-3.5 text-slate-400">
          <Search className="w-5 h-5 text-slate-400" />
        </div>

        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube video or music URL (e.g. https://www.youtube.com/watch?v=...)"
          className="flex-1 bg-transparent py-2.5 px-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />

        {canPaste && !url && (
          <button
            type="button"
            onClick={handlePaste}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
            title="Paste from clipboard"
          >
            <Clipboard className="w-3.5 h-3.5" />
            Paste
          </button>
        )}

        <button
          type="button"
          onClick={onOpenCookieModal}
          className={`p-2 rounded-xl text-xs font-medium transition-colors border ${
            hasCookieConfigured
              ? 'bg-amber-950/40 text-amber-300 border-amber-500/40'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800'
          }`}
          title={hasCookieConfigured ? 'Cookies Loaded' : 'Configure Cookies for bot bypass'}
        >
          <Cookie className="w-4 h-4" />
        </button>

        <button
          type="button"
          disabled={!url.trim() || isLoading}
          onClick={onInspect}
          className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>Inspecting...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-cyan-200" />
              <span>Inspect Manifest</span>
            </>
          )}
        </button>
      </div>

      {/* Error Alert Banner with Cookie loading CTA */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs flex items-start justify-between gap-3 animate-in fade-in">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Manifest Extraction Failed</span>
              <p className="text-slate-300 leading-relaxed">{error}</p>
            </div>
          </div>

          {isBotOr429Error && (
            <button
              onClick={onOpenCookieModal}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-white text-xs font-medium border border-rose-600/50 flex items-center gap-1.5 transition-colors"
            >
              <Cookie className="w-3.5 h-3.5 text-amber-300" />
              Load Cookies
            </button>
          )}
        </div>
      )}
    </div>
  );
}
