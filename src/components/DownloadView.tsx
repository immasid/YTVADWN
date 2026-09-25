import { DownloadProgressPayload, VerificationResult, VideoTrack, AudioTrack } from '../types/media';
import { formatBytes, formatSpeed } from '../services/tauriBridge';
import { ShieldCheck, CheckCircle2, AlertTriangle, Layers, Download, Check, Sparkles } from 'lucide-react';

interface DownloadViewProps {
  progress: DownloadProgressPayload | null;
  isDownloading: boolean;
  verificationResult: VerificationResult | null;
  expectedVideo: VideoTrack | null;
  expectedAudio: AudioTrack | null;
  onOpenVerificationModal: () => void;
  onStartDownload: () => void;
  canStart: boolean;
  destinationPath: string;
}

export function DownloadView({
  progress,
  isDownloading,
  verificationResult,
  expectedVideo,
  expectedAudio,
  onOpenVerificationModal,
  onStartDownload,
  canStart,
  destinationPath,
}: DownloadViewProps) {
  const percent = progress?.percent || 0;
  const phase = progress?.phase || 'discovering';

  // Format phase text
  const phaseLabel = (p: string) => {
    switch (p) {
      case 'discovering':
        return 'Analyzing Stream Manifests';
      case 'downloading':
        return 'Fetching Pure Raw Streams';
      case 'remuxing':
        return 'Lossless Packaging (-c copy)';
      case 'verifying':
        return 'Verifying Bitstream Authenticity';
      case 'completed':
        return 'Lossless Extraction Completed';
      case 'failed':
        return 'Verification Discrepancy Detected';
      default:
        return 'Ready';
    }
  };

  const videoCodecStr = expectedVideo?.codec?.toUpperCase();
  const audioCodecStr = expectedAudio?.codec?.toUpperCase() || 'OPUS';
  const pairCodecLabel = videoCodecStr ? `${videoCodecStr} + ${audioCodecStr}` : audioCodecStr;

  return (
    <div className="glass-panel-glow rounded-2xl p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6">
      {/* Top Action / Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
            <Download className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400 shrink-0" />
            <span className="truncate">Direct Stream Extraction</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 truncate">
            Target Destination: <span className="font-mono text-cyan-300 break-all">{destinationPath}</span>
          </p>
        </div>

        <button
          type="button"
          disabled={!canStart || isDownloading}
          onClick={onStartDownload}
          className="w-full sm:w-auto px-6 py-3.5 sm:py-3 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-indigo-500 text-white rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0"
        >
          {isDownloading ? (
            <>
              <Layers className="w-4 h-4 animate-spin shrink-0" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-cyan-200 shrink-0" />
              <span>Start Lossless Extraction</span>
            </>
          )}
        </button>
      </div>

      {/* Real-time Progress & Stepper */}
      {(isDownloading || progress) && (
        <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between text-xs gap-2">
            <span className="font-medium text-slate-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              {phaseLabel(phase)}
            </span>

            <div className="flex items-center gap-4 text-slate-400 font-mono text-[11px]">
              {progress && progress.speedBytesPerSec > 0 && (
                <span>Speed: <strong className="text-cyan-300">{formatSpeed(progress.speedBytesPerSec)}</strong></span>
              )}
              {progress && progress.etaSeconds > 0 && (
                <span>ETA: <strong className="text-slate-200">{progress.etaSeconds}s</strong></span>
              )}
              {progress && progress.totalBytes > 0 && (
                <span>{formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}</span>
              )}
              <span className="text-sm font-bold text-cyan-400">{percent.toFixed(0)}%</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800 shadow-inner">
            <div
              className={`h-full transition-all duration-300 ${
                phase === 'failed'
                  ? 'bg-rose-500'
                  : 'bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Phase Stepper Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            {[
              { id: 'downloading', title: '1. Fetching Streams', sub: 'Direct YouTube DASH bitstream' },
              { id: 'remuxing', title: '2. Lossless Packaging', sub: '-c copy stream copy' },
              { id: 'verifying', title: '3. Verifying Authenticity', sub: 'Tier 1 audit + ffprobe' },
            ].map((step) => {
              const isCurrent = phase === step.id;
              const isDone = ['completed'].includes(phase) || (
                (step.id === 'downloading' && ['remuxing', 'verifying', 'completed'].includes(phase)) ||
                (step.id === 'remuxing' && ['verifying', 'completed'].includes(phase))
              );

              return (
                <div
                  key={step.id}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    isCurrent
                      ? 'bg-cyan-950/60 border-cyan-500/70 text-cyan-300 ring-1 ring-cyan-500/20'
                      : isDone && phase !== 'failed'
                      ? 'bg-slate-900/40 border-slate-800/80 text-emerald-400'
                      : 'bg-slate-950/40 border-slate-800/40 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{step.title}</span>
                    {isDone && phase !== 'failed' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{step.sub}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Authenticity Badge Banner */}
      {verificationResult && verificationResult.status === 'verified' && (
        <div
          onClick={onOpenVerificationModal}
          className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 hover:border-emerald-400 text-emerald-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-emerald-950/30 cursor-pointer transition-all hover:scale-[1.005]"
          title="Click to view detailed ffprobe verification report"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm text-white flex items-center gap-2">
                ✓ Authentic Bitstream Verified
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-300 font-semibold">
                  Codec: {pairCodecLabel}
                </span>
              </div>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                Zero transcoding detected. Stream copy certified (-c copy confirmed).
              </p>
            </div>
          </div>

          <button
            type="button"
            className="px-3.5 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-500/40 text-white text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Inspect ffprobe Data
          </button>
        </div>
      )}

      {/* Failure Banner */}
      {verificationResult && verificationResult.status === 'failed' && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/60 text-rose-200 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-white">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Verification Discrepancy Detected
          </div>
          <p className="text-slate-300 text-[11px] leading-relaxed">
            The downloaded artifact failed the two-tier authenticity verification audit. Intermediate stream fragments have been preserved at the failed temporary directory for inspection.
          </p>
          <pre className="p-2.5 bg-black/60 rounded-lg text-[10px] font-mono text-rose-300 overflow-x-auto">
            {verificationResult.details}
          </pre>
        </div>
      )}
    </div>
  );
}
