/*
 * P11 calibration — browser WS confidence recorder.
 *
 * Paste this whole file into your browser DevTools console on the PoseCoach page
 * BEFORE you start the camera/session. It wraps the WebSocket the app opens to
 * `/ws/inference` and records the per-joint `confidence` array from every frame
 * the server sends back, auto-tagged with the exercise the client is requesting.
 *
 * PRIVACY: it stores ONLY confidence numbers + score + rep count. It never stores
 * keypoint coordinates and never touches the camera frames.
 *
 * When done:   __poseConfSave('gym_session_1')   // downloads a JSON file
 * Frame count: __poseConf.frames.length
 */
(() => {
  const NativeWS = window.WebSocket;
  if (window.__poseConf) {
    console.warn("[poseConf] already armed — call __poseConfSave() or reload to reset.");
    return;
  }
  const store = (window.__poseConf = {
    meta: { started: new Date().toISOString(), userAgent: navigator.userAgent },
    frames: [],
  });
  let lastExercise = null;

  function Wrapped(url, protocols) {
    const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
    if (String(url).includes("/ws/inference")) {
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const m = JSON.parse(data);
          if (m && m.exercise) lastExercise = String(m.exercise);
        } catch (e) {
          /* outgoing frame wasn't JSON we care about */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (Array.isArray(m.confidence) && m.confidence.length === 17) {
            store.frames.push({
              t: Date.now(),
              exercise: lastExercise,
              score: m.score ?? null,
              reps: m.reps ?? null,
              confidence: m.confidence,
            });
          }
        } catch (e) {
          /* non-JSON / non-frame message */
        }
      });
      console.log("[poseConf] recording WS:", url);
    }
    return ws;
  }
  Wrapped.prototype = NativeWS.prototype;
  Wrapped.CONNECTING = NativeWS.CONNECTING;
  Wrapped.OPEN = NativeWS.OPEN;
  Wrapped.CLOSING = NativeWS.CLOSING;
  Wrapped.CLOSED = NativeWS.CLOSED;
  window.WebSocket = Wrapped;

  window.__poseConfSave = (name) => {
    const blob = new Blob([JSON.stringify(store)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (name || "pose_conf_" + Date.now()) + ".json";
    a.click();
    console.log("[poseConf] saved", store.frames.length, "frames to", a.download);
  };

  console.log(
    "[poseConf] armed. Start the camera/session now. When finished run: __poseConfSave('gym_session_1')",
  );
})();
