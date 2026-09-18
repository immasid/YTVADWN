import { VideoTrack, AudioTrack, TargetContainer } from '../types/media';
import { formatBytes } from '../services/tauriBridge';
import { resolveContainer } from '../utils/containerResolver';
import { Check, AlertTriangle, Info, Volume2, VolumeX, Sparkles, Film } from 'lucide-react';

interface VideoStreamCardsProps {
  videoTracks: VideoTrack[];
  audioTracks: AudioTrack[];
  selectedVideoTrack: VideoTrack | null;
  onSelectVideoTrack: (track: VideoTrack) => void;
  selectedAudioTrack: AudioTrack | null;
  onSelectAudioTrack: (track: AudioTrack | null) => void;
  requestedContainer: TargetContainer;
  onSelectRequestedContainer: (container: TargetContainer) => void;
}

export function VideoStreamCards({
  videoTracks,
  audioTracks,
  selectedVideoTrack,
  onSelectVideoTrack,
  selectedAudioTrack,
  onSelectAudioTrack,
  requestedContainer,
  onSelectRequestedContainer,
}: VideoStreamCardsProps) {
  // Sort resolutions descending
  const sortedVideoTracks = [...videoTracks].sort((a, b) => {
    const h_a: number = parseInt(a.resolution.split('x')[1] || a.resolution.replace('p', ''), 10) || 0;
    const h_b: number = parseInt(b.resolution.split('x')[1] || b.resolution.replace('p', ''), 10) || 0;
    return h_b - h_a || (b.fps ?? 0) - (a.fps ?? 0);
  });

  // Container resolution matrix evaluation
  const resolutionAdvice = resolveContainer(
    selectedVideoTrack?.codec || null,
    selectedAudioTrack?.codec || null,
    requestedContainer,
    selectedVideoTrack?.container || 'mp4'
  );

  // Group audio tracks by language
  const groupedAudio: Record<string, AudioTrack[]> = {};
  for (const a of audioTracks) {
    const key = a.languageLabel || a.language || 'English';
    if (!groupedAudio[key]) groupedAudio[key] = [];
    groupedAudio[key].push(a);
  }

  return (
    <div className="space-y-6">
      {/* 1. Video Resolution Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Film className="w-4 h-4 text-cyan-400" />
            1. Select Video Stream (Direct DASH Tracks)
          </label>
          <span className="text-[11px] text-slate-400">Sorted by highest fidelity</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sortedVideoTracks.map((track) => {
            const isSelected = selectedVideoTrack?.formatId === track.formatId;
            const codecUpper = track.codec.toUpperCase();
            const is4K = track.resolution.includes('3840') || track.resolution.includes('2160');
            const is1440p = track.resolution.includes('2560') || track.resolution.includes('1440');

            return (
              <div
                key={track.formatId}
                onClick={() => onSelectVideoTrack(track)}
                className={`relative p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500/80 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/30'
                    : 'bg-[#0b0f19] border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-white tracking-tight">
                        {is4K ? '4K Ultra HD' : is1440p ? '1440p QHD' : track.label}
                      </span>
                      {track.isHdr && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          HDR
                        </span>
                      )}
                    </div>

                    <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                      isSelected
                        ? 'bg-cyan-500 border-cyan-400 text-black'
                        : 'border-slate-700 bg-slate-900'
                    }`}>
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 font-mono mt-1">
                    {track.resolution}{track.fps ? ` • ${track.fps} fps` : ''}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px]">
                  <span className={`px-2 py-0.5 rounded font-mono font-semibold text-[10px] ${
                    codecUpper === 'AV1'
                      ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                      : codecUpper === 'VP9'
                      ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                  }`}>
                    {codecUpper}
                  </span>

                  <span className="text-slate-400 font-mono">
                    {formatBytes(track.filesizeBytes)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Audio Track Selection Dropdown */}
      <div className="space-y-2.5 pt-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-indigo-400" />
          2. Audio Track Pairing
        </label>

        <div className="relative">
          <select
            value={selectedAudioTrack ? selectedAudioTrack.formatId : 'mute'}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'mute') {
                onSelectAudioTrack(null);
              } else {
                const found = audioTracks.find((a) => a.formatId === val);
                if (found) onSelectAudioTrack(found);
              }
            }}
            className="w-full bg-[#0b0f19] border border-slate-700/80 rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 appearance-none font-medium cursor-pointer"
          >
            {Object.entries(groupedAudio).map(([language, tracks]) => (
              <optgroup key={language} label={`${language} Tracks`}>
                {tracks.map((t) => (
                  <option key={t.formatId} value={t.formatId}>
                    {t.languageLabel} [{t.role.toUpperCase()}] — {t.codec.toUpperCase()} {t.nominalBitrateKbps ? `${t.nominalBitrateKbps} kbps` : 'VBR'} ({t.container.toUpperCase()})
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Video Only">
              <option value="mute">No Audio (Mute / Video Only)</option>
            </optgroup>
          </select>
        </div>

        {selectedAudioTrack === null && (
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pl-1">
            <VolumeX className="w-3.5 h-3.5 text-amber-400" />
            <span>Video will be extracted directly without an audio stream.</span>
          </div>
        )}
      </div>

      {/* 3. Container Resolution & Output Selector */}
      <div className="space-y-2.5 pt-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            3. Lossless Container Packaging
          </label>
          <span className="text-[11px] font-mono text-cyan-400">
            Target: .{resolutionAdvice.finalContainer}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'auto', label: 'Automatic', sub: 'Lossless Best Fit' },
            { id: 'mkv', label: '.mkv', sub: 'Universal Compatibility' },
            { id: 'webm', label: '.webm', sub: 'Native AV1 / VP9' },
            { id: 'mp4', label: '.mp4', sub: 'Native H.264' },
          ].map((item) => {
            const isSelected = requestedContainer === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectRequestedContainer(item.id as TargetContainer)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-950/50 border-indigo-500/80 text-white ring-1 ring-indigo-500/20 shadow'
                    : 'bg-[#0b0f19] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold text-slate-100">{item.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{item.sub}</div>
              </button>
            );
          })}
        </div>

        {/* Dynamic Lossless Remux Info Tag */}
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center gap-2.5 text-xs text-slate-300">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            Will package into <strong className="text-cyan-300 font-mono">.{resolutionAdvice.finalContainer}</strong> {
              resolutionAdvice.requiresRemux
                ? 'losslessly via stream copy (-c copy).'
                : 'directly via direct stream extraction (zero remux).'
            }
          </span>
        </div>

        {/* Non-blocking Compatibility Warning */}
        {resolutionAdvice.compatibilityWarning && (
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Compatibility Advisory:</span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {resolutionAdvice.compatibilityWarning}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
