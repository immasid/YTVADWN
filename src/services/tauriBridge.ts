import { NormalizedManifest, DownloadJobRequest, DownloadProgressPayload, VerificationResult } from '../types/media';

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
