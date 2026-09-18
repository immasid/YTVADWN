import {
  NormalizedManifest,
  DownloadJobRequest,
  DownloadProgressPayload,
  VerificationResult,
  QueueJob,
  SessionSettings,
  DiagnosticReport,
  HistoryRecord,
} from '../types/media';

// Helper to check if running inside Tauri runtime
export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export const formatBytes = (bytes: number | null | undefined): string => {
  if (!bytes || bytes <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatSpeed = (bytesPerSec: number): string => {
  if (bytesPerSec <= 0) return '0.0 MB/s';
  const mbps = bytesPerSec / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
};

export const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Sample realistic mock manifest for development and browser previews
const MOCK_MANIFEST: NormalizedManifest = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Rick Astley - Never Gonna Give You Up (Official Music Video 4K Remaster)',
  durationSeconds: 213,
  thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=60',
  videoTracks: [
    {
      formatId: '313',
      resolution: '3840x2160',
      label: '4K (2160p60)',
      fps: 60,
      codec: 'vp9',
      container: 'webm',
      filesizeBytes: 248912400,
      isHdr: true,
    },
    {
      formatId: '399',
      resolution: '1920x1080',
      label: '1080p60 HDR',
      fps: 60,
      codec: 'av1',
      container: 'webm',
      filesizeBytes: 94521094,
      isHdr: true,
    },
    {
      formatId: '137',
      resolution: '1920x1080',
      label: '1080p',
      fps: 30,
      codec: 'h264',
      container: 'mp4',
      filesizeBytes: 68120391,
      isHdr: false,
    },
    {
      formatId: '247',
      resolution: '1280x720',
      label: '720p60',
      fps: 60,
      codec: 'vp9',
      container: 'webm',
      filesizeBytes: 42109820,
      isHdr: false,
    },
    {
      formatId: '136',
      resolution: '1280x720',
      label: '720p',
      fps: 30,
      codec: 'h264',
      container: 'mp4',
      filesizeBytes: 35120391,
      isHdr: false,
    }
  ],
  audioTracks: [
    {
      formatId: '251',
      language: 'en',
      languageLabel: 'English',
      role: 'original',
      codec: 'opus',
      container: 'webm',
      nominalBitrateKbps: 160,
      sampleRateHz: 48000,
      channels: 2,
      isDefault: true,
    },
    {
      formatId: '140',
      language: 'en',
      languageLabel: 'English',
      role: 'original',
      codec: 'aac',
      container: 'm4a',
      nominalBitrateKbps: 128,
      sampleRateHz: 44100,
      channels: 2,
      isDefault: false,
    },
    {
      formatId: '251-es',
      language: 'es',
      languageLabel: 'Spanish',
      role: 'dub',
      codec: 'opus',
      container: 'webm',
      nominalBitrateKbps: 160,
      sampleRateHz: 48000,
      channels: 2,
      isDefault: false,
    },
    {
      formatId: '251-desc',
      language: 'en',
      languageLabel: 'English',
      role: 'descriptive',
      codec: 'opus',
      container: 'webm',
      nominalBitrateKbps: 128,
      sampleRateHz: 48000,
      channels: 2,
      isDefault: false,
    }
  ],
};

/**
 * Extracts normalized media manifest from YouTube URL.
 */
export async function apiExtractManifest(url: string, cookiePath?: string): Promise<NormalizedManifest> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<NormalizedManifest>('extract_manifest', {
      url,
      cookiePath: cookiePath || null,
    });
  }

  // Simulated browser fallback
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (url.includes('error-429') || url.includes('bot-challenge')) {
    throw new Error('Sign in to confirm you’re not a bot (HTTP 429). Please load browser cookies via settings.');
  }

  return {
    ...MOCK_MANIFEST,
    title: url.includes('rick')
      ? MOCK_MANIFEST.title
      : 'Authentic YouTube Media Stream (PulseStream Lossless)',
  };
}

/**
 * Starts download job and binds progress listener.
 */
