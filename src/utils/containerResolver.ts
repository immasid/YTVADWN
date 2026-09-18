import { TargetContainer } from '../types/media';

export interface ContainerResolution {
  finalContainer: string;
  requiresRemux: boolean;
  compatibilityWarning: string | null;
}

export interface ResolveContainerOptions {
  videoCodec: string | null;
  audioCodec: string | null;
  requestedContainer?: TargetContainer;
  sourceContainer?: string | null;
}

/**
 * Normalizes raw codec strings from YouTube/yt-dlp manifests or FFmpeg into standard canonical tokens.
 * e.g. "avc1.640028" -> "h264", "vp09.00.51.08" -> "vp9", "av01.0.08m.08" -> "av1", "mp4a.40.2" -> "aac".
 */
export function normalizeCodec(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const c = codec.trim().toLowerCase();
  if (c === '' || c === 'none' || c === 'null' || c === 'undefined') {
    return null;
  }

  // Video codecs
  if (c.startsWith('avc') || c.includes('h264') || c.includes('h.264') || c.includes('x264')) {
    return 'h264';
  }
  if (c.startsWith('vp09') || c.startsWith('vp9') || c === 'vp8') {
    return 'vp9';
  }
  if (c.startsWith('av01') || c.startsWith('av1') || c.includes('dav1d')) {
    return 'av1';
  }

  // Audio codecs
  if (c.includes('opus')) {
    return 'opus';
  }
  if (c.startsWith('mp4a') || c.includes('aac') || c === 'm4a') {
    return 'aac';
  }

  return c;
}

/**
 * Normalizes container extensions (strips leading dots and lowercases).
 */
function cleanContainer(ext: string | null | undefined): string | null {
  if (!ext) return null;
  return ext.replace(/^\./, '').trim().toLowerCase();
}

/**
 * Deterministic Lossless Container Resolution Matrix
 *
 * Core Invariant: NEVER decode, re-encode, convert, or upscale any media stream.
 * Direct stream extraction or lossless remuxing (-c copy) only.
 *
 * Inputs:
 * - videoCodec: string | null (null for audio-only)
 * - audioCodec: string (empty/none/null for video-only)
 * - requestedContainer: 'auto' | 'mkv' | 'webm' | 'mp4' (default: 'auto')
 * - sourceContainer: optional source container extension (e.g. 'webm', 'mp4', 'm4a')
 *
 * Matrix logic:
 * - 'auto':
 *   * Video-only: preserve source container (requiresRemux: false).
 *   * Audio-only: Opus -> .webm / .opus; AAC -> .m4a (requiresRemux: false).
 *   * Video + Audio (requiresRemux: true):
 *     - H.264 + AAC -> .mp4
 *     - AV1/VP9 + Opus -> .webm
 *     - H.264 + Opus -> .mkv
 *     - VP9 + AAC -> .mkv
 *     - AV1 + AAC -> .mkv
 * - User-specified container ('mkv' | 'webm' | 'mp4'):
 *   * MKV: Universal lossless container, no warnings.
 *   * MP4 with Opus: Warning (limited Apple/hardware playback support).
 *   * MP4 with VP9: Warning (non-standard container pairing).
 *   * WebM with H.264: Warning (WebM does not standardly support H.264).
 *   * WebM with AAC: Warning (WebM does not support AAC audio).
 */
