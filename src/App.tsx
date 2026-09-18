import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import {
  NormalizedManifest,
  VideoTrack,
  AudioTrack,
  TargetContainer,
  DownloadJobRequest,
  DownloadProgressPayload,
  VerificationResult,
} from './types/media';
import {
  apiExtractManifest,
  apiStartDownload,
  apiEnqueueJob,
  apiGetQueueItems,
  listenQueueUpdated,
  formatDuration,
  isTauriEnvironment,
} from './services/tauriBridge';
import { UrlBar } from './components/UrlBar';
import { CookieModal } from './components/CookieModal';
import { VideoStreamCards } from './components/VideoStreamCards';
import { AudioStreamTiles } from './components/AudioStreamTiles';
import { DownloadView } from './components/DownloadView';
import { VerificationModal } from './components/VerificationModal';
import { QueueDrawer } from './components/QueueDrawer';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { SettingsModal } from './components/SettingsModal';

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

  // Load initial manifest on mount & subscribe to queue updates
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
    let unlisten: (() => void) | undefined;
    listenQueueUpdated(updateQueueCount).then((u) => {
      unlisten = u;
    });

    return () => {
      if (unlisten) unlisten();
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

  // Inspect manifest handler
  const handleInspectManifest = async (showLoading: boolean = true) => {
    if (!url.trim()) return;
    if (showLoading) setIsExtracting(true);
    setExtractError(null);

    try {
      const data = await apiExtractManifest(url.trim(), cookiePath);
      setManifest(data);
      applyDefaultSelections(data);
      if (showLoading) {
        toast.success('Manifest Extracted', {
          description: `${data.videoTracks.length} video streams and ${data.audioTracks.length} audio tracks discovered.`,
        });
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to extract video manifest. Please check the URL.';
      setExtractError(errMsg);
      if (showLoading) {
        toast.error('Extraction Failed', { description: errMsg });
      }
    } finally {
      if (showLoading) setIsExtracting(false);
    }
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
      </div>
    </Tooltip.Provider>
  );
}
