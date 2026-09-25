import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers,
  ChevronDown,
  ChevronUp,
  DownloadCloud,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
  Film,
  Music,
  Check,
  Zap,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { StagedVideoItem, BatchRule, TargetContainer } from '../types/media';
import { formatBytes, formatDuration } from '../services/tauriBridge';

interface BatchStagingDockProps {
  items: StagedVideoItem[];
  onUpdateItem: (id: string, updates: Partial<StagedVideoItem>) => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onApplyGlobalRule: (rule: BatchRule) => void;
  onEnqueueAll: () => void;
  activeGlobalRule: BatchRule;
}

const RULE_LABELS: Record<BatchRule, { title: string; subtitle: string; icon: any }> = {
  highest_lossless: {
    title: 'Highest Native Resolution',
    subtitle: 'Lossless Remux (Direct Stream Copy)',
    icon: Zap,
  },
  '1080p_opus': {
    title: '1080p Native + Best Opus Audio',
    subtitle: 'Optimized desktop fidelity & speed',
    icon: Film,
  },
  audio_only: {
    title: 'Original Audio Only (Opus/AAC)',
    subtitle: 'Direct bitstream extraction, no video',
    icon: Music,
  },
};

export function BatchStagingDock({
  items,
  onUpdateItem,
  onRemoveItem,
  onClearAll,
  onApplyGlobalRule,
  onEnqueueAll,
  activeGlobalRule,
}: BatchStagingDockProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const readyCount = items.filter((i) => !i.isLoading && i.manifest && !i.error).length;
  const loadingCount = items.filter((i) => i.isLoading).length;
  const errorCount = items.filter((i) => Boolean(i.error)).length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:bottom-4 left-0 right-0 z-50 px-2 sm:px-4 pointer-events-none"
      >
        <div className="max-w-4xl mx-auto pointer-events-auto">
          {/* Main Floating Container */}
          <div className="bg-zinc-950/95 backdrop-blur-2xl border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/40 overflow-hidden ring-1 ring-white/10">
            {/* Top Bar: Always Visible */}
            <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-zinc-900/90 via-zinc-950/90 to-zinc-900/90 border-b border-zinc-800/80">
              {/* Left: Badge, Item Count, and State */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-zinc-100 tracking-tight">
                      Batch Staging Dock
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                      {items.length} {items.length === 1 ? 'video' : 'videos'} staged
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    {loadingCount > 0 ? (
                      <span className="flex items-center gap-1 text-cyan-300 font-mono">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Inspecting {loadingCount}...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-400 font-mono">
                        <CheckCircle2 className="w-3 h-3" />
                        {readyCount} ready to queue
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="flex items-center gap-1 text-red-400 font-mono">
                        <AlertCircle className="w-3 h-3" />
                        {errorCount} failed
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Center/Right: Quick-Apply Rule Selector + Actions */}
              <div className="flex items-center gap-2.5 ml-auto">
                {/* Global Quick-Apply Rule Dropdown */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-850 border border-zinc-700/80 hover:border-zinc-600 text-xs font-medium text-zinc-200 transition-all shadow-sm"
                      title="Quick-apply preset rule to all staged videos"
                    >
                      <span className="text-zinc-400 text-[11px]">Preset:</span>
                      <span className="text-cyan-300 font-medium truncate max-w-[170px] sm:max-w-[210px]">
                        {RULE_LABELS[activeGlobalRule].title}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 min-w-[280px] bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 shadow-2xl space-y-1 text-xs text-zinc-200"
                    >
                      <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-semibold border-b border-zinc-800">
                        Zero-Transcoding Batch Presets
                      </div>

                      {(Object.keys(RULE_LABELS) as BatchRule[]).map((ruleKey) => {
                        const rule = RULE_LABELS[ruleKey];
                        const Icon = rule.icon;
                        const isSelected = activeGlobalRule === ruleKey;

                        return (
                          <DropdownMenu.Item
                            key={ruleKey}
                            onSelect={() => onApplyGlobalRule(ruleKey)}
                            className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer outline-none transition-colors ${
                              isSelected
                                ? 'bg-cyan-950/60 text-cyan-200 border border-cyan-500/30'
                                : 'hover:bg-zinc-800/70 text-zinc-300'
                            }`}
                          >
                            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-zinc-400'}`} />
                            <div className="flex-1">
                              <div className="font-medium">{rule.title}</div>
                              <div className="text-[10px] text-zinc-400">{rule.subtitle}</div>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />}
                          </DropdownMenu.Item>
                        );
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Toggle Expansion */}
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
                  title={isExpanded ? 'Collapse card list' : 'Expand card list to inspect videos'}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="hidden sm:inline">{isExpanded ? 'Hide' : 'Review'}</span>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Clear Staging */}
                <button
                  type="button"
                  onClick={onClearAll}
                  className="p-1.5 rounded-lg hover:bg-red-950/30 border border-transparent hover:border-red-900/50 text-zinc-400 hover:text-red-400 transition-colors"
                  title="Clear all staged videos"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                {/* Primary Enqueue Action */}
                <button
                  type="button"
                  onClick={onEnqueueAll}
                  disabled={readyCount === 0}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-zinc-950 font-semibold text-xs shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  <DownloadCloud className="w-4 h-4" />
                  <span>Enqueue All Selected ({readyCount})</span>
                </button>
              </div>
            </div>

            {/* Expandable Body: Individual Staged Cards */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="max-h-[380px] overflow-y-auto p-4 space-y-3 bg-zinc-950/60 border-t border-zinc-800/80 divide-y divide-zinc-900"
                >
                  {items.map((item) => {
                    const isEditing = editingItemId === item.id;
                    const manifest = item.manifest;

                    return (
                      <div
                        key={item.id}
                        className="pt-3 first:pt-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group"
                      >
                        {/* Thumbnail & Title Info */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="relative w-20 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
                            {manifest?.thumbnailUrl ? (
                              <img
                                src={manifest.thumbnailUrl}
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Film className="w-5 h-5 text-zinc-600" />
                            )}
                            {manifest?.durationSeconds ? (
                              <span className="absolute bottom-1 right-1 text-[9px] font-mono bg-zinc-950/80 px-1 rounded text-zinc-300">
                                {formatDuration(manifest.durationSeconds)}
                              </span>
                            ) : null}
                          </div>

                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-medium text-zinc-100 truncate group-hover:text-cyan-300 transition-colors">
                              {item.title || item.url}
                            </h4>

                            {/* Format & Status Tags */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                              {item.isLoading ? (
                                <span className="flex items-center gap-1 text-cyan-400 font-mono text-[10px]">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Discovering streams...
                                </span>
                              ) : item.error ? (
                                <span className="flex items-center gap-1 text-red-400 font-mono text-[10px]">
                                  <AlertCircle className="w-3 h-3" />
                                  {item.error}
                                </span>
                              ) : manifest ? (
                                <>
                                  {item.selectedRule === 'audio_only' ? (
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-950/50 border border-indigo-500/30 text-indigo-300 font-mono text-[10px]">
                                      Audio Only • {item.selectedAudioTrack?.codec.toUpperCase() || 'OPUS'}{' '}
                                      {item.selectedAudioTrack?.nominalBitrateKbps ? `(${item.selectedAudioTrack.nominalBitrateKbps}kbps)` : ''}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700/60 text-zinc-200 font-mono text-[10px]">
                                        {item.selectedVideoTrack?.label || item.selectedVideoTrack?.resolution || 'Video'}
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 font-mono text-[10px]">
                                        {item.selectedVideoTrack?.codec.toUpperCase() || 'VP9'} + {item.selectedAudioTrack?.codec.toUpperCase() || 'OPUS'}
                                      </span>
                                    </>
                                  )}
                                  <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-[10px]">
                                    .{item.targetContainer.toUpperCase()}
                                  </span>
                                  {item.selectedVideoTrack?.filesizeBytes ? (
                                    <span className="text-zinc-500 text-[10px] font-mono">
                                      {formatBytes(item.selectedVideoTrack.filesizeBytes)}
                                    </span>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Individual Card Fine-Tuning Controls */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          {manifest && (
                            <button
                              type="button"
                              onClick={() => setEditingItemId(isEditing ? null : item.id)}
                              className={`px-2 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                                isEditing
                                  ? 'bg-cyan-950/50 border-cyan-500/50 text-cyan-300'
                                  : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {isEditing ? 'Done' : 'Fine-Tune'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.id)}
                            className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                            title="Remove from batch staging"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Fine-Tuning Drawer for This Item */}
                        {isEditing && manifest && (
                          <div className="w-full mt-2 p-3 bg-zinc-900/80 rounded-xl border border-zinc-800 space-y-3">
                            <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                              Fine-Tune Stream Allocation
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {/* Video Resolution Dropdown */}
                              <div>
                                <label className="block text-[10px] text-zinc-400 mb-1">
                                  Video Stream
                                </label>
                                <select
                                  value={item.selectedVideoTrack?.formatId || 'audio_only'}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === 'audio_only') {
                                      onUpdateItem(item.id, {
                                        selectedRule: 'audio_only',
                                        selectedVideoTrack: null,
                                      });
                                    } else {
                                      const track = manifest.videoTracks.find((v) => v.formatId === val);
                                      if (track) {
                                        onUpdateItem(item.id, {
                                          selectedRule: 'highest_lossless',
                                          selectedVideoTrack: track,
                                        });
                                      }
                                    }
                                  }}
                                  className="w-full text-xs bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
                                >
                                  <option value="audio_only">None (Original Audio Only)</option>
                                  {manifest.videoTracks.map((v) => (
                                    <option key={v.formatId} value={v.formatId}>
                                      {v.label || v.resolution} ({v.codec.toUpperCase()})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Audio Track Dropdown */}
                              <div>
                                <label className="block text-[10px] text-zinc-400 mb-1">
                                  Audio Track
                                </label>
                                <select
                                  value={item.selectedAudioTrack?.formatId || ''}
                                  onChange={(e) => {
                                    const track = manifest.audioTracks.find((a) => a.formatId === e.target.value);
                                    if (track) {
                                      onUpdateItem(item.id, { selectedAudioTrack: track });
                                    }
                                  }}
                                  className="w-full text-xs bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
                                >
                                  {manifest.audioTracks.map((a) => (
                                    <option key={a.formatId} value={a.formatId}>
                                      {a.languageLabel || a.language} • {a.codec.toUpperCase()}{' '}
                                      {a.nominalBitrateKbps ? `(${a.nominalBitrateKbps}kbps)` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Target Container Dropdown */}
                              <div>
                                <label className="block text-[10px] text-zinc-400 mb-1">
                                  Container
                                </label>
                                <select
                                  value={item.targetContainer}
                                  onChange={(e) => {
                                    onUpdateItem(item.id, {
                                      targetContainer: e.target.value as TargetContainer,
                                    });
                                  }}
                                  className="w-full text-xs bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
                                >
                                  <option value="auto">Auto (Lossless Matrix)</option>
                                  <option value="mkv">MKV (Universal)</option>
                                  <option value="mp4">MP4 (Native)</option>
                                  <option value="webm">WebM (Google Native)</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
