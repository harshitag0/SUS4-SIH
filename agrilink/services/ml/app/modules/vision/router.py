from typing import List, Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from . import gallery, service

router = APIRouter(prefix="/vision", tags=["vision"])
MAX_BYTES = 8 * 1024 * 1024


async def _read(files: List[UploadFile]) -> list[bytes]:
    if not 1 <= len(files) <= 5:
        raise HTTPException(422, "send 1 to 5 photos")
    out = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "each photo must be 8 MB or smaller")
        out.append(data)
    return out


@router.post("/analyze")
async def analyze(files: List[UploadFile] = File(...)):
    """Grade one quality check from 1-5 photos (provisional; a farmer doctor confirms)."""
    return service.analyze(await _read(files))


@router.post("/photo-quality")
async def photo_quality(files: List[UploadFile] = File(...)):
    """Photo-quality gate for any stage photo (brightness, sharpness, vegetation share). Makes no claim about crop health."""
    from .analyze import photo_quality as pq
    out = []
    for i, data in enumerate(await _read(files)):
        try:
            out.append({"index": i, **pq(data)})
        except ValueError:
            out.append({"index": i, "usable": False, "issues": ["not_an_image"]})
    return {"model": "agrilink-photo-quality-v1", "photos": out}


@router.post("/gallery")
async def add_to_gallery(files: List[UploadFile] = File(...), grade: Literal["A", "B", "REJECT"] = Form(...),
                         source: str = Form("farmer_doctor"), ref: Optional[str] = Form(None)):
    """Doctor-confirmed photos become reference examples; the learned grader retrains when there are enough."""
    return service.learn(await _read(files), grade, source, ref)


@router.get("/status")
def status():
    return {"model": service.MODEL, **gallery.status()}
