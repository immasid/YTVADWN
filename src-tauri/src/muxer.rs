use std::path::{Path, PathBuf};
use std::process::Command;

/// Lossless FFmpeg stream-copy command.
///
/// COMPILE-TIME INVARIANT:
/// This struct cannot be configured with video or audio encoders, bitrates,
/// frame rates, or filtergraphs. It compiles EXCLUSIVELY to lossless stream copying (-c copy).
/// Zero transcoding is guaranteed by design at the Rust type level.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LosslessMuxerCommand {
    pub video_input: Option<PathBuf>,
    pub audio_input: PathBuf,
    pub output_path: PathBuf,
}

/// Builder for LosslessMuxerCommand.
/// Only permits specifying input and output filesystem paths.
/// Re-encoding or transcode parameters do not exist in this builder.
#[derive(Debug, Default, Clone)]
pub struct LosslessMuxerCommandBuilder {
    video_input: Option<PathBuf>,
    audio_input: Option<PathBuf>,
    output_path: Option<PathBuf>,
}

impl LosslessMuxerCommandBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn video_input(mut self, path: impl Into<PathBuf>) -> Self {
        self.video_input = Some(path.into());
        self
    }

    pub fn optional_video_input(mut self, path: Option<PathBuf>) -> Self {
        self.video_input = path;
        self
    }

    pub fn audio_input(mut self, path: impl Into<PathBuf>) -> Self {
        self.audio_input = Some(path.into());
        self
    }

    pub fn output_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.output_path = Some(path.into());
        self
    }

    /// Builds the validated LosslessMuxerCommand.
    pub fn build(self) -> Result<LosslessMuxerCommand, String> {
        let audio_input = self
            .audio_input
            .ok_or_else(|| "audio_input is required to build LosslessMuxerCommand".to_string())?;

        let output_path = self
            .output_path
            .ok_or_else(|| "output_path is required to build LosslessMuxerCommand".to_string())?;

        Ok(LosslessMuxerCommand {
            video_input: self.video_input,
            audio_input,
            output_path,
        })
    }
}

impl LosslessMuxerCommand {
    pub fn builder() -> LosslessMuxerCommandBuilder {
        LosslessMuxerCommandBuilder::new()
    }

    pub fn new(video_input: Option<PathBuf>, audio_input: PathBuf, output_path: PathBuf) -> Self {
        Self {
            video_input,
            audio_input,
            output_path,
        }
    }

    pub fn video_input(&self) -> Option<&Path> {
        self.video_input.as_deref()
    }

    pub fn audio_input(&self) -> &Path {
        &self.audio_input
    }

    pub fn output_path(&self) -> &Path {
        &self.output_path
    }

    /// Compiles the exact argument vector for FFmpeg.
    ///
    /// HARD-CODED INVARIANT:
    /// The command builder must compile exclusively to:
    /// `ffmpeg -y -i <video_input> -i <audio_input> -c copy -movflags +faststart <output_path>`
    pub fn to_args(&self) -> Vec<String> {
        let mut args = Vec::new();
        args.push("-y".to_string());

        if let Some(ref v) = self.video_input {
            args.push("-i".to_string());
            args.push(v.to_string_lossy().to_string());
        }

        args.push("-i".to_string());
        args.push(self.audio_input.to_string_lossy().to_string());

        // Zero-transcoding invariant: stream copy only
        args.push("-c".to_string());
        args.push("copy".to_string());

        // Faststart for streaming containers
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());

        args.push(self.output_path.to_string_lossy().to_string());

        args
    }

    /// Prepares a Command configured with the provided FFmpeg binary.
    pub fn to_command(&self, ffmpeg_bin: &Path) -> Command {
        let mut cmd = Command::new(ffmpeg_bin);
        cmd.args(self.to_args());
        cmd
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lossless_muxer_command_args() {
        let cmd = LosslessMuxerCommand::builder()
            .video_input("/tmp/video.webm")
            .audio_input("/tmp/audio.opus")
            .output_path("/tmp/output.webm")
            .build()
            .unwrap();

        let args = cmd.to_args();
        assert_eq!(
            args,
            vec![
                "-y",
                "-i",
                "/tmp/video.webm",
                "-i",
                "/tmp/audio.opus",
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                "/tmp/output.webm"
            ]
        );
    }

    #[test]
    fn test_lossless_muxer_audio_only_args() {
        let cmd = LosslessMuxerCommand::builder()
            .audio_input("/tmp/audio.m4a")
            .output_path("/tmp/output.m4a")
            .build()
            .unwrap();

        let args = cmd.to_args();
        assert_eq!(
            args,
            vec![
                "-y",
                "-i",
                "/tmp/audio.m4a",
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                "/tmp/output.m4a"
            ]
        );
    }

    #[test]
    fn test_invariant_prevents_reencoding_parameters() {
        // Compile-time check: Verify that no method exists to add transcode options
        let cmd = LosslessMuxerCommand::new(
            Some(PathBuf::from("in.mp4")),
            PathBuf::from("in.m4a"),
            PathBuf::from("out.mp4"),
        );

        let args = cmd.to_args();
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"copy".to_string()));

        // Ensure no re-encoding flags exist anywhere
        assert!(!args.iter().any(|a| a.starts_with("-c:v")));
        assert!(!args.iter().any(|a| a.starts_with("-c:a")));
        assert!(!args.iter().any(|a| a.starts_with("-b:")));
        assert!(!args.iter().any(|a| a.starts_with("-vf")));
        assert!(!args.iter().any(|a| a.starts_with("-r")));
    }
}
