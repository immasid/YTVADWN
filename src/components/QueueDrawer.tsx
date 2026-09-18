import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tabs from '@radix-ui/react-tabs';
import * as Progress from '@radix-ui/react-progress';
import {
  X,
  Play,
  Pause,
  Trash2,
  FolderOpen,
  ShieldCheck,
  Ban,
  Clock,
  DownloadCloud,
  Film,
  Music,
  History as HistoryIcon,
  Layers,
} from 'lucide-react';
import { QueueJob, VerificationResult, HistoryRecord } from '../types/media';
import {
  apiGetQueueItems,
  apiCancelJob,
  apiPauseQueue,
  apiResumeQueue,
  apiClearCompletedJobs,
  apiShowInFolder,
  apiGetHistory,
  apiClearHistory,
  apiDeleteHistoryItem,
  listenQueueUpdated,
  listenHistoryUpdated,
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
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'audio'>('all');

  const fetchQueue = async () => {
    try {
      const items = await apiGetQueueItems();
      setJobs(items);
    } catch (err) {
      console.error('Failed to load queue items', err);
    }
  };

  const fetchHistory = async () => {
    try {
      const records = await apiGetHistory();
      setHistory(records);
    } catch (err) {
      console.error('Failed to load history', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchQueue();
      fetchHistory();

      let unlistenQueue: (() => void) | undefined;
      let unlistenHistory: (() => void) | undefined;

      listenQueueUpdated(() => fetchQueue()).then((u) => {
        unlistenQueue = u;
      });

      listenHistoryUpdated(() => fetchHistory()).then((u) => {
        unlistenHistory = u;
      });

      return () => {
        if (unlistenQueue) unlistenQueue();
        if (unlistenHistory) unlistenHistory();
      };
    }
  }, [isOpen]);

  const activeJobs = jobs.filter((j) => j.status === 'active');
  const queuedJobs = jobs.filter((j) => j.status === 'queued');

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

  const handleClearHistory = async () => {
    await apiClearHistory();
    fetchHistory();
  };

  const handleDeleteHistoryItem = async (id: string) => {
    await apiDeleteHistoryItem(id);
    fetchHistory();
  };

  const handleShowInFolder = async (path: string | null | undefined) => {
    if (path) {
      await apiShowInFolder(path);
    }
  };

  const filteredHistory = history.filter((rec) => {
    if (mediaFilter === 'all') return true;
    return rec.mediaType.toLowerCase() === mediaFilter;
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />

          {/* Drawer Surface */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="relative w-full max-w-lg bg-zinc-950/95 border-l border-zinc-800/80 shadow-2xl h-full flex flex-col justify-between backdrop-blur-xl z-10"
          >
            <Tabs.Root
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as 'queue' | 'history')}
              className="flex flex-col h-full"
            >
              {/* Header */}
              <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center justify-center">
                    <Layers className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                      PulseStream Drawer
                    </h3>
                    <p className="text-[11px] text-zinc-400">Desktop queue & persistent audit log</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onClose}
                    className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-md hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Tab Selector */}
              <div className="px-4 pt-3 border-b border-zinc-800/60 bg-zinc-950">
                <Tabs.List className="flex gap-2 p-1 bg-zinc-900/80 rounded-lg border border-zinc-800/80">
                  <Tabs.Trigger
                    value="queue"
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                      activeTab === 'queue'
                        ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <DownloadCloud className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Download Queue</span>
                    {(activeJobs.length > 0 || queuedJobs.length > 0) && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                        {activeJobs.length + queuedJobs.length}
                      </span>
                    )}
                  </Tabs.Trigger>

                  <Tabs.Trigger
                    value="history"
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                      activeTab === 'history'
                        ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <HistoryIcon className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Local History</span>
                    {history.length > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                        {history.length}
                      </span>
                    )}
                  </Tabs.Trigger>
                </Tabs.List>
              </div>

              {/* Tab Content: Queue */}
              <Tabs.Content value="queue" className="flex-1 overflow-y-auto p-4 space-y-5 focus:outline-none">
                {/* Control bar */}
                <div className="flex items-center justify-between bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-800/60">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePauseResume}
                      className={`px-2.5 py-1 text-xs rounded-md border font-medium flex items-center gap-1.5 transition-colors ${
                        isPaused
                          ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      {isPaused ? 'Resume Scheduler' : 'Pause Scheduler'}
                    </button>
                    <span className="text-[10px] font-mono text-zinc-500">Max concurrency: 2</span>
                  </div>

                  {jobs.some((j) => j.status === 'completed' || j.status === 'failed') && (
                    <button
                      onClick={handleClearCompleted}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:underline"
                    >
                      Clear finished
                    </button>
                  )}
                </div>

                {/* Active downloads */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      Active Transfers ({activeJobs.length})
                    </span>
                  </div>

                  {activeJobs.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-zinc-800/80 text-center text-zinc-500 text-xs">
                      No streams currently downloading
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeJobs.map((j) => {
                        const isVideo = j.request.mode === 'video';
                        return (
                          <div
                            key={j.id}
                            className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3 shadow-lg ring-1 ring-cyan-500/10"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center shrink-0 mt-0.5">
                                  {isVideo ? (
                                    <Film className="w-4 h-4 text-cyan-400" />
                                  ) : (
                                    <Music className="w-4 h-4 text-indigo-400" />
                                  )}
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold text-zinc-100 line-clamp-1">
                                    {j.request.title || 'YouTube Stream'}
                                  </h4>
                                  <p className="text-[10px] text-zinc-400 font-mono">
                                    {j.request.videoFormatId ? `fmt ${j.request.videoFormatId}` : 'audio-only'}
                                    {j.request.audioFormatId ? ` + ${j.request.audioFormatId}` : ' (muted)'} • .{j.request.targetContainer}
                                  </p>
                                </div>
                              </div>

                              <button
                                onClick={() => handleCancel(j.id)}
                                className="p-1.5 rounded-md bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-rose-400 transition-colors"
                                title="Cancel Process & Purge Temp Files"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Radix Progress Bar */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-cyan-400 font-medium capitalize">
                                  {j.progress.phase} ({j.progress.stream})
                                </span>
                                <span className="text-zinc-100 font-bold">{j.progress.percent.toFixed(0)}%</span>
                              </div>

                              <Progress.Root
                                className="relative overflow-hidden bg-zinc-950 rounded-full w-full h-1.5 border border-zinc-800"
                                value={j.progress.percent}
                              >
                                <Progress.Indicator
                                  className="bg-gradient-to-r from-cyan-500 to-indigo-500 w-full h-full transition-transform duration-300 ease-out"
                                  style={{ transform: `translateX(-${100 - (j.progress.percent || 1)}%)` }}
                                />
                              </Progress.Root>
                            </div>

                            {/* Telemetry Stats */}
                            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 pt-1.5 border-t border-zinc-800/60">
                              <span>{formatSpeed(j.progress.speedBytesPerSec)}</span>
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

                {/* Queued slots */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      Waiting in Queue ({queuedJobs.length})
                    </span>
                  </div>

                  {queuedJobs.length === 0 ? (
                    <div className="p-3.5 rounded-xl border border-dashed border-zinc-800/80 text-center text-zinc-500 text-xs">
                      Queue is clear
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {queuedJobs.map((j, idx) => (
                        <div
                          key={j.id}
                          className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-mono font-bold text-zinc-500">#{idx + 1}</span>
                            <div>
                              <h4 className="text-xs font-medium text-zinc-200 line-clamp-1">
                                {j.request.title || 'Queued Media Stream'}
                              </h4>
                              <span className="text-[10px] text-zinc-500">Awaiting available execution slot...</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleCancel(j.id)}
                            className="p-1 text-zinc-500 hover:text-rose-400 transition-colors"
                            title="Remove from queue"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Tabs.Content>

              {/* Tab Content: Persistent History */}
              <Tabs.Content value="history" className="flex-1 overflow-y-auto p-4 space-y-4 focus:outline-none">
                {/* History Filter Bar */}
                <div className="flex items-center justify-between bg-zinc-900/40 p-2 rounded-lg border border-zinc-800/60">
                  <div className="flex items-center gap-1">
                    {(['all', 'video', 'audio'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setMediaFilter(filter)}
                        className={`px-2.5 py-1 text-xs rounded-md capitalize font-medium transition-colors ${
                          mediaFilter === filter
                            ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/60'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>

                  {history.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      className="px-2 py-1 text-xs text-rose-400/80 hover:text-rose-300 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear all
                    </button>
                  )}
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="p-8 rounded-xl border border-dashed border-zinc-800/80 text-center space-y-2">
                    <HistoryIcon className="w-8 h-8 text-zinc-600 mx-auto" />
                    <h4 className="text-sm font-semibold text-zinc-400">No History Records</h4>
                    <p className="text-xs text-zinc-500 max-w-xs mx-auto">
                      Completed zero-transcoding downloads will be permanently logged here with verification telemetry.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredHistory.map((rec) => {
                      const isVideo = rec.mediaType === 'video';
                      const dateStr = new Date(rec.completedAt * 1000).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={rec.id}
                          className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 space-y-3 transition-colors group"
                        >
                          <div className="flex items-start gap-3">
                            <img
                              src={rec.thumbnailUrl}
                              alt={rec.title}
                              className="w-16 h-12 rounded-lg object-cover bg-zinc-900 shrink-0 border border-zinc-800"
                              onError={(e) => {
                                // Fallback image
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />

                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-semibold text-zinc-100 line-clamp-1 group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                                {isVideo ? (
                                  <Film className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                ) : (
                                  <Music className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                )}
                                <span className="truncate">{rec.title}</span>
                              </h4>

                              <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-[10px]">
                                <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 uppercase font-semibold">
                                  .{rec.container}
                                </span>
                                {rec.videoCodec && (
                                  <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 text-cyan-300 uppercase">
                                    {rec.videoCodec}
                                  </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 text-indigo-300 uppercase">
                                  {rec.audioCodec}
                                </span>
                                <span className="text-zinc-500">•</span>
                                <span className="text-zinc-400">{formatBytes(rec.fileSizeBytes)}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => handleDeleteHistoryItem(rec.id)}
                              className="p-1.5 text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all rounded"
                              title="Delete from history"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Footer Actions */}
                          <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px]">
                            <span className="text-[10px] text-zinc-500 font-mono">{dateStr}</span>

                            <div className="flex items-center gap-2">
                              {rec.verification && (
                                <button
                                  onClick={() => onViewVerification && onViewVerification(rec.verification)}
                                  className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 font-mono text-[10px] flex items-center gap-1 hover:bg-emerald-900/60 transition-colors"
                                >
                                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                  <span>Verified</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleShowInFolder(rec.filePath)}
                                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium flex items-center gap-1 transition-colors"
                              >
                                <FolderOpen className="w-3 h-3" />
                                <span>Show</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Tabs.Content>
            </Tabs.Root>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