export async function apiStartDownload(
  request: DownloadJobRequest,
  onProgress: (payload: DownloadProgressPayload) => void
): Promise<VerificationResult> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    const unlisten = await listen<DownloadProgressPayload>('download-progress', (event) => {
      onProgress(event.payload);
    });

    try {
      const result = await invoke<VerificationResult>('start_download', { request });
      return result;
    } finally {
      unlisten();
    }
  }

  // Simulated browser download flow
  const jobId = `${Date.now()}_job`;
  onProgress({
    jobId,
    phase: 'discovering',
    stream: 'overall',
    percent: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  });

  await new Promise((r) => setTimeout(r, 600));

  onProgress({
    jobId,
    phase: 'downloading',
    stream: request.mode === 'video' ? 'video' : 'audio',
    percent: 45,
    speedBytesPerSec: 15728640,
    etaSeconds: 6,
    downloadedBytes: 42000000,
    totalBytes: 94000000,
  });

  await new Promise((r) => setTimeout(r, 800));

  onProgress({
    jobId,
    phase: 'downloading',
    stream: request.mode === 'video' && request.audioFormatId ? 'audio' : 'video',
    percent: 85,
    speedBytesPerSec: 18874368,
    etaSeconds: 2,
    downloadedBytes: 80000000,
    totalBytes: 94000000,
  });

  await new Promise((r) => setTimeout(r, 700));

  onProgress({
    jobId,
    phase: 'remuxing',
    stream: 'overall',
    percent: 100,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    downloadedBytes: 94000000,
    totalBytes: 94000000,
  });

  await new Promise((r) => setTimeout(r, 800));

  onProgress({
    jobId,
    phase: 'verifying',
    stream: 'overall',
    percent: 100,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    downloadedBytes: 94000000,
    totalBytes: 94000000,
  });

  await new Promise((r) => setTimeout(r, 600));

  const videoCodec = request.expectedVideo?.codec || 'av1';
  const audioCodec = request.expectedAudio?.codec || 'opus';

  const isDirect = request.mode === 'audio' && (request.targetContainer === 'auto' || request.targetContainer === 'webm');
  const verification: VerificationResult = {
    status: 'verified',
    policyAuditPassed: true,
    codecMatch: true,
    dimensionsMatch: true,
    sampleRateMatch: true,
    details: `Tier 1 Policy Audit: PASSED (-c copy confirmed, zero re-encoding flags).\nAudio Codec Match: '${audioCodec}' verified.\nAudio Sample Rate Match: 48000 Hz verified.\nAudio Bitrate Integrity: VBR tolerance active (verified via lossless policy audit).\nVideo Codec Match: '${videoCodec}' verified.\nVideo Dimensions Match: 1920x1080 verified.`,
    audit: {
      operation: isDirect ? 'DirectDownload' : 'LosslessRemux',
      executable: isDirect ? 'yt-dlp' : 'ffmpeg',
      arguments: isDirect
        ? ['-f', request.audioFormatId || '251', '-o', 'out.webm']
        : ['-y', '-i', 'video.tmp', '-i', 'audio.tmp', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'],
      streamCopy: true,
      encodingRequested: false,
    },
  };

  onProgress({
    jobId,
    phase: 'completed',
    stream: 'overall',
    percent: 100,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    downloadedBytes: 94000000,
    totalBytes: 94000000,
  });

  return verification;
}

// In-memory mock state for browser preview
let mockQueueItems: QueueJob[] = [];
let mockSettings: SessionSettings = {
  cookieMode: 'none',
  cookieFilePath: null,
  browserName: null,
  enablePoToken: false,
  poTokenValue: null,
  customExtractorArgs: null,
};
let mockQueueListeners: Array<() => void> = [];

export async function apiEnqueueJob(request: DownloadJobRequest): Promise<string> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('enqueue_job', { request });
  }

  const id = `${Date.now()}_${request.audioFormatId || 'mute'}`;
  const newJob: QueueJob = {
    id,
    request,
    status: 'queued',
    progress: {
      jobId: id,
      phase: 'discovering',
      stream: 'overall',
      percent: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    },
    verification: null,
    errorMessage: null,
    outputPath: null,
    createdAt: Date.now(),
  };

  mockQueueItems.push(newJob);
  mockQueueListeners.forEach((fn) => fn());

  // Simulate execution in browser mock
  setTimeout(() => {
    const j = mockQueueItems.find((x) => x.id === id);
    if (j && j.status === 'queued') {
      j.status = 'active';
      j.progress.phase = 'downloading';
      j.progress.percent = 45;
      j.progress.speedBytesPerSec = 12000000;
      mockQueueListeners.forEach((fn) => fn());

      setTimeout(() => {
        if (j.status === 'active') {
          j.status = 'completed';
          j.progress.phase = 'completed';
          j.progress.percent = 100;
          j.outputPath = `/mock/downloads/${request.title || 'PulseStream'}.${request.targetContainer === 'auto' ? 'mp4' : request.targetContainer}`;
          j.verification = {
            status: 'verified',
            policyAuditPassed: true,
            codecMatch: true,
            dimensionsMatch: true,
            sampleRateMatch: true,
            details: 'Browser simulation verified: Bitstream copy preserved without transcoding.',
            audit: {
              operation: 'LosslessRemux',
              executable: 'ffmpeg',
              arguments: ['-i', 'v.tmp', '-i', 'a.tmp', '-c', 'copy', 'out.mp4'],
              streamCopy: true,
              encodingRequested: false,
            },
          };
          mockQueueListeners.forEach((fn) => fn());
        }
      }, 2500);
    }
  }, 1000);

  return id;
}

export async function apiCancelJob(jobId: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('cancel_job', { jobId });
    return;
  }

  const found = mockQueueItems.find((j) => j.id === jobId);
  if (found) {
    found.status = 'cancelled';
    found.progress.phase = 'failed';
    mockQueueListeners.forEach((fn) => fn());
  }
}

