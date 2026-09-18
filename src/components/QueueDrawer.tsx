import { useState, useEffect } from 'react';
import {
  X,
  Play,
  Pause,
  Trash2,
  FolderOpen,
  ShieldCheck,
  Ban,
  Clock,
  CheckCircle2,
  DownloadCloud,
  Film,
  Music,
} from 'lucide-react';
import { QueueJob, VerificationResult } from '../types/media';
import {
  apiGetQueueItems,
  apiCancelJob,
  apiPauseQueue,
  apiResumeQueue,
  apiClearCompletedJobs,
  apiShowInFolder,
  listenQueueUpdated,
  formatBytes,
  formatSpeed,
  formatDuration,
} from '../services/tauriBridge';

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onViewVerification?: (result: VerificationResult) => void;
}

export function QueueDrawer({ isOpen, onClose, onViewVerification }: QueueDrawerProps) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [isPaused, setIsPaused] = useState(false);

  const fetchQueue = async () => {
    try {
      const items = await apiGetQueueItems();
      setJobs(items);
    } catch (err) {
      console.error('Failed to load queue items', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchQueue();
      let unlisten: (() => void) | undefined;
      listenQueueUpdated(() => fetchQueue()).then((u) => {
        unlisten = u;
      });
      return () => {
        if (unlisten) unlisten();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeJobs = jobs.filter((j) => j.status === 'active');
  const queuedJobs = jobs.filter((j) => j.status === 'queued');
  const historyJobs = jobs.filter(
    (j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled'
  );

  const handlePauseResume = async () => {
    if (isPaused) {
      await apiResumeQueue();
      setIsPaused(false);
    } else {
      await apiPauseQueue();
      setIsPaused(true);
    }
    fetchQueue();
  };

  const handleCancel = async (jobId: string) => {
    await apiCancelJob(jobId);
    fetchQueue();
  };

  const handleClearCompleted = async () => {
    await apiClearCompletedJobs();
    fetchQueue();
  };

  const handleShowInFolder = async (path: string | null | undefined) => {
    if (path) {
      await apiShowInFolder(path);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 flex justify-end">
      <div className="w-full max-w-lg bg-[#0b0f19] border-l border-slate-800 shadow-2xl h-full flex flex-col justify-between">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-950/70 border border-cyan-500/40 text-cyan-400 flex items-center justify-center">
              <DownloadCloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Download Manager & Queue
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 font-bold border border-slate-700">
                  {activeJobs.length + queuedJobs.length} Active
                </span>
              </h3>
              <p className="text-xs text-slate-400">Concurrency limited to 2 parallel stream fetches</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePauseResume}
              className={`px-2.5 py-1 text-xs rounded-lg border font-semibold flex items-center gap-1.5 transition-colors ${
                isPaused
                  ? 'bg-emerald-950/70 border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/70'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs text-slate-300">
          {/* Active Downloads Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                Active Downloads ({activeJobs.length})
              </span>
            </div>

            {activeJobs.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-slate-500">
                No downloads actively running
              </div>
            ) : (
              <div className="space-y-3">
                {activeJobs.map((j) => {
                  const isVideo = j.request.mode === 'video';
                  return (
                    <div
                      key={j.id}
                      className="p-4 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-3 shadow-lg shadow-cyan-950/20 ring-1 ring-cyan-500/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                            {isVideo ? <Film className="w-4 h-4 text-cyan-400" /> : <Music className="w-4 h-4 text-indigo-400" />}
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white line-clamp-1">
                              {j.request.title || 'YouTube Stream'}
                            </h4>
                            <p className="text-[10px] text-slate-400 font-mono">
                              Format: {j.request.videoFormatId ? `Video ${j.request.videoFormatId}` : 'Audio Only'}
                              {j.request.audioFormatId ? ` + Audio ${j.request.audioFormatId}` : ' (Muted)'} • .{j.request.targetContainer}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleCancel(j.id)}
                          className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-rose-400 transition-colors"
                          title="Cancel Download & Clean Disk"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-cyan-300 font-bold capitalize">
                            {j.progress.phase} ({j.progress.stream})
                          </span>
                          <span className="text-white font-bold">{j.progress.percent.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(j.progress.percent, 3)}%` }}
                          />
                        </div>
                      </div>

                      {/* Speed & ETA */}
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                        <span>Speed: {formatSpeed(j.progress.speedBytesPerSec)}</span>
                        <span>
                          {formatBytes(j.progress.downloadedBytes)} / {formatBytes(j.progress.totalBytes)}
                        </span>
                        <span>ETA: {formatDuration(j.progress.etaSeconds)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Queued Downloads Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Queued Slots ({queuedJobs.length})
              </span>
            </div>

            {queuedJobs.length === 0 ? (
              <div className="p-3 rounded-xl border border-dashed border-slate-800 text-center text-slate-500 text-[11px]">
                No items waiting in queue
              </div>
            ) : (
              <div className="space-y-2">
                {queuedJobs.map((j, idx) => (
                  <div
                    key={j.id}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-mono font-bold text-slate-500">#{idx + 1}</span>
                      <div>
                        <h4 className="text-xs font-semibold text-white line-clamp-1">
                          {j.request.title || 'Queued Media Stream'}
                        </h4>
                        <span className="text-[10px] text-slate-400">Waiting for available download slot...</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleCancel(j.id)}
                      className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors"
                      title="Remove from queue"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History / Completed Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Completed & History ({historyJobs.length})
              </span>
              {historyJobs.length > 0 && (
                <button
                  onClick={handleClearCompleted}
                  className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {historyJobs.length === 0 ? (
              <div className="p-3 rounded-xl border border-dashed border-slate-800 text-center text-slate-500 text-[11px]">
                No completed downloads yet
              </div>
            ) : (
              <div className="space-y-2">
                {historyJobs.map((j) => {
                  const isSuccess = j.status === 'completed';
                  const isCancelled = j.status === 'cancelled';

                  return (
                    <div
                      key={j.id}
                      className={`p-3 rounded-xl border transition-all ${
                        isSuccess
                          ? 'bg-slate-900/60 border-slate-800'
                          : isCancelled
                          ? 'bg-slate-900/30 border-slate-800/60 opacity-60'
                          : 'bg-rose-950/20 border-rose-900/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-semibold text-white line-clamp-1">
                            {j.request.title || 'Completed Stream'}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            {isSuccess && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700/50 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" />
                                Verified Authentic
                              </span>
                            )}
                            {isCancelled && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                Cancelled
                              </span>
                            )}
                            {j.status === 'failed' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-700">
                                Failed
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400 font-mono uppercase">
                              .{j.request.targetContainer}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isSuccess && j.outputPath && (
                            <button
                              onClick={() => handleShowInFolder(j.outputPath)}
                              className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 flex items-center gap-1 transition-colors"
                              title="Show in File Manager"
                            >
                              <FolderOpen className="w-3 h-3 text-cyan-400" />
                              Folder
                            </button>
                          )}
                          {isSuccess && j.verification && onViewVerification && (
                            <button
                              onClick={() => onViewVerification(j.verification!)}
                              className="px-2 py-1 text-[11px] bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 rounded-lg border border-emerald-700/50 transition-colors"
                            >
                              Report
                            </button>
                          )}
                        </div>
                      </div>

                      {j.errorMessage && (
                        <div className="mt-2 text-[10px] text-rose-300 font-mono bg-rose-950/40 p-2 rounded border border-rose-900/40 break-all">
                          {j.errorMessage}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between text-[11px] text-slate-500">
          <span>PulseStream Native Background Queue</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
