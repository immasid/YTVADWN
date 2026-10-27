import {
  NormalizedManifest,
  VideoTrack,
  AudioTrack,
  TargetContainer,
  BatchRule,
  PreferredAudioCodec,
} from '../types/media';

export interface BatchSelection {
  selectedVideoTrack: VideoTrack | null;
  selectedAudioTrack: AudioTrack | null;
  targetContainer: TargetContainer;
  mode: 'video' | 'audio';
}

/**
 * Deterministically applies audio codec preference to a normalized manifest.
 * Preserves zero-transcoding invariants (-c copy).
 */
export function applyAudioCodecPreference(
  manifest: NormalizedManifest,
  currentAudioTrack: AudioTrack | null,
  targetContainer: TargetContainer,
  preferredCodec: PreferredAudioCodec
): {
  selectedAudioTrack: AudioTrack | null;
  targetContainer: TargetContainer;
  matched: boolean;
} {
  if (preferredCodec === 'auto') {
    const defaultAudio =
      manifest.audioTracks.find((a) => a.isDefault) ||
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
      manifest.audioTracks[0] ||
      null;
    return {
      selectedAudioTrack: defaultAudio,
      targetContainer,
      matched: true,
    };
  }

  const codecStr = preferredCodec.toLowerCase();
  const matchedTrack =
    manifest.audioTracks.find(
      (a) =>
        a.codec.toLowerCase().includes(codecStr) ||
        (codecStr === 'aac' && a.container.toLowerCase() === 'm4a') ||
        (codecStr === 'opus' && a.container.toLowerCase() === 'webm')
    ) ||
    currentAudioTrack ||
    manifest.audioTracks.find((a) => a.isDefault) ||
    manifest.audioTracks[0] ||
    null;

  const matched = Boolean(
    matchedTrack &&
      (matchedTrack.codec.toLowerCase().includes(codecStr) ||
        (codecStr === 'aac' && matchedTrack.container.toLowerCase() === 'm4a') ||
        (codecStr === 'opus' && matchedTrack.container.toLowerCase() === 'webm'))
  );

  let adjustedContainer = targetContainer;
  // If user selected Opus and container was MP4, switch to auto (losslessly remuxed to MKV or WebM)
  if (preferredCodec === 'opus' && adjustedContainer === 'mp4') {
    adjustedContainer = 'auto';
  }

  return {
    selectedAudioTrack: matchedTrack,
    targetContainer: adjustedContainer,
    matched,
  };
}

/**
 * Deterministically applies a batch quick-apply rule to a normalized manifest.
 * Preserves zero-transcoding invariants (-c copy).
 */
export function applyBatchRule(
  manifest: NormalizedManifest,
  rule: BatchRule,
  preferredCodec: PreferredAudioCodec = 'auto'
): BatchSelection {
  let baseSelection: BatchSelection;

  if (rule === 'audio_only') {
    // Select best audio track (Opus preferred or default/first)
    const bestAudio =
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
      manifest.audioTracks.find((a) => a.isDefault) ||
      manifest.audioTracks[0] ||
      null;

    baseSelection = {
      selectedVideoTrack: null,
      selectedAudioTrack: bestAudio,
      targetContainer: 'auto',
      mode: 'audio',
    };
  } else if (rule === '1080p_mp4') {
    // Find 1080p track preferring MP4/h264 for MP4 container compatibility
    const track1080 =
      manifest.videoTracks.find(
        (v) => (v.label.toLowerCase().includes('1080') || v.resolution.includes('1080')) &&
               v.container.toLowerCase() === 'mp4'
      ) ||
      manifest.videoTracks.find(
        (v) => v.label.toLowerCase().includes('1080') || v.resolution.includes('1080')
      ) ||
      manifest.videoTracks.find((v) => {
        const parts = v.resolution.split('x');
        const height = parseInt(parts[1] || '0', 10);
        return height > 0 && height <= 1080;
      }) ||
      manifest.videoTracks[0] ||
      null;

    // Prefer AAC/m4a for standard MP4 container
    const mp4Audio =
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('aac') || a.container.toLowerCase() === 'm4a') ||
      manifest.audioTracks.find((a) => a.isDefault) ||
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
      manifest.audioTracks[0] ||
      null;

    baseSelection = {
      selectedVideoTrack: track1080,
      selectedAudioTrack: mp4Audio,
      targetContainer: 'mp4',
      mode: 'video',
    };
  } else if (rule === '1080p_opus') {
    // Find 1080p track or highest available <= 1080p
    const track1080 =
      manifest.videoTracks.find(
        (v) => v.label.toLowerCase().includes('1080') || v.resolution.includes('1080')
      ) ||
      manifest.videoTracks.find((v) => {
        const parts = v.resolution.split('x');
        const height = parseInt(parts[1] || '0', 10);
        return height > 0 && height <= 1080;
      }) ||
      manifest.videoTracks[0] ||
      null;

    const opusAudio =
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
      manifest.audioTracks.find((a) => a.isDefault) ||
      manifest.audioTracks[0] ||
      null;

    baseSelection = {
      selectedVideoTrack: track1080,
      selectedAudioTrack: opusAudio,
      targetContainer: 'auto',
      mode: 'video',
    };
  } else {
    // Default: 'highest_lossless'
    const highestVideo = manifest.videoTracks[0] || null;
    const bestAudio =
      manifest.audioTracks.find((a) => a.isDefault) ||
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
      manifest.audioTracks[0] ||
      null;

    baseSelection = {
      selectedVideoTrack: highestVideo,
      selectedAudioTrack: bestAudio,
      targetContainer: 'auto',
      mode: 'video',
    };
  }

  // If specific audio codec is preferred and it's not auto, apply preference
  if (preferredCodec !== 'auto') {
    const audioPref = applyAudioCodecPreference(
      manifest,
      baseSelection.selectedAudioTrack,
      baseSelection.targetContainer,
      preferredCodec
    );
    baseSelection.selectedAudioTrack = audioPref.selectedAudioTrack;
    baseSelection.targetContainer = audioPref.targetContainer;
  }

  return baseSelection;
}
