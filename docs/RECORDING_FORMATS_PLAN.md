# Recording formats: MP3 and MP4

## Agreed product behavior

- Microphone and meeting audio recordings finish as playable MP3 files.
- Screen recordings finish as playable MP4 files with H.264 video and AAC audio when an audio stream exists.
- Existing saved recordings are migrated automatically in the background. New recordings are converted immediately after capture stops.
- Mosaic keeps the source file until the output passes codec, duration, and full-decode checks, then atomically publishes the converted file, updates local record references, and removes the source.
- A failure leaves the original in Archives and provides a retry action. Users can pause and resume the queue; a file already being converted finishes before the pause takes effect.
- Raw capture chunks and active checkpoints stay in their browser-native format while the recording is active or recovering.
- Conversion works offline with FFmpeg and FFprobe shipped with the Windows desktop app.

## Architecture

1. `useStudioRecorder` continues writing crash-resilient native chunks to IndexedDB and temporary raw checkpoints to disk.
2. On Stop, Mosaic saves the complete raw recording before starting conversion. The Studio remains in a preparing state; Download and Send to Notetaker are enabled only after the converted file is ready.
3. The local conversion worker stores durable job state in the Electron user's internal data folder. It serializes work, resumes queued jobs after restart, and supports scan, pause, resume, and retry actions.
4. FFprobe selects the audio/video path based on actual streams. FFmpeg writes a sidecar temporary file using MP3 at 128 kbps or MP4 with H.264/AAC. FFprobe checks expected codecs and duration, then FFmpeg decodes the result to verify it is readable.
5. The worker publishes the new file, updates local Notetaker and meeting JSON references, then deletes the source and its rolling checkpoint. In-place replacement of an incompatible MP4 keeps a recoverable backup until publication succeeds.
6. Archives lists conversion state and progress, blocks processing until the final format is ready, and exposes pause/resume/retry controls. Download and Notetaker handoff use the actual final MIME type and extension.

## Bundled codec tools

`desktop/package.json` pins `ffmpeg-static` 5.3.0 and `ffprobe-static` 3.1.0. The included FFmpeg binary is 6.1.1; the pinned ffprobe package currently supplies binary 4.0.2. Electron Builder places their Windows executables outside ASAR in `resources/media-tools/`; the Electron main process passes explicit paths to the loopback app server. Conversion does not search the user's PATH.

The FFmpeg Windows build is GPL-3.0. Its upstream README and license are packaged beside the executable. The ffprobe-static wrapper's MIT license is packaged too. Keep these notices with the corresponding binaries when changing versions, and review the new binary's build configuration and license before upgrading.

## Recovery and data safety

- Checkpoints are never part of automatic migration.
- Completed and interrupted recordings are eligible for migration; active IndexedDB sessions are not discovered as files and stay in native format until finalized.
- A conversion or validation error never deletes the source.
- Job state is written atomically. A validated sidecar is used for replacement; interrupted in-place MP4 replacement restores or completes from its staged file/backup on restart.
- The existing legacy `Documents/Mosaic Meetings`, `Documents/Echo Meetings`, and Mosaic data `recordings` locations remain discoverable for migration, downloads, and deletion.

## Verification checklist

- [x] Audio conversion produced a decodable MP3 with an MP3 stream and nonzero duration in an isolated production-server smoke check.
- [x] Video conversion produced a decodable H.264/AAC MP4; a silent video also converted and remained valid.
- [x] A five-minute synthetic audio source converted to MP3 with a 300.024-second duration; synthetic mixed A/V retained H.264/AAC streams.
- [x] Hook tests cover microphone-only mode, online shared-audio plus microphone mode, screen video with mixed audio, pause/resume state, and converted MP3/MP4 handoff from the save boundary.
- [ ] Verify actual microphone/system capture and pause/resume timing with desktop devices; mocked browser media does not establish hardware synchronization.
- [x] Studio keeps Download and Notetaker handoff unavailable while audio or video conversion is pending (component coverage).
- [x] The Studio enables handoff only after conversion and passes the ready MP3/MP4 file with its final MIME type to Notetaker (component tests); the local download API serves `audio/mpeg` and `video/mp4`.
- [x] Isolated Archives migration covered legacy WAV and mixed WebM A/V, an incompatible MP4, compatible MP3/MP4, failed corrupt input, checkpoints, and repeated scans without duplicate outputs.
- [x] A queued retry and paused state survived a conversion-server restart; resuming retried a corrupt input and preserved its source and the checkpoint.
- [x] A valid input stayed available after the configured encoder process failed, then converted successfully when retried after restart with the bundled FFmpeg.
- [x] Three repeat scans kept the isolated recovery manifest at one job per source.
- [x] Interrupted in-place MP4 replacement recovered both a validated staged output and a backup that needed reconversion.
- [ ] Verify disk-full failure retains the recoverable original.
- [x] Local Notetaker references and notes followed a renamed recording; downloads and deletion resolved current and legacy recording roots.
- [x] In an isolated packaged-app UI run, Archives listed a synthetic saved MP3 and **Process into Minutes Now** invoked the local `/api/process-audio` endpoint; the test intercepted the request before any external provider call.
- [ ] Process a legacy archived recording into Minutes through the full desktop UI.
- [x] The unpacked Windows package includes both binaries and license notices under `resources/media-tools/`, outside ASAR, with no duplicate codec executables under `app.asar.unpacked`.
- [x] A production-server smoke check using the packaged binaries converted audio and video while `PATH` had no FFmpeg entry.
- [x] Conversion API route, recorder-hook capture, and Studio handoff/readiness tests pass (16 focused tests total).
- [x] Launch the packaged Electron shell with an isolated temporary profile and workspace; its loopback conversion API returned HTTP 200 and migrated a synthetic legacy WAV to MP3 using the packaged FFmpeg/FFprobe.
- [x] TypeScript check and app production build complete successfully.

## Current implementation status

Implementation is present locally. TypeScript, the production app build, unpacked Windows package contents, focused route/hook/component tests, packaged-binary conversion, long-duration audio, archive migration, pause/retry/restart recovery, encoder and corrupt-input failure retention, interrupted MP4 replacement, local record-reference updates, an isolated installed Electron shell conversion, and the packaged Archives-to-transcription UI handoff have been checked. Real device synchronization, physical disk-full behavior, and completing a legacy archive through transcription and Minutes generation in the desktop UI remain unverified; the verification checklist stays open for those checks.