export async function apiPauseQueue(): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pause_queue');
    return;
  }
  mockQueueItems.forEach((j) => {
    if (j.status === 'queued') j.status = 'paused';
  });
  mockQueueListeners.forEach((fn) => fn());
}

export async function apiResumeQueue(): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('resume_queue');
    return;
  }
  mockQueueItems.forEach((j) => {
    if (j.status === 'paused') j.status = 'queued';
  });
  mockQueueListeners.forEach((fn) => fn());
}

export async function apiGetQueueItems(): Promise<QueueJob[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<QueueJob[]>('get_queue_items');
  }
  return [...mockQueueItems];
}

export async function apiClearCompletedJobs(): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_completed_jobs');
    return;
  }
  mockQueueItems = mockQueueItems.filter(
    (j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'cancelled'
  );
  mockQueueListeners.forEach((fn) => fn());
}

export async function apiGetSessionSettings(): Promise<SessionSettings> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<SessionSettings>('get_session_settings');
  }
  return { ...mockSettings };
}

export async function apiUpdateSessionSettings(settings: SessionSettings): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_session_settings', { settings });
    return;
  }
  mockSettings = { ...settings };
}

export async function apiGetSystemDiagnostics(): Promise<DiagnosticReport> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<DiagnosticReport>('get_system_diagnostics');
  }

  // Mock report for web preview
  return {
    ytDlp: {
      name: 'yt-dlp',
      path: '/usr/local/bin/yt-dlp',
      version: '2025.02.19',
      status: 'healthy',
      errorMessage: null,
      details: 'Active binary healthy and responsive',
    },
    deno: {
      name: 'deno',
      path: null,
      version: null,
      status: 'missing',
      errorMessage: 'Deno runtime was not found in system PATH (optional helper)',
      details: null,
    },
    ffmpeg: {
      name: 'ffmpeg',
      path: '/usr/bin/ffmpeg',
      version: 'ffmpeg version 7.1',
      status: 'healthy',
      errorMessage: null,
      details: 'Zero-transcoding stream-copy supported (-c copy verified)',
    },
    ffprobe: {
      name: 'ffprobe',
      path: '/usr/bin/ffprobe',
      version: 'ffprobe version 7.1',
      status: 'healthy',
      errorMessage: null,
      details: 'Stream analysis and metadata verification active',
    },
    allHealthy: true,
  };
}

export async function apiShowInFolder(path: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_in_folder', { path });
    return;
  }
  console.log(`[PulseStream] Show in folder mock: ${path}`);
}

export async function listenQueueUpdated(callback: () => void): Promise<() => void> {
  if (isTauriEnvironment()) {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('queue-updated', () => callback());
  }
  mockQueueListeners.push(callback);
  return () => {
    mockQueueListeners = mockQueueListeners.filter((fn) => fn !== callback);
  };
}

let mockHistory: HistoryRecord[] = [
  {
    id: 'mock_hist_1',
    videoId: '6x5xtNhOts0',
    title: 'Most Powerful & Auspicious HARI MANTRA',
    thumbnailUrl: 'https://img.youtube.com/vi/6x5xtNhOts0/hqdefault.jpg',
    completedAt: Math.floor(Date.now() / 1000) - 3600,
    filePath: '/home/s/Downloads/PulseStream/Most_Powerful_HARI_MANTRA.mp4',
    fileSizeBytes: 47683921,
    mediaType: 'video',
    videoCodec: 'h264',
    audioCodec: 'aac',
    container: 'mp4',
    audit: {
      operation: 'LosslessRemux',
      executable: 'ffmpeg',
      arguments: ['-i', 'video.tmp', '-i', 'audio.tmp', '-c', 'copy', 'output.mp4'],
      streamCopy: true,
      encodingRequested: false,
    },
    verification: {
      status: 'verified',
      policyAuditPassed: true,
      codecMatch: true,
      dimensionsMatch: true,
      sampleRateMatch: true,
      details: 'Lossless stream copy verified with zero transcoding',
      audit: null,
    },
  },
];

let mockHistoryListeners: Array<() => void> = [];

export async function apiGetHistory(): Promise<HistoryRecord[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<HistoryRecord[]>('get_history');
  }
  return [...mockHistory];
}

export async function apiClearHistory(): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_history');
    return;
  }
  mockHistory = [];
  mockHistoryListeners.forEach((fn) => fn());
}

export async function apiDeleteHistoryItem(id: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_history_item', { id });
    return;
  }
  mockHistory = mockHistory.filter((h) => h.id !== id);
  mockHistoryListeners.forEach((fn) => fn());
}

export async function listenHistoryUpdated(callback: () => void): Promise<() => void> {
  if (isTauriEnvironment()) {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('history-updated', () => callback());
  }
  mockHistoryListeners.push(callback);
  return () => {
    mockHistoryListeners = mockHistoryListeners.filter((fn) => fn !== callback);
  };
}


