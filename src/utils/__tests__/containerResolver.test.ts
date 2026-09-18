import { describe, it, expect } from 'vitest';
import { resolveContainer, normalizeCodec } from '../containerResolver';

describe('normalizeCodec', () => {
  it('normalizes common H.264 variants to h264', () => {
    expect(normalizeCodec('avc1.640028')).toBe('h264');
    expect(normalizeCodec('h264')).toBe('h264');
    expect(normalizeCodec('H.264')).toBe('h264');
    expect(normalizeCodec('x264')).toBe('h264');
  });

  it('normalizes VP9 variants to vp9', () => {
    expect(normalizeCodec('vp09.00.51.08')).toBe('vp9');
    expect(normalizeCodec('vp9')).toBe('vp9');
    expect(normalizeCodec('VP9')).toBe('vp9');
  });

  it('normalizes AV1 variants to av1', () => {
    expect(normalizeCodec('av01.0.08m.08')).toBe('av1');
    expect(normalizeCodec('av1')).toBe('av1');
  });

  it('normalizes audio codecs', () => {
    expect(normalizeCodec('opus')).toBe('opus');
    expect(normalizeCodec('mp4a.40.2')).toBe('aac');
    expect(normalizeCodec('aac')).toBe('aac');
    expect(normalizeCodec('m4a')).toBe('aac');
  });

  it('handles empty and null codecs', () => {
    expect(normalizeCodec(null)).toBeNull();
    expect(normalizeCodec(undefined)).toBeNull();
    expect(normalizeCodec('')).toBeNull();
    expect(normalizeCodec('none')).toBeNull();
  });
});

describe('Container Resolution Matrix: Auto Mode', () => {
  describe('Video-Only (Preserve source container, zero remux)', () => {
    it('preserves webm source for VP9 video-only', () => {
      const res = resolveContainer('vp9', null, 'auto', 'webm');
      expect(res).toEqual({
        finalContainer: 'webm',
        requiresRemux: false,
        compatibilityWarning: null,
      });
    });

    it('preserves mp4 source for H.264 video-only', () => {
      const res = resolveContainer('h264', '', 'auto', 'mp4');
      expect(res).toEqual({
        finalContainer: 'mp4',
        requiresRemux: false,
        compatibilityWarning: null,
      });
    });

    it('infers container when source is not provided', () => {
      const h264Res = resolveContainer('h264', null, 'auto');
      expect(h264Res.finalContainer).toBe('mp4');
      expect(h264Res.requiresRemux).toBe(false);

      const vp9Res = resolveContainer('vp9', null, 'auto');
      expect(vp9Res.finalContainer).toBe('webm');
      expect(vp9Res.requiresRemux).toBe(false);
    });
  });

  describe('Audio-Only (Direct lossless stream extraction)', () => {
    it('resolves Opus to webm by default without remux', () => {
      const res = resolveContainer(null, 'opus', 'auto');
      expect(res).toEqual({
        finalContainer: 'webm',
        requiresRemux: false,
        compatibilityWarning: null,
      });
    });

    it('preserves opus container when source is opus', () => {
      const res = resolveContainer(null, 'opus', 'auto', 'opus');
      expect(res).toEqual({
        finalContainer: 'opus',
        requiresRemux: false,
        compatibilityWarning: null,
      });
    });

    it('resolves AAC to m4a without remux', () => {
      const res = resolveContainer(null, 'aac', 'auto');
      expect(res).toEqual({
        finalContainer: 'm4a',
        requiresRemux: false,
        compatibilityWarning: null,
      });
    });

    it('resolves real-world mp4a.40.2 string to m4a', () => {
      const res = resolveContainer(null, 'mp4a.40.2', 'auto');
      expect(res.finalContainer).toBe('m4a');
      expect(res.requiresRemux).toBe(false);
    });
  });

  describe('Video + Audio Muxing (Requires remux)', () => {
    it('resolves H.264 + AAC -> .mp4', () => {
      const res = resolveContainer('h264', 'aac', 'auto');
      expect(res).toEqual({
        finalContainer: 'mp4',
        requiresRemux: true,
        compatibilityWarning: null,
      });
    });

    it('resolves AV1 + Opus -> .webm', () => {
      const res = resolveContainer('av1', 'opus', 'auto');
      expect(res).toEqual({
        finalContainer: 'webm',
        requiresRemux: true,
        compatibilityWarning: null,
      });
    });

    it('resolves VP9 + Opus -> .webm', () => {
      const res = resolveContainer('vp9', 'opus', 'auto');
      expect(res).toEqual({
        finalContainer: 'webm',
        requiresRemux: true,
        compatibilityWarning: null,
      });
    });

    it('resolves H.264 + Opus -> .mkv', () => {
      const res = resolveContainer('h264', 'opus', 'auto');
      expect(res).toEqual({
        finalContainer: 'mkv',
        requiresRemux: true,
        compatibilityWarning: null,
      });
    });

    it('resolves VP9 + AAC -> .mkv', () => {
      const res = resolveContainer('vp9', 'aac', 'auto');
      expect(res).toEqual({
        finalContainer: 'mkv',
        requiresRemux: true,
        compatibilityWarning: null,
      });
    });

    it('resolves AV1 + AAC -> .mkv', () => {
      const res = resolveContainer('av1', 'aac', 'auto');
      expect(res).toEqual({
        finalContainer: 'mkv',
        requiresRemux: true,
        compatibilityWarning: null,
      });
    });
  });
});

