import { useState, useEffect, useMemo, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ShieldCheck,
  Zap,
  Film,
  Music,
  Clock,
  ListOrdered,
  Activity,
  Sliders,
  Layers,
} from 'lucide-react';
import {
  NormalizedManifest,
  VideoTrack,
  AudioTrack,
  TargetContainer,
  DownloadJobRequest,
  DownloadProgressPayload,
  VerificationResult,
  HandoffPayload,
  BatchRule,
  StagedVideoItem,
} from './types/media';
import {
  apiExtractManifest,
  apiStartDownload,
  apiEnqueueJob,
  apiGetQueueItems,
  listenQueueUpdated,
  listenBrowserHandoff,
  triggerMockHandoff,
  formatDuration,
  isTauriEnvironment,
} from './services/tauriBridge';
import { applyBatchRule } from './utils/batchRules';
import { UrlBar } from './components/UrlBar';
import { CookieModal } from './components/CookieModal';
import { VideoStreamCards } from './components/VideoStreamCards';
import { AudioStreamTiles } from './components/AudioStreamTiles';
import { DownloadView } from './components/DownloadView';
import { VerificationModal } from './components/VerificationModal';
import { QueueDrawer } from './components/QueueDrawer';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { SettingsModal } from './components/SettingsModal';
import { BatchStagingDock } from './components/BatchStagingDock';

