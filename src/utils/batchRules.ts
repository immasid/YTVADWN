import {
  NormalizedManifest,
  VideoTrack,
  AudioTrack,
  TargetContainer,
  BatchRule,
} from '../types/media';

export interface BatchSelection {
  selectedVideoTrack: VideoTrack | null;
  selectedAudioTrack: AudioTrack | null;
  targetContainer: TargetContainer;
  mode: 'video' | 'audio';
}

/**
 * Deterministically applies a batch quick-apply rule to a normalized manifest.
 * Preserves zero-transcoding invariants (-c copy).
 */
export function applyBatchRule(manifest: NormalizedManifest, rule: BatchRule): BatchSelection {
  if (rule === 'audio_only') {
    // Select best audio track (Opus preferred or default/first)
    const bestAudio =
      manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
      manifest.audioTracks.find((a) => a.isDefault) ||
      manifest.audioTracks[0] ||
      null;

    return {
      selectedVideoTrack: null,
      selectedAudioTrack: bestAudio,
      targetContainer: 'auto',
      mode: 'audio',
    };
  }

  if (rule === '1080p_opus') {
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

    return {
      selectedVideoTrack: track1080,
      selectedAudioTrack: opusAudio,
      targetContainer: 'auto',
      mode: 'video',
    };
  }

  // Default: 'highest_lossless'
  const highestVideo = manifest.videoTracks[0] || null;
  const bestAudio =
    manifest.audioTracks.find((a) => a.isDefault) ||
    manifest.audioTracks.find((a) => a.codec.toLowerCase().includes('opus')) ||
    manifest.audioTracks[0] ||
    null;

  return {
    selectedVideoTrack: highestVideo,
    selectedAudioTrack: bestAudio,
    targetContainer: 'auto',
    mode: 'video',
  };
}
