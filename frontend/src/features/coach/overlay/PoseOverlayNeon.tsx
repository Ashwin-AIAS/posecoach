// UI-11 Stage 0 recon (docs/enhancements/PREMIUM_POSE_OVERLAY_UI11.md §7):
// - Current overlay IS frozen: PoseOverlay.tsx, lib/poseRenderer.ts, lib/hudRenderer.ts,
//   lib/skeleton.ts, lib/joints.ts, lib/poses.ts, lib/framing.ts, lib/poseInterpolator.ts,
//   and usePoseStream.ts all appear verbatim on the roadmap's frozen list
//   (WORKOUT_NUTRITION_ROADMAP_P23-P28.md guardrail #1) -> ADD ALONGSIDE, select via
//   VITE_OVERLAY_NEON flag, never edit those files. App.tsx (the Coach render site) is
//   NOT frozen, so the flag-swap lands there (roadmap guardrail #2 precedent: P23 already
//   edits App.tsx to host the tab bar).
// - Hook payload (PoseResult from usePoseStream): formScore = result.score; cue =
//   result.cues[0]; angles are present as result.measured_angles but keyed by the verbose
//   scorer names (left_knee_angle, right_knee_angle, left_hip_angle, right_hip_angle,
//   left_elbow_angle, right_elbow_angle, left_shoulder_angle, right_shoulder_angle,
//   hip_trunk_angle) rather than the spec's short keys -> remap on the presentation side.
//   jointQuality is NOT exposed directly, but result.joint_scores (0-100 per joint, same
//   verbose keys) IS exposed and is banded per-joint client-side using the spec's
//   >=85/70-84/<70 thresholds (graceful-degrade rule in §3.2, applied per-joint since the
//   scorer already grades per-joint - richer than the single-band fallback, still no new
//   scoring). state is NOT a field; derived from result.status (mirrors the existing
//   CameraHud.tsx blocked/statusMessage logic: status !== "ok" -> idle, else score-banded
//   good/error). mirrored is not on PoseResult; it flows from camera.facingMode === "user",
//   the same prop already passed to the legacy PoseOverlay.
