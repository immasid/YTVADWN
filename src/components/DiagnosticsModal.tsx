import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  X,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Download,
  ShieldCheck,
} from 'lucide-react';
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

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Healthy
          </span>
        );
      case 'missing':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-950/80 text-amber-300 border border-amber-700/60 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Missing
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-rose-950/80 text-rose-300 border border-rose-700/60 flex items-center gap-1">
            <XCircle className="w-3 h-3 text-rose-400" />
            Error
          </span>
        );
    }
  };

  const renderBinaryCard = (diag: BinaryDiagnostic, extraAction?: React.ReactNode) => {
    const isHealthy = diag.status === 'healthy';

    return (
      <div
        className={`p-3.5 rounded-xl border transition-all ${
          isHealthy
            ? 'bg-zinc-900/60 border-zinc-800'
            : diag.status === 'missing'
            ? 'bg-amber-950/20 border-amber-700/40'
            : 'bg-rose-950/20 border-rose-700/40'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-100 font-mono tracking-tight">{diag.name}</span>
              {renderStatusBadge(diag.status)}
            </div>
            <p className="text-[10px] text-zinc-400 font-mono mt-1 break-all">
              {diag.path || 'Not installed in managed directory or system PATH'}
            </p>
          </div>
          {extraAction}
        </div>

        {diag.version && (
          <div className="mt-2 pt-2 border-t border-zinc-800/80 text-[10px] font-mono text-cyan-400">
            Version: {diag.version}
          </div>
        )}

        {diag.details && (
          <div className="mt-1 text-[11px] text-emerald-400 flex items-center gap-1 font-sans">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{diag.details}</span>
          </div>
        )}

        {diag.errorMessage && (
          <div className="mt-2 p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-[10px] text-rose-300 font-mono">
            {diag.errorMessage}
          </div>
        )}
      </div>
    );
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
                  className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden focus:outline-none"
                >
                  {/* Header */}
                  <div className="p-5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-cyan-400">
                        <Activity className="w-4 h-4" />
                      </div>
                      <div>
                        <Dialog.Title className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                          System Runtime Diagnostics
                          {report && (
                            <span
                              className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${
                                report.allHealthy
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                                  : 'bg-amber-950 text-amber-300 border-amber-700/60'
                              }`}
                            >
                              {report.allHealthy ? 'All Systems Operational' : 'Action Recommended'}
                            </span>
                          )}
                        </Dialog.Title>
                        <p className="text-xs text-zinc-400">
                          Verification of bundled execution engines, codecs, and sidecars
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={fetchDiagnostics}
                        disabled={refreshing}
                        className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        title="Refresh status"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
                      </button>
                      <Dialog.Close asChild>
                        <button className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {loading ? (
                      <div className="p-8 text-center space-y-3">
                        <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
                        <p className="text-xs text-zinc-400 font-mono">Querying sidecar executables...</p>
                      </div>
                    ) : report ? (
                      <>
                        {/* 1. yt-dlp */}
                        {renderBinaryCard(
                          report.ytDlp,
                          onCheckYtDlpUpdate && (
                            <button
                              onClick={onCheckYtDlpUpdate}
                              className="px-2.5 py-1 text-[11px] rounded-lg bg-cyan-950/80 border border-cyan-700/60 text-cyan-300 font-medium hover:bg-cyan-900/80 transition-colors flex items-center gap-1.5 shrink-0"
                            >
                              <Download className="w-3 h-3" />
                              Update
                            </button>
                          )
                        )}

                        {/* 2. FFmpeg */}
                        {renderBinaryCard(report.ffmpeg)}

                        {/* 3. FFprobe */}
                        {renderBinaryCard(report.ffprobe)}

                        {/* 4. Deno */}
                        {renderBinaryCard(report.deno)}

                        {/* Zero-Transcoding Policy Badge */}
                        <div className="p-3.5 rounded-xl bg-gradient-to-r from-cyan-950/20 to-indigo-950/20 border border-cyan-800/30 flex items-start gap-3">
                          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                          <div className="text-[11px] text-zinc-300">
                            <span className="font-semibold text-zinc-100">Zero-Transcoding Policy Active:</span> FFmpeg
                            is pinned exclusively to <code className="font-mono text-cyan-300 font-semibold">-c copy</code>.
                            Dynamic re-encoding parameters (<code className="font-mono text-zinc-400">-crf</code>,{' '}
                            <code className="font-mono text-zinc-400">-b:v</code>,{' '}
                            <code className="font-mono text-zinc-400">-vf</code>) are blocked by policy audit.
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="p-4 rounded-xl border border-rose-800/40 bg-rose-950/20 text-rose-300 text-xs">
                        Failed to query system diagnostics.
                      </div>
                    )}
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