export default function App() {
  // Navigation & Mode
  const [appMode, setAppMode] = useState<'video' | 'audio'>('video');

  // Extraction State
  const [url, setUrl] = useState<string>('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<NormalizedManifest | null>(null);

  // Modal States
  const [isCookieModalOpen, setIsCookieModalOpen] = useState<boolean>(false);
  const [isQueueOpen, setIsQueueOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [cookiePath, setCookiePath] = useState<string>('');
  const [queueCount, setQueueCount] = useState<number>(0);

  // Track & Container Selection State
  const [selectedVideoTrack, setSelectedVideoTrack] = useState<VideoTrack | null>(null);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<AudioTrack | null>(null);
  const [requestedContainer, setRequestedContainer] = useState<TargetContainer>('auto');

  // Destination & Download Configuration
  const [outputDirectory] = useState<string>('/home/s/Videos/PulseStream');
  const [filenameTemplate] = useState<string>('%(title)s [%(ext)s]');

  // Download Pipeline State
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPayload | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState<boolean>(false);

  // Batch Staging State
  const [stagedVideos, setStagedVideos] = useState<StagedVideoItem[]>([]);
  const [activeGlobalRule, setActiveGlobalRule] = useState<BatchRule>('highest_lossless');
  const activeGlobalRuleRef = useRef<BatchRule>(activeGlobalRule);
  activeGlobalRuleRef.current = activeGlobalRule;
  const stagedVideosRef = useRef<StagedVideoItem[]>(stagedVideos);
  stagedVideosRef.current = stagedVideos;

  // Sound feedback for incoming browser handoffs
  const playHandoffTone = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.12); // G5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // AudioContext may be blocked until user gesture, ignore safely
    }
  };

  // Inspect manifest handler
  const handleInspectManifest = async (
    showLoading: boolean = true,
    overrideUrl?: string,
    overrideCookie?: string
  ) => {
    const targetUrl = (overrideUrl || url).trim();
    if (!targetUrl) return;
    if (showLoading) setIsExtracting(true);
    setExtractError(null);

    try {
      const data = await apiExtractManifest(targetUrl, overrideCookie || cookiePath);
      setManifest(data);
      applyDefaultSelections(data);
      if (showLoading) {
        toast.success('Manifest Extracted', {
          description: `${data.videoTracks.length} video streams and ${data.audioTracks.length} audio tracks discovered.`,
        });
      }
      return data;
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to extract video manifest. Please check the URL.';
      setExtractError(errMsg);
      if (showLoading) {
        toast.error('Extraction Failed', { description: errMsg });
      }
      throw err;
    } finally {
      if (showLoading) setIsExtracting(false);
    }
  };

  // Browser handoff event handler
  const handleBrowserHandoff = async (payload: HandoffPayload) => {
    playHandoffTone();

    toast.info('Received from browser', {
      description: payload.title || payload.url,
      icon: '⬇️',
    });

    const currentStaged = stagedVideosRef.current;
    const isFirstItem = currentStaged.length === 0;

    // Populates the main Format Inspector directly if first item
    if (isFirstItem) {
      setUrl(payload.url);
      handleInspectManifest(true, payload.url, payload.cookies || undefined).catch(() => {});
    }

    // Add to staged list with loading state
    const currentRule = activeGlobalRuleRef.current;
    const stagedId = `staged_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newItem: StagedVideoItem = {
      id: stagedId,
      url: payload.url,
      title: payload.title || payload.url,
      cookies: payload.cookies || null,
      manifest: null,
      isLoading: true,
      error: null,
      selectedRule: currentRule,
      selectedVideoTrack: null,
      selectedAudioTrack: null,
      targetContainer: 'auto',
    };

    setStagedVideos((prev) => {
      const exists = prev.find((p) => p.url === payload.url);
      if (exists) return prev;
      return [...prev, newItem];
    });

    // Auto-discover format in background for the staged video
    try {
      const discovered = await apiExtractManifest(payload.url, payload.cookies || cookiePath);
      const sel = applyBatchRule(discovered, currentRule);
      setStagedVideos((prev) =>
        prev.map((item) =>
          item.id === stagedId
            ? {
                ...item,
                title: discovered.title,
                manifest: discovered,
                isLoading: false,
                selectedVideoTrack: sel.selectedVideoTrack,
                selectedAudioTrack: sel.selectedAudioTrack,
                targetContainer: sel.targetContainer,
              }
            : item
        )
      );
    } catch (err: any) {
      setStagedVideos((prev) =>
        prev.map((item) =>
          item.id === stagedId
            ? {
                ...item,
                isLoading: false,
                error: err?.message || 'Failed to inspect streams',
              }
            : item
        )
      );
    }
  };

  // Staging Dock Actions
  const handleUpdateStagedItem = (id: string, updates: Partial<StagedVideoItem>) => {
    setStagedVideos((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleRemoveStagedItem = (id: string) => {
    setStagedVideos((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAllStaged = () => {
    setStagedVideos([]);
  };

  const handleApplyGlobalRule = (rule: BatchRule) => {
    setActiveGlobalRule(rule);
    setStagedVideos((prev) =>
      prev.map((item) => {
        if (!item.manifest) return { ...item, selectedRule: rule };
        const sel = applyBatchRule(item.manifest, rule);
        return {
          ...item,
          selectedRule: rule,
          selectedVideoTrack: sel.selectedVideoTrack,
          selectedAudioTrack: sel.selectedAudioTrack,
          targetContainer: sel.targetContainer,
        };
      })
    );
    toast.success('Batch Preset Applied', {
      description: `Rule updated for all staged videos.`,
    });
  };

  const handleEnqueueAllStaged = async () => {
    const readyItems = stagedVideos.filter((i) => i.manifest && !i.isLoading && !i.error);
    if (readyItems.length === 0) return;

    let enqueuedCount = 0;
    for (const item of readyItems) {
      if (!item.manifest) continue;
      const isAudioOnly = item.selectedRule === 'audio_only';
      const request: DownloadJobRequest = {
        url: item.url,
        title: item.title || item.manifest.title,
        mode: isAudioOnly ? 'audio' : 'video',
        videoFormatId: isAudioOnly ? undefined : item.selectedVideoTrack?.formatId,
        audioFormatId: item.selectedAudioTrack?.formatId ?? null,
        targetContainer: item.targetContainer,
        outputDirectory,
        filenameTemplate,
        expectedVideo: isAudioOnly ? undefined : item.selectedVideoTrack || undefined,
        expectedAudio: item.selectedAudioTrack || undefined,
      };

      try {
        await apiEnqueueJob(request);
        enqueuedCount++;
      } catch (err) {
        console.error(`Failed to enqueue staged item ${item.title}:`, err);
      }
    }

    toast.success(`Enqueued ${enqueuedCount} ${enqueuedCount === 1 ? 'Video' : 'Videos'}`, {
      description: 'Jobs successfully registered to active download queue.',
    });

    setStagedVideos([]);
    apiGetQueueItems().then((items) => {
      const active = items.filter((j) => j.status === 'active' || j.status === 'queued').length;
      setQueueCount(active);
    });
  };

  // Load initial manifest on mount & subscribe to queue and browser handoffs
  useEffect(() => {
    handleInspectManifest(false);

    const updateQueueCount = () => {
      apiGetQueueItems()
        .then((items) => {
          const active = items.filter((j) => j.status === 'active' || j.status === 'queued').length;
          setQueueCount(active);
        })
        .catch(console.error);
    };

    updateQueueCount();
    let unlistenQueue: (() => void) | undefined;
    listenQueueUpdated(updateQueueCount).then((u) => {
      unlistenQueue = u;
    });

    let unlistenHandoff: (() => void) | undefined;
    listenBrowserHandoff((payload: HandoffPayload) => {
      handleBrowserHandoff(payload);
    }).then((u) => {
      unlistenHandoff = u;
    });

    (window as any).triggerPulseStreamHandoff = (payload: HandoffPayload) => {
      triggerMockHandoff(payload);
    };

    return () => {
      if (unlistenQueue) unlistenQueue();
      if (unlistenHandoff) unlistenHandoff();
    };
  }, []);

  // Update selected tracks when a new manifest is extracted
  const applyDefaultSelections = (m: NormalizedManifest) => {
    if (m.videoTracks.length > 0) {
      setSelectedVideoTrack(m.videoTracks[0]);
    }
    const defAudio = m.audioTracks.find((a) => a.isDefault) || m.audioTracks[0] || null;
    setSelectedAudioTrack(defAudio);
  };

  // Compute final container recommendation for summary
  const finalContainerExtension = useMemo(() => {
    if (requestedContainer !== 'auto') return requestedContainer;
    if (appMode === 'video') {
      const v = selectedVideoTrack?.codec || 'h264';
      const a = selectedAudioTrack?.codec || 'aac';
      if (v === 'h264' && a === 'aac') return 'mp4';
      if ((v === 'av1' || v === 'vp9') && a === 'opus') return 'webm';
      return 'mkv';
    }
    return selectedAudioTrack?.codec === 'aac' ? 'm4a' : 'webm';
  }, [requestedContainer, appMode, selectedVideoTrack, selectedAudioTrack]);

  // Execute download job
  const handleStartDownload = async () => {
    if (!manifest) return;

    setIsDownloading(true);
    setVerificationResult(null);
    setDownloadProgress(null);

    const request: DownloadJobRequest = {
      url: url.trim(),
      title: manifest.title,
      mode: appMode,
      videoFormatId: appMode === 'video' ? selectedVideoTrack?.formatId : undefined,
      audioFormatId:
        appMode === 'video'
          ? selectedAudioTrack
            ? selectedAudioTrack.formatId
            : null
          : selectedAudioTrack?.formatId ?? null,
      targetContainer: requestedContainer,
      outputDirectory,
      filenameTemplate,
      expectedVideo: appMode === 'video' ? selectedVideoTrack || undefined : undefined,
      expectedAudio: appMode === 'video' ? selectedAudioTrack || undefined : selectedAudioTrack || undefined,
    };

    // Register into background queue engine
    apiEnqueueJob(request)
      .then(() => {
        toast.info('Added to Download Queue', {
          description: manifest.title,
        });
      })
      .catch(console.error);

    try {
      const result = await apiStartDownload(request, (payload) => {
        setDownloadProgress(payload);
      });
      setVerificationResult(result);
      if (result.status === 'verified') {
        toast.success('Download Complete & Verified Authentic', {
          description: `${manifest.title} saved losslessly to .${finalContainerExtension}`,
        });
      } else {
        toast.warning('Verification Discrepancy Found', {
          description: result.details,
        });
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Download process encountered an unexpected error.';
      setVerificationResult({
        status: 'failed',
        policyAuditPassed: false,
        codecMatch: false,
        dimensionsMatch: false,
        sampleRateMatch: false,
        details: errMsg,
      });
      toast.error('Download Failed', {
        description: errMsg,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-cyan-500/20 selection:text-cyan-200">
        {/* Sonner Desktop Toaster */}
        <Toaster position="bottom-right" theme="dark" richColors closeButton />

        {/* Top Navbar */}
        <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            {/* Logo & Identity */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/10">
                <Zap className="w-4 h-4 text-zinc-950" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tracking-tight text-zinc-100 text-sm">PulseStream</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-cyan-400 font-medium">
                    v0.1.0 • Zero-Transcoding
                  </span>
                </div>
              </div>
            </div>

            {/* Header Action Controls */}
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/30 border border-emerald-700/40 text-emerald-300 text-xs font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  Direct Stream Copy (<span className="font-mono font-semibold">-c copy</span>)
                </span>
              </div>

              {/* Queue Drawer Button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => setIsQueueOpen(true)}
                    className="relative px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <ListOrdered className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="hidden sm:inline">Queue & History</span>
                    {queueCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-zinc-950 text-[10px] font-bold">
                        {queueCount}
                      </span>
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="px-2 py-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded shadow-lg z-50"
                    sideOffset={5}
                  >
                    Manage download queue & view persistent history
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              {/* Diagnostics Button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => setIsDiagnosticsOpen(true)}
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    <Activity className="w-4 h-4 text-emerald-400" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="px-2 py-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded shadow-lg z-50"
                    sideOffset={5}
                  >
                    System diagnostics & sidecar versions
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              {/* Settings / Authentication Button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    <Sliders className="w-4 h-4 text-indigo-400" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="px-2 py-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded shadow-lg z-50"
                    sideOffset={5}
                  >
                    Authentication & anti-throttling settings
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              {/* Browser Integration Loopback Daemon Indicator */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Port 48125</span>
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded shadow-lg z-50 max-w-xs"
                    sideOffset={5}
                  >
                    PulseStream IDM loopback daemon listening on 127.0.0.1:48125 for browser extension
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              {/* Staged videos indicator */}
              {stagedVideos.length > 0 && (
                <div
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-medium"
                  title={`${stagedVideos.length} video(s) staged`}
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{stagedVideos.length}</span>
                </div>
              )}

              {!isTauriEnvironment() && (
                <span
                  className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 px-2 py-1 rounded text-zinc-500"
                  title="Web demo preview"
                >
                  web-preview
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 space-y-8">
          {/* 1. URL Input & Extraction Bar */}
          <section className="space-y-3">
            <UrlBar
              url={url}
              setUrl={setUrl}
              onInspect={() => handleInspectManifest(true)}
              isLoading={isExtracting}
              error={extractError}
              onOpenCookieModal={() => setIsCookieModalOpen(true)}
              hasCookieConfigured={Boolean(cookiePath)}
            />
          </section>

          {/* 2. Video Manifest Header Card */}
          {manifest && (
            <section className="bg-zinc-900/50 rounded-2xl p-5 md:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 border border-zinc-800/80 shadow-xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="w-32 h-20 sm:w-40 sm:h-24 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 relative group">
                  <img
                    src={manifest.thumbnailUrl}
                    alt={manifest.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-zinc-300 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    {formatDuration(manifest.durationSeconds)}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-sm sm:text-base font-semibold text-zinc-100 line-clamp-2 leading-snug">
                    {manifest.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono">
                    <span className="text-zinc-500">ID: {manifest.videoId}</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-cyan-400 font-semibold">{manifest.videoTracks.length} Video Streams</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-indigo-400 font-semibold">{manifest.audioTracks.length} Audio Streams</span>
                  </div>
                </div>
              </div>

              {/* Mode Selector Pill */}
              <div className="shrink-0 flex items-center p-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-inner">
                <button
                  type="button"
                  onClick={() => setAppMode('video')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                    appMode === 'video'
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Film className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Video Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAppMode('audio')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                    appMode === 'audio'
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Music className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Audio Mode</span>
                </button>
              </div>
            </section>
          )}

          {/* Loading Skeleton */}
          {isExtracting && (
            <div className="bg-zinc-900/40 rounded-2xl p-8 space-y-4 border border-zinc-800/60 animate-pulse">
              <div className="h-6 bg-zinc-800/60 rounded w-1/3" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="h-28 bg-zinc-800/40 rounded-xl" />
                <div className="h-28 bg-zinc-800/40 rounded-xl" />
                <div className="h-28 bg-zinc-800/40 rounded-xl" />
              </div>
            </div>
          )}

          {/* 3. Mode-Specific Stream Configuration */}
          {manifest && !isExtracting && (
            <section className="bg-zinc-900/40 rounded-2xl p-6 md:p-8 space-y-6 border border-zinc-800/80 shadow-xl">
              {appMode === 'video' ? (
                <VideoStreamCards
                  videoTracks={manifest.videoTracks}
                  audioTracks={manifest.audioTracks}
                  selectedVideoTrack={selectedVideoTrack}
                  onSelectVideoTrack={setSelectedVideoTrack}
                  selectedAudioTrack={selectedAudioTrack}
                  onSelectAudioTrack={setSelectedAudioTrack}
                  requestedContainer={requestedContainer}
                  onSelectRequestedContainer={setRequestedContainer}
                />
              ) : (
                <AudioStreamTiles
                  audioTracks={manifest.audioTracks}
                  selectedAudioTrack={selectedAudioTrack}
                  onSelectAudioTrack={setSelectedAudioTrack}
                  requestedContainer={requestedContainer}
                  onSelectRequestedContainer={setRequestedContainer}
                />
              )}
            </section>
          )}

          {/* 4. Output Destination & Download Action View */}
          {manifest && !isExtracting && (
            <section>
              <DownloadView
                progress={downloadProgress}
                isDownloading={isDownloading}
                verificationResult={verificationResult}
                expectedVideo={appMode === 'video' ? selectedVideoTrack : null}
                expectedAudio={selectedAudioTrack}
                onOpenVerificationModal={() => setIsVerificationModalOpen(true)}
                onStartDownload={handleStartDownload}
                canStart={Boolean(manifest && selectedAudioTrack)}
                destinationPath={`${outputDirectory}/${manifest.title.slice(0, 30)}.${finalContainerExtension}`}
              />
            </section>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-xs text-zinc-500 text-center">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="font-mono text-[11px]">PulseStream • Authentic Zero-Transcoding Desktop Engine</p>
            <div className="flex items-center gap-4 text-zinc-400">
              <span className="flex items-center gap-1.5 font-mono text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Direct Stream Copy (-c copy)
              </span>
            </div>
          </div>
        </footer>

        {/* Modals & Slide-out Drawers */}
        <CookieModal
          isOpen={isCookieModalOpen}
          onClose={() => setIsCookieModalOpen(false)}
          cookiePath={cookiePath}
          onSaveCookiePath={setCookiePath}
        />

        <VerificationModal
          isOpen={isVerificationModalOpen}
          onClose={() => setIsVerificationModalOpen(false)}
          result={verificationResult}
          expectedVideo={appMode === 'video' ? selectedVideoTrack || undefined : undefined}
          expectedAudio={selectedAudioTrack || undefined}
        />

        <QueueDrawer
          isOpen={isQueueOpen}
          onClose={() => setIsQueueOpen(false)}
          onViewVerification={(res) => {
            setVerificationResult(res);
            setIsVerificationModalOpen(true);
          }}
        />

        <DiagnosticsModal isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} />

        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {/* Floating Batch Staging Dock (displayed when >= 2 videos are staged) */}
        {stagedVideos.length >= 2 && (
          <BatchStagingDock
            items={stagedVideos}
            onUpdateItem={handleUpdateStagedItem}
            onRemoveItem={handleRemoveStagedItem}
            onClearAll={handleClearAllStaged}
            onApplyGlobalRule={handleApplyGlobalRule}
            onEnqueueAll={handleEnqueueAllStaged}
            activeGlobalRule={activeGlobalRule}
          />
        )}
      </div>
    </Tooltip.Provider>
  );
}
