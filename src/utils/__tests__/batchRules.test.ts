import { describe, it, expect } from 'vitest';
import { applyBatchRule } from '../batchRules';
import { NormalizedManifest } from '../../types/media';

const testManifest: NormalizedManifest = {
  videoId: 'test_vid_1',
  title: 'Test Stream Title',
  durationSeconds: 300,
  thumbnailUrl: 'https://example.com/thumb.jpg',
  videoTracks: [
    {
      formatId: '313',
      resolution: '3840x2160',
      label: '4K (2160p60)',
      fps: 60,
      codec: 'vp9',
      container: 'webm',
      filesizeBytes: 500000000,
      isHdr: false,
    },
    {
      formatId: '137',
      resolution: '1920x1080',
      label: '1080p',
      fps: 30,
      codec: 'h264',
      container: 'mp4',
      filesizeBytes: 200000000,
      isHdr: false,
    },
    {
      formatId: '247',
      resolution: '1280x720',
      label: '720p',
      fps: 30,
      codec: 'vp9',
      container: 'webm',
      filesizeBytes: 100000000,
      isHdr: false,
    },
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
  ],
};

describe('applyBatchRule', () => {
  it('selects highest resolution for highest_lossless rule', () => {
    const result = applyBatchRule(testManifest, 'highest_lossless');
    expect(result.mode).toBe('video');
    expect(result.selectedVideoTrack?.formatId).toBe('313');
    expect(result.selectedVideoTrack?.resolution).toBe('3840x2160');
    expect(result.selectedAudioTrack?.codec).toBe('opus');
    expect(result.targetContainer).toBe('auto');
  });

  it('selects 1080p track and opus audio for 1080p_opus rule', () => {
    const result = applyBatchRule(testManifest, '1080p_opus');
    expect(result.mode).toBe('video');
    expect(result.selectedVideoTrack?.formatId).toBe('137');
    expect(result.selectedVideoTrack?.resolution).toBe('1920x1080');
    expect(result.selectedAudioTrack?.codec).toBe('opus');
    expect(result.targetContainer).toBe('auto');
  });

  it('selects audio only for audio_only rule', () => {
    const result = applyBatchRule(testManifest, 'audio_only');
    expect(result.mode).toBe('audio');
    expect(result.selectedVideoTrack).toBeNull();
    expect(result.selectedAudioTrack?.codec).toBe('opus');
    expect(result.targetContainer).toBe('auto');
  });
});
