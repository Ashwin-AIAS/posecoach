"""Direct ONNX Runtime pose inference, bypassing Ultralytics' predict wrapper.

Ultralytics 8.4.x has an ``InferenceSession`` bug that makes
``results[0].keypoints`` return ``None`` on ONNX models after the first
``predict()`` — which is why the app previously fell back to the slow PyTorch
weights. This module drives ONNX Runtime directly and decodes the raw output
tensor itself, restoring keypoints on ONNX *and* unlocking the CPU speedup
(PyTorch@320 ≈ 283 ms median vs ONNX Runtime, far less).

The output contract is identical to the PyTorch path so nothing downstream
changes: ``kp_xyn`` shape ``(17, 2)`` normalized [0, 1] and ``kp_conf`` shape
``(17,)``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import numpy.typing as npt
import onnxruntime as ort
import structlog

logger = structlog.get_logger(__name__)

# COCO 17-keypoint pose.
_KEYPOINT_COUNT = 17
# Detection confidence below which a frame is treated as "no person" — matches
# the ``conf=0.10`` gate the PyTorch path uses in ``runner._predict`` (the
# fine-tuned model trained on studio mocap scores webcam input low).
_DETECTION_CONF_THRESHOLD = 0.10
# Column layout of the YOLO26-pose one-to-one (NMS-free) head output, shape
# ``(1, 300, 57)``: [x1, y1, x2, y2, score, class] then 17 * (x, y, conf).
# Verified empirically against the .pt model (parity MAD ~0 in BGR channel order).
_PREFIX_COLS = 6
_SCORE_COL = 4


class OnnxPoseSession:
    """ONNX Runtime YOLO26-pose session with its own keypoint decode.

    Loads a static-shape, NMS-free (one-to-one head) YOLO26-pose ONNX model and
    decodes the raw output tensor into normalized keypoints for the
    highest-confidence person, matching the contract that
    :mod:`app.inference.runner` and the form scorer expect.
    """

    def __init__(self, model_path: str, imgsz: int = 320, intra_op_threads: int = 2) -> None:
        """Create the inference session.

        Args:
            model_path: Path to the ``.onnx`` model (static shape, imgsz square).
            imgsz: Fallback square input size if the graph shape is dynamic.
            intra_op_threads: ONNX Runtime intra-op thread count. Tune to the
                deployment's vCPU count (2 on the free tier).
        """
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = intra_op_threads
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._session = ort.InferenceSession(
            model_path, sess_options=opts, providers=["CPUExecutionProvider"]
        )
        self._input_name = self._session.get_inputs()[0].name

        # Prefer the static spatial size baked into the graph; fall back to the
        # supplied imgsz if a dimension is symbolic (dynamic export).
        in_shape = self._session.get_inputs()[0].shape
        self.imgsz = int(in_shape[2]) if isinstance(in_shape[2], int) else int(imgsz)

        logger.info(
            "onnx_session_loaded",
            path=model_path,
            imgsz=self.imgsz,
            intra_op_threads=intra_op_threads,
            outputs=[o.shape for o in self._session.get_outputs()],
        )

    def predict(
        self, frame_rgb_uint8: npt.NDArray[np.uint8]
    ) -> tuple[npt.NDArray[np.float32], npt.NDArray[np.float32]] | None:
        """Run one frame.

        Args:
            frame_rgb_uint8: ``(imgsz, imgsz, 3)`` uint8 **RGB**, already resized.

        Returns:
            ``(kp_xyn, kp_conf)`` where ``kp_xyn`` is ``(17, 2)`` normalized
            [0, 1] and ``kp_conf`` is ``(17,)``, for the highest-confidence
            person; or ``None`` if no person clears the detection threshold.
        """
        # RGB -> BGR: the model is consumed via Ultralytics' preprocessing in the
        # .pt path, which treats numpy input as BGR. Reversing channels here
        # reproduces that exactly (verified: parity MAD ~0 vs .pt in BGR order).
        bgr = np.ascontiguousarray(frame_rgb_uint8[..., ::-1])
        tensor = np.ascontiguousarray(
            (bgr.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        )

        outputs: list[npt.NDArray[Any]] = self._session.run(None, {self._input_name: tensor})
        det = outputs[0][0]  # (300, 57)
        if det.shape[0] == 0:
            return None

        best = int(det[:, _SCORE_COL].argmax())
        score = float(det[best, _SCORE_COL])
        if score < _DETECTION_CONF_THRESHOLD:
            return None

        kpts = det[best, _PREFIX_COLS:].reshape(_KEYPOINT_COUNT, 3)
        kp_xyn = (kpts[:, :2] / float(self.imgsz)).astype(np.float32)
        kp_conf = kpts[:, 2].astype(np.float32)

        logger.debug("onnx_decoded", top_conf=round(score, 3))
        return kp_xyn, kp_conf
