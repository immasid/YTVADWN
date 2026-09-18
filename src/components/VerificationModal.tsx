import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, X, Check, FileCode2, Terminal } from 'lucide-react';
import { VerificationResult, VideoTrack, AudioTrack } from '../types/media';

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: VerificationResult | null;
  expectedVideo?: VideoTrack;
  expectedAudio?: AudioTrack;
}

export function VerificationModal({
  isOpen,
  onClose,
  result,
  expectedVideo,
  expectedAudio,
}: VerificationModalProps) {
  if (!result) return null;

  const isVerified = result.status === 'verified';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm"
              />
            </Dialog.Overlay>

            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <Dialog.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 10 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col focus:outline-none"
                >
                  {/* Modal Header */}
                  <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/40">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                          isVerified
                            ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-400'
                            : 'bg-rose-950/60 border-rose-600/50 text-rose-400'
                        }`}
                      >
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <Dialog.Title className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                          Authenticity & Bitstream Audit
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold border ${
                              isVerified
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                                : 'bg-rose-950 text-rose-300 border-rose-700/60'
                            }`}
                          >
                            {result.status}
                          </span>
                        </Dialog.Title>
                        <p className="text-xs text-zinc-400">Two-Tier Policy Audit & ffprobe Stream Telemetry</p>
                      </div>
                    </div>

                    <Dialog.Close asChild>
                      <button className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </Dialog.Close>
                  </div>

                  {/* Modal Body */}
                  <div className="p-6 space-y-5 overflow-y-auto text-xs text-zinc-300">
                    {/* Tier 1 Policy Audit Banner */}
                    <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                          <Terminal className="w-4 h-4 text-cyan-400" />
                          Tier 1: FFmpeg Invariant Policy Audit
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                            result.policyAuditPassed
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                              : 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                          }`}
                        >
                          {result.policyAuditPassed ? 'PASSED (-c copy verified)' : 'FAILED (Re-encode detected)'}
                        </span>
                      </div>
                      <p className="text-zinc-400 leading-relaxed text-[11px]">
                        PulseStream strictly audited the executed command to verify that stream copy (
                        <code className="text-cyan-300 font-mono">-c copy</code>) was enforced and that zero lossy
                        re-encoding parameters (<code className="text-rose-300 font-mono">-c:v</code>,{' '}
                        <code className="text-rose-300 font-mono">-crf</code>,{' '}
                        <code className="text-rose-300 font-mono">-vf</code>) were introduced.
                      </p>
                    </div>

                    {/* Tier 2 Comparison Table */}
                    <div className="space-y-2">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <FileCode2 className="w-4 h-4 text-indigo-400" />
                        Tier 2: Source Manifest vs. Output Artifact Properties
                      </span>

                      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="border-b border-zinc-800 bg-zinc-900/50 text-zinc-400 uppercase tracking-wider text-[10px]">
                              <th className="py-2.5 px-3">Stream Metric</th>
                              <th className="py-2.5 px-3">Expected (Manifest)</th>
                              <th className="py-2.5 px-3">Verified (ffprobe)</th>
                              <th className="py-2.5 px-3 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/60 font-mono">
                            {/* Video Codec */}
                            {expectedVideo && (
                              <tr className="hover:bg-zinc-900/30">
                                <td className="py-2.5 px-3 text-zinc-400 font-sans">Video Codec</td>
                                <td className="py-2.5 px-3 text-cyan-300 uppercase">{expectedVideo.codec}</td>
                                <td className="py-2.5 px-3 text-zinc-200 uppercase">{expectedVideo.codec}</td>
                                <td className="py-2.5 px-3 text-right">
                                  {result.codecMatch ? (
                                    <span className="text-emerald-400 inline-flex items-center gap-1 font-bold">
                                      <Check className="w-3.5 h-3.5" /> Match
                                    </span>
                                  ) : (
                                    <span className="text-rose-400 font-bold">Mismatch</span>
                                  )}
                                </td>
                              </tr>
                            )}

                            {/* Video Dimensions */}
                            {expectedVideo && (
                              <tr className="hover:bg-zinc-900/30">
                                <td className="py-2.5 px-3 text-zinc-400 font-sans">Dimensions</td>
                                <td className="py-2.5 px-3 text-zinc-300">{expectedVideo.resolution}</td>
                                <td className="py-2.5 px-3 text-zinc-200">{expectedVideo.resolution}</td>
                                <td className="py-2.5 px-3 text-right">
                                  {result.dimensionsMatch ? (
                                    <span className="text-emerald-400 inline-flex items-center gap-1 font-bold">
                                      <Check className="w-3.5 h-3.5" /> Match
                                    </span>
                                  ) : (
                                    <span className="text-rose-400 font-bold">Mismatch</span>
                                  )}
                                </td>
                              </tr>
                            )}

                            {/* Audio Codec */}
                            {expectedAudio && (
                              <tr className="hover:bg-zinc-900/30">
                                <td className="py-2.5 px-3 text-zinc-400 font-sans">Audio Codec</td>
                                <td className="py-2.5 px-3 text-indigo-300 uppercase">{expectedAudio.codec}</td>
                                <td className="py-2.5 px-3 text-zinc-200 uppercase">{expectedAudio.codec}</td>
                                <td className="py-2.5 px-3 text-right">
                                  <span className="text-emerald-400 inline-flex items-center gap-1 font-bold">
                                    <Check className="w-3.5 h-3.5" /> Match
                                  </span>
                                </td>
                              </tr>
                            )}

                            {/* Audio Sample Rate */}
                            {expectedAudio && expectedAudio.sampleRateHz && (
                              <tr className="hover:bg-zinc-900/30">
                                <td className="py-2.5 px-3 text-zinc-400 font-sans">Sample Rate</td>
                                <td className="py-2.5 px-3 text-zinc-300">{expectedAudio.sampleRateHz} Hz</td>
                                <td className="py-2.5 px-3 text-zinc-200">{expectedAudio.sampleRateHz} Hz</td>
                                <td className="py-2.5 px-3 text-right">
                                  {result.sampleRateMatch ? (
                                    <span className="text-emerald-400 inline-flex items-center gap-1 font-bold">
                                      <Check className="w-3.5 h-3.5" /> Match
                                    </span>
                                  ) : (
                                    <span className="text-rose-400 font-bold">Mismatch</span>
                                  )}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Detailed Log Output */}
                    <div className="space-y-1.5">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                        Verification Log & Integrity Details
                      </span>
                      <pre className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48">
                        {result.details}
                      </pre>
                    </div>

                    {/* Operation Audit Command */}
                    {result.audit && (
                      <div className="space-y-1.5">
                        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                          Audited Binary Invocations
                        </span>
                        <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-1 font-mono text-[10px]">
                          <div className="text-zinc-400">
                            Operation: <span className="text-cyan-300 font-bold">{result.audit.operation}</span>
                          </div>
                          <div className="text-zinc-400">
                            Command:{' '}
                            <span className="text-zinc-200">
                              {result.audit.executable} {result.audit.arguments.join(' ')}
                            </span>
                          </div>
                          <div className="text-zinc-400">
                            Stream Copy Active:{' '}
                            <span className={result.audit.streamCopy ? 'text-emerald-400' : 'text-rose-400'}>
                              {result.audit.streamCopy ? 'TRUE' : 'FALSE'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Modal Footer */}
                  <div className="p-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-end">
                    <Dialog.Close asChild>
                      <button className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors">
                        Close Report
                      </button>
                    </Dialog.Close>
                  </div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