describe('Container Resolution Matrix: User-Forced Container Overrides & Warnings', () => {
  describe('Forcing MP4', () => {
    it('warns when user forces MP4 with Opus audio (H.264 + Opus)', () => {
      const res = resolveContainer('h264', 'opus', 'mp4');
      expect(res.finalContainer).toBe('mp4');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toMatch(/Opus audio in an MP4 container/i);
    });

    it('warns when user forces MP4 with VP9 video', () => {
      const res = resolveContainer('vp9', 'aac', 'mp4');
      expect(res.finalContainer).toBe('mp4');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toMatch(/VP9 video in an MP4 container is non-standard/i);
    });

    it('allows H.264 + AAC in MP4 without warning', () => {
      const res = resolveContainer('h264', 'aac', 'mp4');
      expect(res.finalContainer).toBe('mp4');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toBeNull();
    });

    it('warns for audio-only Opus forced to MP4', () => {
      const res = resolveContainer(null, 'opus', 'mp4');
      expect(res.finalContainer).toBe('mp4');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toMatch(/Opus audio in an MP4 container/i);
    });
  });

  describe('Forcing WebM', () => {
    it('warns when user forces WebM with H.264 video', () => {
      const res = resolveContainer('h264', 'opus', 'webm');
      expect(res.finalContainer).toBe('webm');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toMatch(/WebM container does not standardly support H.264/i);
    });

    it('warns when user forces WebM with AAC audio', () => {
      const res = resolveContainer('vp9', 'aac', 'webm');
      expect(res.finalContainer).toBe('webm');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toMatch(/WebM container does not support AAC audio/i);
    });

    it('allows VP9 + Opus in WebM without warning', () => {
      const res = resolveContainer('vp9', 'opus', 'webm');
      expect(res.finalContainer).toBe('webm');
      expect(res.requiresRemux).toBe(true);
      expect(res.compatibilityWarning).toBeNull();
    });
  });

  describe('Forcing MKV (Universal Container)', () => {
    it('allows any combination in MKV with zero warnings', () => {
      const combinations: Array<[string, string]> = [
        ['h264', 'aac'],
        ['h264', 'opus'],
        ['vp9', 'aac'],
        ['vp9', 'opus'],
        ['av1', 'aac'],
        ['av1', 'opus'],
      ];

      for (const [v, a] of combinations) {
        const res = resolveContainer(v, a, 'mkv');
        expect(res.finalContainer).toBe('mkv');
        expect(res.requiresRemux).toBe(true);
        expect(res.compatibilityWarning).toBeNull();
      }
    });
  });
});

describe('Container Resolution Matrix: Options Object & Real Manifests', () => {
  it('supports options object overload', () => {
    const res = resolveContainer({
      videoCodec: 'avc1.640028',
      audioCodec: 'mp4a.40.2',
      requestedContainer: 'auto',
    });
    expect(res).toEqual({
      finalContainer: 'mp4',
      requiresRemux: true,
      compatibilityWarning: null,
    });
  });

  it('correctly resolves AV01 YouTube format string with Opus', () => {
    const res = resolveContainer({
      videoCodec: 'av01.0.08m.08',
      audioCodec: 'opus',
      requestedContainer: 'auto',
    });
    expect(res).toEqual({
      finalContainer: 'webm',
      requiresRemux: true,
      compatibilityWarning: null,
    });
  });
});
