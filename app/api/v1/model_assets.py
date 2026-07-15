"""Serve the pose ONNX model to the browser for on-device inference (P32).

The on-device PoC (frontend ``useOnDeviceInference``) must run the EXACT model
the Space's own inference loads, so this route streams the file at
``MODEL_PATH`` rather than a copy that could drift. Additive only — nothing in
the frozen inference path imports or is imported by this module.
"""

import os
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/model", tags=["model"])

# The model changes only on a deliberate redeploy; a day of browser caching
# spares repeat PoC runs the ~12 MB download. FileResponse adds ETag +
# Last-Modified, so a stale cache revalidates cheaply after a model swap.
_CACHE_CONTROL = "public, max-age=86400"


@router.get("/pose.onnx", include_in_schema=False)
async def pose_model() -> FileResponse:
    """The ONNX file production inference runs (404 when running .pt weights)."""
    model_path = os.environ.get("MODEL_PATH", "").strip()
    if not model_path.endswith(".onnx"):
        raise HTTPException(status_code=404, detail="server is not running an ONNX pose model")
    path = Path(model_path)
    if not path.is_file():
        logger.error("model_asset_missing", path=model_path)
        raise HTTPException(status_code=404, detail="model file not found")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={"Cache-Control": _CACHE_CONTROL},
    )
