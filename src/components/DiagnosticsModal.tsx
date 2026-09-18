import { useState, useEffect } from 'react';
import { Activity, X, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Terminal, Download, ShieldCheck } from 'lucide-react';
import { DiagnosticReport, BinaryDiagnostic } from '../types/media';
import { apiGetSystemDiagnostics } from '../services/tauriBridge';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckYtDlpUpdate?: () => void;
}

export function DiagnosticsModal({ isOpen, onClose, onCheckYtDlpUpdate }: DiagnosticsModalProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDiagnostics = async () => {
    setRefreshing(true);
    try {
      const data = await apiGetSystemDiagnostics();
      setReport(data);
    } catch (e) {
      console.error('Failed to load diagnostics', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Healthy
          </span>
        );
      case 'missing':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700/60 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Missing
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700/60 flex items-center gap-1">
            <XCircle className="w-3 h-3 text-rose-400" />
            Error
          </span>
        );
    }
  };

  const renderBinaryCard = (diag: BinaryDiagnostic, extraAction?: React.ReactNode) => {
    const isHealthy = diag.status === 'healthy';

    return (
      <div className={`p-4 rounded-xl border transition-all ${
        isHealthy
          ? 'bg-[#0d121f] border-slate-800'
          : diag.status === 'missing'
          ? 'bg-amber-950/20 border-amber-500/30'
          : 'bg-rose-950/20 border-rose-500/30'
      }`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white font-mono">{diag.name}</span>
              {renderStatusBadge(diag.status)}
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-1 break-all">
              {diag.path || 'Not installed in managed directory or PATH'}
            </p>
          </div>
          {extraAction}
        </div>

        {diag.version && (
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[11px] font-mono text-cyan-300">
            Version: {diag.version}
          </div>
        )}

        {diag.details && (
          <div className="mt-1.5 text-[11px] text-emerald-400 flex items-center gap-1.5 font-sans">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            {diag.details}
          </div>
        )}

        {diag.errorMessage && (
          <div className="mt-2 p-2.5 bg-rose-950/40 border border-rose-800/50 rounded-lg text-[11px] text-rose-300">
            {diag.errorMessage}
          </div>
        )}

        {diag.status === 'missing' && diag.name === 'deno' && (
          <div className="mt-2.5 p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-[11px]">
            <span className="text-slate-300 font-semibold block">Optional Helper Installation:</span>
            <p className="text-slate-400">Deno improves YouTube JS cipher evaluation. To install on Linux/macOS:</p>
            <code className="block bg-black/60 p-2 rounded text-cyan-300 font-mono select-all">
              curl -fsSL https://deno.land/install.sh | sh
            </code>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0b0f19] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-950/70 border border-cyan-500/40 text-cyan-400 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                System Diagnostics & Sidecar Health
                {report && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold border ${
                    report.allHealthy
                      ? 'bg-emerald-950 text-emerald-400 border-emerald-700/60'
                      : 'bg-amber-950 text-amber-400 border-amber-700/60'
                  }`}>
                    {report.allHealthy ? 'All Systems Operational' : 'Action Required'}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">Binary status check for yt-dlp, deno, ffmpeg, and ffprobe</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchDiagnostics}
              disabled={refreshing}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Refresh Diagnostics"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300">
          {loading ? (
            <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
              <span>Probing local execution runtimes...</span>
            </div>
          ) : report ? (
            <div className="space-y-4">
              {/* yt-dlp */}
              {renderBinaryCard(
                report.ytDlp,
                onCheckYtDlpUpdate ? (
                  <button
                    onClick={onCheckYtDlpUpdate}
                    className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Download className="w-3 h-3 text-cyan-400" />
                    Check Update
                  </button>
                ) : null
              )}

              {/* ffmpeg */}
              {renderBinaryCard(report.ffmpeg)}

              {/* ffprobe */}
              {renderBinaryCard(report.ffprobe)}

              {/* deno */}
              {renderBinaryCard(report.deno)}
            </div>
          ) : (
            <div className="p-4 text-center text-rose-400">Failed to load system diagnostic report.</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-900/50">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
            <Terminal className="w-3.5 h-3.5 text-slate-500" />
            Zero Transcoding Engine • Linux Runtime
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Close Diagnostics
          </button>
        </div>
      </div>
    </div>
  );
}
