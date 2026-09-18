import { AudioTrack, TargetContainer } from '../types/media';
import { resolveContainer } from '../utils/containerResolver';
import { Music, Check, ShieldCheck, Sparkles, Info, AlertTriangle } from 'lucide-react';

interface AudioStreamTilesProps {
  audioTracks: AudioTrack[];
  selectedAudioTrack: AudioTrack | null;
  onSelectAudioTrack: (track: AudioTrack) => void;
  requestedContainer: TargetContainer;
  onSelectRequestedContainer: (container: TargetContainer) => void;
}

export function AudioStreamTiles({
  audioTracks,
  selectedAudioTrack,
  onSelectAudioTrack,
  requestedContainer,
  onSelectRequestedContainer,
}: AudioStreamTilesProps) {
  // Group tracks by language
  const groupedAudio: Record<string, AudioTrack[]> = {};
  for (const a of audioTracks) {
    const key = a.languageLabel || a.language || 'English';
    if (!groupedAudio[key]) groupedAudio[key] = [];
    groupedAudio[key].push(a);
  }

  const resolutionAdvice = resolveContainer(
    null,
    selectedAudioTrack?.codec || 'opus',
    requestedContainer,
    selectedAudioTrack?.container || 'webm'
  );

  return (
    <div className="space-y-6">
      {/* Educational Banner on Zero-Transcoding Audio */}
      <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-cyan-200 text-xs flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold block text-slate-100">
            Authentic Audiophile Quality (Zero-Transcoding Guarantee)
          </span>
          <p className="text-slate-300 text-[11px] leading-relaxed">
            PulseStream downloads the native bitstream directly from YouTube’s media servers. Re-encoding lossy YouTube streams into MP3 or FLAC causes generation loss, inflates file size with fake bits, and degrades acoustic clarity. We strictly preserve authentic raw Opus and AAC streams.
          </p>
        </div>
      </div>

      {/* Audio Stream Groups */}
      <div className="space-y-5">
        {Object.entries(groupedAudio).map(([language, tracks]) => (
          <div key={language} className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
              <Music className="w-3.5 h-3.5 text-indigo-400" />
              <span>{language} Streams</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tracks.map((track) => {
                const isSelected = selectedAudioTrack?.formatId === track.formatId;
                const isOpus = track.codec.toLowerCase() === 'opus';

                return (
                  <div
                    key={track.formatId}
                    onClick={() => onSelectAudioTrack(track)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/80 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/30'
                        : 'bg-[#0b0f19] border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">
                              {isOpus ? 'Opus High-Fidelity Audio' : 'AAC Universal Audio'}
                            </span>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                              track.role === 'original'
                                ? 'bg-cyan-950 text-cyan-300 border-cyan-700/50'
                                : 'bg-purple-950 text-purple-300 border-purple-700/50'
                            }`}>
                              {track.role}
                            </span>
                          </div>

                          <p className="text-xs text-slate-400 font-mono mt-1">
                            {track.nominalBitrateKbps} kbps • {track.sampleRateHz / 1000} kHz • {track.container.toUpperCase()}
                          </p>
                        </div>

                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                          isSelected
                            ? 'bg-indigo-500 border-indigo-400 text-white'
                            : 'border-slate-700 bg-slate-900'
                        }`}>
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px]">
                      <span className="text-slate-400">
                        {isOpus ? 'Master broadcast fidelity' : 'Universal compatibility (Apple & legacy devices)'}
                      </span>
                      <span className="font-mono text-cyan-400 font-semibold uppercase">
                        .{track.container}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Audio Container Picker */}
      <div className="space-y-2.5 pt-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Audio Container Packaging
          </label>
          <span className="text-[11px] font-mono text-cyan-400">
            Target: .{resolutionAdvice.finalContainer}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'auto', label: 'Automatic', sub: 'Native Stream Container' },
            { id: 'webm', label: '.webm', sub: 'Native Opus Container' },
            { id: 'mp4', label: '.m4a', sub: 'Native AAC Container' },
            { id: 'mkv', label: '.mkv', sub: 'Universal Container' },
          ].map((item) => {
            const isSelected = requestedContainer === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectRequestedContainer(item.id as TargetContainer)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-950/50 border-cyan-500/80 text-white ring-1 ring-cyan-500/20 shadow'
                    : 'bg-[#0b0f19] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold text-slate-100">{item.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{item.sub}</div>
              </button>
            );
          })}
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center gap-2.5 text-xs text-slate-300">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            Will extract into <strong className="text-cyan-300 font-mono">.{resolutionAdvice.finalContainer}</strong> {
              resolutionAdvice.requiresRemux
                ? 'losslessly via stream copy (-c copy).'
                : 'directly without remuxing (zero repackaging overhead).'
            }
          </span>
        </div>

        {resolutionAdvice.compatibilityWarning && (
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Compatibility Notice:</span>
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