export function resolveContainer(
  videoCodec: string | null,
  audioCodec: string | null,
  requestedContainer?: TargetContainer,
  sourceContainer?: string | null
): ContainerResolution;
export function resolveContainer(
  options: ResolveContainerOptions
): ContainerResolution;
export function resolveContainer(
  arg1: string | null | ResolveContainerOptions,
  arg2?: string | null,
  arg3: TargetContainer = 'auto',
  arg4?: string | null
): ContainerResolution {
  let rawVideo: string | null = null;
  let rawAudio: string | null = null;
  let requested: TargetContainer = 'auto';
  let rawSource: string | null = null;

  if (arg1 !== null && typeof arg1 === 'object') {
    rawVideo = arg1.videoCodec;
    rawAudio = arg1.audioCodec;
    requested = arg1.requestedContainer || 'auto';
    rawSource = arg1.sourceContainer ?? null;
  } else {
    rawVideo = arg1;
    rawAudio = arg2 ?? null;
    requested = arg3 || 'auto';
    rawSource = arg4 ?? null;
  }

  const vCodec = normalizeCodec(rawVideo);
  const aCodec = normalizeCodec(rawAudio);
  const srcCont = cleanContainer(rawSource);

  const isVideoOnly = vCodec !== null && aCodec === null;
  const isAudioOnly = vCodec === null && aCodec !== null;
  const isMuxed = vCodec !== null && aCodec !== null;

  // 1. VIDEO-ONLY
  if (isVideoOnly) {
    if (requested === 'auto') {
      const finalContainer = srcCont || (vCodec === 'h264' ? 'mp4' : 'webm');
      return {
        finalContainer,
        requiresRemux: false,
        compatibilityWarning: null,
      };
    }

    // User forced container for video-only
    const matchesSource = srcCont && srcCont === requested;
    let warning: string | null = null;

    if (vCodec === 'h264' && requested === 'webm') {
      warning = 'WebM container does not standardly support H.264 video. MP4 or MKV is recommended.';
    } else if (vCodec === 'vp9' && requested === 'mp4') {
      warning = 'VP9 video in an MP4 container is non-standard and may fail to play on QuickTime or Windows Media Player. WebM or MKV is recommended.';
    }

    return {
      finalContainer: requested,
      requiresRemux: !matchesSource,
      compatibilityWarning: warning,
    };
  }

  // 2. AUDIO-ONLY
  if (isAudioOnly) {
    if (requested === 'auto') {
      if (aCodec === 'opus') {
        const finalCont = srcCont === 'opus' ? 'opus' : 'webm';
        return {
          finalContainer: finalCont,
          requiresRemux: false,
          compatibilityWarning: null,
        };
      }

      if (aCodec === 'aac') {
        return {
          finalContainer: 'm4a',
          requiresRemux: false,
          compatibilityWarning: null,
        };
      }

      return {
        finalContainer: srcCont || 'mka',
        requiresRemux: false,
        compatibilityWarning: null,
      };
    }

    // User forced container for audio-only
    if (requested === 'mkv') {
      return {
        finalContainer: 'mkv',
        requiresRemux: srcCont !== 'mkv',
        compatibilityWarning: null,
      };
    }

    if (requested === 'mp4') {
      if (aCodec === 'aac') {
        return {
          finalContainer: 'm4a',
          requiresRemux: false,
          compatibilityWarning: null,
        };
      }
      if (aCodec === 'opus') {
        return {
          finalContainer: 'mp4',
          requiresRemux: true,
          compatibilityWarning: 'Opus audio in an MP4 container has limited playback compatibility on Apple devices and older media players. MKV or WebM is recommended.',
        };
      }
    }

    if (requested === 'webm') {
      if (aCodec === 'opus') {
        return {
          finalContainer: 'webm',
          requiresRemux: srcCont !== 'webm',
          compatibilityWarning: null,
        };
      }
      if (aCodec === 'aac') {
        return {
          finalContainer: 'webm',
          requiresRemux: true,
          compatibilityWarning: 'WebM container does not support AAC audio (only Opus and Vorbis are valid in WebM). MKV or M4A is recommended.',
        };
      }
    }

    return {
      finalContainer: requested,
      requiresRemux: true,
      compatibilityWarning: null,
    };
  }

  // 3. VIDEO + AUDIO (MUXED)
  // Combining separate video and audio streams always requires a lossless remux (-c copy)
  if (isMuxed) {
    if (requested === 'auto') {
      // H.264 + AAC -> .mp4
      if (vCodec === 'h264' && aCodec === 'aac') {
        return {
          finalContainer: 'mp4',
          requiresRemux: true,
          compatibilityWarning: null,
        };
      }

      // AV1/VP9 + Opus -> .webm
      if ((vCodec === 'av1' || vCodec === 'vp9') && aCodec === 'opus') {
        return {
          finalContainer: 'webm',
          requiresRemux: true,
          compatibilityWarning: null,
        };
      }

      // H.264 + Opus -> .mkv
      if (vCodec === 'h264' && aCodec === 'opus') {
        return {
          finalContainer: 'mkv',
          requiresRemux: true,
          compatibilityWarning: null,
        };
      }

      // VP9 + AAC -> .mkv
      if (vCodec === 'vp9' && aCodec === 'aac') {
        return {
          finalContainer: 'mkv',
          requiresRemux: true,
          compatibilityWarning: null,
        };
      }

      // AV1 + AAC -> .mkv
      if (vCodec === 'av1' && aCodec === 'aac') {
        return {
          finalContainer: 'mkv',
          requiresRemux: true,
          compatibilityWarning: null,
        };
      }

      // Universal fallback for any other combination
      return {
        finalContainer: 'mkv',
        requiresRemux: true,
        compatibilityWarning: null,
      };
    }

    // User forced container
    if (requested === 'mkv') {
      return {
        finalContainer: 'mkv',
        requiresRemux: true,
        compatibilityWarning: null,
      };
    }

    if (requested === 'mp4') {
      let warning: string | null = null;
      if (aCodec === 'opus') {
        warning = 'Opus audio in an MP4 container has limited playback compatibility on Apple devices and older media players. MKV is strongly recommended.';
      } else if (vCodec === 'vp9') {
        warning = 'VP9 video in an MP4 container is non-standard and may fail to play on QuickTime or Windows Media Player. MKV or WebM is recommended.';
      }

      return {
        finalContainer: 'mp4',
        requiresRemux: true,
        compatibilityWarning: warning,
      };
    }

    if (requested === 'webm') {
      let warning: string | null = null;
      if (vCodec === 'h264') {
        warning = 'WebM container does not standardly support H.264 video. MP4 or MKV is recommended.';
      } else if (aCodec === 'aac') {
        warning = 'WebM container does not support AAC audio (only Opus and Vorbis are valid in WebM). MKV or MP4 is recommended.';
      }

      return {
        finalContainer: 'webm',
        requiresRemux: true,
        compatibilityWarning: warning,
      };
    }

    return {
      finalContainer: requested,
      requiresRemux: true,
      compatibilityWarning: null,
    };
  }

  // Fallback if neither video nor audio provided
  return {
    finalContainer: requested === 'auto' ? 'mp4' : requested,
    requiresRemux: false,
    compatibilityWarning: null,
  };
}
