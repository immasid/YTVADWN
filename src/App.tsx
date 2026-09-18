import { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  Zap,
  Film,
  Music,
  Clock,
  ListOrdered,
  Activity,
  Settings,
} from 'lucide-react';
import {
  NormalizedManifest,
  VideoTrack,
  AudioTrack,
  TargetContainer,
  DownloadJobRequest,
  DownloadProgressPayload,
  VerificationResult
} from './types/media';
import {
  apiExtractManifest,
  apiStartDownload,
  apiEnqueueJob,
  apiGetQueueItems,
  listenQueueUpdated,
  formatDuration,
  isTauriEnvironment
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
      apiGetQueueItems().then((items) => {
        const active = items.filter((j) => j.status === 'active' || j.status === 'queued').length;
        setQueueCount(active);
      }).catch(console.error);
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
    // Pick the best video track (first in sorted list)
    if (m.videoTracks.length > 0) {
      setSelectedVideoTrack(m.videoTracks[0]);
    }
    // Pick default or first audio track
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
    } catch (err: any) {
      setExtractError(err?.message || 'Failed to extract video manifest. Please check the URL.');
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
      audioFormatId: appMode === 'video'
        ? (selectedAudioTrack ? selectedAudioTrack.formatId : null)
        : (selectedAudioTrack?.formatId ?? null),
      targetContainer: requestedContainer,
      outputDirectory,
      filenameTemplate,
      expectedVideo: appMode === 'video' ? selectedVideoTrack || undefined : undefined,
      expectedAudio: appMode === 'video'
        ? (selectedAudioTrack || undefined)
        : (selectedAudioTrack || undefined),
    };

    // Also register into the background queue engine
    apiEnqueueJob(request).catch(console.error);

    try {
      const result = await apiStartDownload(request, (payload) => {
        setDownloadProgress(payload);
      });
      setVerificationResult(result);
    } catch (err: any) {
      setVerificationResult({
        status: 'failed',
        policyAuditPassed: false,
        codecMatch: false,
        dimensionsMatch: false,
        sampleRateMatch: false,
        details: err?.message || 'Download process encountered an unexpected error.',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-[#080d1a]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Logo & Identity */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-base">PulseStream</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 border border-cyan-800/50 text-cyan-400 font-semibold">
                  Zero-Transcoding Desktop Engine
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Lossless (<span className="font-mono font-semibold">-c copy</span>)</span>
            </div>

            {/* Queue Drawer Button */}
            <button
              onClick={() => setIsQueueOpen(true)}
              className="relative px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              title="Download Queue & History"
            >
              <ListOrdered className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Queue</span>
              {queueCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-black text-[10px] font-bold">
                  {queueCount}
                </span>
              )}
            </button>

            {/* Diagnostics Button */}
            <button
              onClick={() => setIsDiagnosticsOpen(true)}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition-colors"
              title="System Diagnostics & Sidecar Health"
            >
              <Activity className="w-4 h-4 text-emerald-400" />
            </button>

            {/* Settings / Authentication Button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition-colors"
              title="Session Authentication & PO-Token Settings"
            >
              <Settings className="w-4 h-4 text-indigo-400" />
            </button>

            {!isTauriEnvironment() && (
              <span className="text-[10px] font-mono bg-slate-900 border border-slate-700/80 px-2 py-1 rounded text-slate-400" title="Simulated browser preview active">
                Preview
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
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
          <section className="glass-panel rounded-2xl p-5 md:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 border border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-32 h-20 sm:w-40 sm:h-24 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 shrink-0 relative group">
                <img
                  src={manifest.thumbnailUrl}
                  alt={manifest.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-slate-200 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-cyan-400" />
                  {formatDuration(manifest.durationSeconds)}
                </div>
              </div>

              <div className="space-y-1.5">
                <h2 className="text-base sm:text-lg font-bold text-white line-clamp-2 leading-snug">
                  {manifest.title}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
                  <span>ID: {manifest.videoId}</span>
                  <span>•</span>
                  <span>{manifest.videoTracks.length} Video Formats</span>
                  <span>•</span>
                  <span>{manifest.audioTracks.length} Audio Tracks</span>
                </div>
              </div>
            </div>

            {/* Mode Selector Pill */}
            <div className="shrink-0 flex items-center p-1 bg-slate-900/90 border border-slate-700/80 rounded-xl shadow-inner">
              <button
                type="button"
                onClick={() => setAppMode('video')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  appMode === 'video'
                    ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Video Mode</span>
              </button>

              <button
                type="button"
                onClick={() => setAppMode('audio')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  appMode === 'audio'
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-purple-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Music className="w-3.5 h-3.5" />
                <span>Audio Mode</span>
              </button>
            </div>
          </section>
        )}

        {/* Loading Skeleton */}
        {isExtracting && (
          <div className="glass-panel rounded-2xl p-8 space-y-4 animate-pulse">
            <div className="h-6 bg-slate-800/60 rounded w-1/3" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="h-28 bg-slate-800/40 rounded-xl" />
              <div className="h-28 bg-slate-800/40 rounded-xl" />
              <div className="h-28 bg-slate-800/40 rounded-xl" />
            </div>
          </div>
        )}

        {/* 3. Mode-Specific Stream Configuration */}
        {manifest && !isExtracting && (
          <section className="glass-panel rounded-2xl p-6 md:p-8 space-y-6">
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
      <footer className="border-t border-slate-900 bg-[#06080f] py-6 text-xs text-slate-500 text-center">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>PulseStream • Zero-Transcoding Desktop YouTube Media Engine</p>
          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Direct Stream Extraction (-c copy)
            </span>
          </div>
        </div>
      </footer>

      {/* Modals */}
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

      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
