/**
 * PulseStream Media Type Definitions & Data Contracts
 * Enforces strict types for zero-transcoding direct stream extraction and remuxing.
 */

export type VideoCodec = 'av1' | 'vp9' | 'h264' | string;
export type VideoContainer = 'webm' | 'mp4';

export type AudioCodec = 'opus' | 'aac' | string;
export type AudioContainer = 'webm' | 'm4a';
export type AudioRole = 'original' | 'dub' | 'descriptive' | 'unspecified';

export interface VideoTrack {
  formatId: string;
  resolution: string;
  label: string;
  fps: number | null;
  codec: 'av1' | 'vp9' | 'h264' | string;
  container: 'webm' | 'mp4';
  filesizeBytes: number | null;
  isHdr: boolean;
}

export interface AudioTrack {
  formatId: string;
  language: string; // ISO string e.g. "en", "es"
  languageLabel: string;
  role: 'original' | 'dub' | 'descriptive' | 'unspecified';
  codec: 'opus' | 'aac' | string;
  container: 'webm' | 'm4a';
  nominalBitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  isDefault: boolean;
}

export interface NormalizedManifest {
  videoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
  videoTracks: VideoTrack[];
  audioTracks: AudioTrack[];
}

export type TargetContainer = 'auto' | 'mkv' | 'webm' | 'mp4';

export interface DownloadJobRequest {
  url?: string;
  title?: string;
  mode: 'video' | 'audio';
  videoFormatId?: string;
  audioFormatId: string | null;
  targetContainer: 'auto' | 'mkv' | 'webm' | 'mp4';
  outputDirectory: string;
  filenameTemplate: string;
  expectedVideo?: VideoTrack;
  expectedAudio?: AudioTrack;
}

export type DownloadPhase =
  | 'discovering'
  | 'downloading'
  | 'remuxing'
  | 'verifying'
  | 'completed'
  | 'failed';

export interface DownloadProgressPayload {
  jobId: string;
  phase: 'discovering' | 'downloading' | 'remuxing' | 'verifying' | 'completed' | 'failed';
  stream: 'video' | 'audio' | 'overall';
  percent: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  downloadedBytes: number;
  totalBytes: number;
}

export interface OperationAudit {
  operation: 'DirectDownload' | 'LosslessRemux';
  executable: string;
  arguments: string[];
  streamCopy: boolean;
  encodingRequested: boolean;
}

export interface VerificationResult {
  status: 'verified' | 'failed';
  policyAuditPassed: boolean;
  codecMatch: boolean;
  dimensionsMatch: boolean;
  sampleRateMatch: boolean;
  details: string;
  audit?: OperationAudit | null;
}
