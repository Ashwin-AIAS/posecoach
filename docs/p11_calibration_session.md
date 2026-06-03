# P11 Calibration Session — measure the real keypoint-confidence distribution

> Purpose: set the angle-confidence gate from **measured webcam data**, not a guess.
> Output: one number (e.g. "0.31, 25th percentile of per-triplet minima in real gym
> conditions") that P12 and P13 reference. **No `app/` changes. Measurement only.**

## Why this exists

P11 found the live "reps stuck at 0 / scores silently broken" bug is a **confidence-gate
mismatch**: YOLO predicts at `conf=0.10` but `compute_angles` discards any joint below
`0.5`. We need the *actual* distribution of webcam joint confidence to choose the right
gate. The per-joint confidence isn't in the server logs, **but it is in every WebSocket
message the server sends the client** (`confidence: [17 floats]`), so we tap it in the
browser — production-faithful, no backend access, no code changes.

**Privacy:** the recorder captures only confidence numbers + score + rep count. **No camera
frames, no keypoint coordinates** are ever stored.

---

## What you need

- A **laptop browser** (Chrome/Firefox — DevTools console). *Not* a phone: you need the
  console, and the camera framing should match how you actually use the app in the gym.
- The app running and reachable (your HF Space backend or local `docker compose up`).
- The camera in your **real gym position** (distance, angle, lighting you normally use).
  Joints must be visible: full body for squats/lunges/deadlifts; upper body for curls/press.

---

## Run the session (~15–20 min)

1. **Open the app page** and log in / get to the live camera screen — but **don't start the
   camera yet**.
2. **Arm the recorder.** Open DevTools → Console, paste the entire contents of
   [`scripts/ws_conf_recorder.js`](../scripts/ws_conf_recorder.js), press Enter. You should
   see `[poseConf] armed.` (It wraps the WS *before* the app opens it — so arm first.)
3. **Start the camera/session.** The console should log `[poseConf] recording WS …`. If it
   doesn't, the socket opened before you armed — stop the session, then start it again.
4. **Do the routine.** Switch the exercise in the UI between sets (the recorder auto-tags
   each frame with the exercise the client requests). Suggested coverage — **~8–12 reps
   each**, real tempo, real positioning:

   | Exercise | Reps | Note |
   |---|---|---|
   | squat | 10 | full body in frame |
   | deadlift | 10 | side-on if that's how you film |
   | lunge | 8/leg | watch the rear leg occlusion |
   | bench / pushup | 10 | the framing you'd really use |
   | ohp | 10 | arms fully overhead at top |
   | curl | 10 | upper body |
   | plank | 30 s hold | isometric — still want the conf trace |

   Aim for **a few hundred frames per exercise** (15 FPS → ~30 s of work is plenty). If you
   want to capture a second framing/lighting, do another pass.
5. **Save.** In the console run:
   ```js
   __poseConfSave('gym_session_1')
   ```
   It downloads `gym_session_1.json`. (Check `__poseConf.frames.length` first — want it in
   the thousands.)

---

## Analyse

From the repo root:

```bash
python scripts/analyze_conf_distribution.py gym_session_1.json --percentile 25 \
    --out data/eval/conf_distribution_summary.json
```

(Pass multiple files to pool several sessions: `... gym_session_1.json gym_session_2.json`.
Add `--plot` for a matplotlib histogram if it's installed.)

You'll get:
- per-joint confidence stats (mean / p5 / p25 / p50 / p75 / min) for all 17 joints,
- a text histogram of the **per-frame minimum confidence across scored triplets** (the
  quantity the gate actually depends on — `compute_angles` needs all 3 joints of a triplet
  to clear it),
- a **recommended threshold** = the chosen percentile of those minima,
- a pass-rate table comparing **0.50 (current)**, **0.25 (the guess)**, and the
  recommendation, plus a per-exercise recommended threshold.

---

## How to read the result

- If **"frames fully valid" at 0.50 is low** (say <50%) but high at the recommendation,
  the conf-gate mismatch is **confirmed** as the root cause — exactly the P11 hypothesis,
  now with numbers.
- The **recommended threshold** (rounded) becomes the new `compute_angles` gate in P12/P13.
  Quote its provenance in the commit ("0.31 — 25th pct of per-triplet minima, n=… frames,
  `data/eval/conf_distribution_summary.json`") instead of a magic `0.25`.
- **Sanity checks:** a recommendation *above* 0.5 means something's wrong (bad framing /
  too few frames) — reposition and recapture. Very few person-detected frames → move the
  camera back so the whole body is in shot.
- **Percentile choice:** 25th is a reasonable default (keeps ~75% of real triplet
  observations). Lower it (10th) if you'd rather tolerate more low-confidence joints;
  raise it (40th) to be stricter. Decide the percentile *before* looking, then stick to it.

---

## After this

Hand the recommended number back. Then P12 (rep counter) and P13 (silent-default scoring)
get written **in their own branches**, referencing the measured threshold — as the roadmap
intended. Nothing in `app/` changes until then.
