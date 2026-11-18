"""Web-optimized JPEG/WebP, GPS strip, and XMP/IPTC write.

Original bytes are never required to stay in the destination files.
Operator fetch of photo URLs is opt-in and refuses westernbootworld.com
and eBay hosts. Tests should pass local paths or attached bytes only.
"""

from __future__ import annotations

import io
import re
import struct
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from PIL import Image

MAX_EDGE = 2000
JPEG_QUALITY = 85
WEBP_QUALITY = 82
BLOCKED_HOSTS = (
    "westernbootworld.com",
    "ebay.com",
    "ebay.co.uk",
    "ebay.ca",
    "ebay.com.au",
    "ebaystatic.com",
    "ebayimg.com",
    "ebaydesc.com",
)
FETCH_UA = "asmoWBW/0.2 (local operator fetch; no scheduled runs)"


class FetchError(RuntimeError):
    pass


def host_blocked(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower().rstrip(".")
    return any(host == b or host.endswith("." + b) for b in BLOCKED_HOSTS)


def fetch_url(url: str, timeout: int = 10) -> bytes:
    if host_blocked(url):
        raise FetchError(f"Refusing to fetch blocked host: {urlparse(url).hostname}")
    scheme = (urlparse(url).scheme or "").lower()
    if scheme not in ("http", "https"):
        raise FetchError("Only http(s) photo URLs can be fetched")
    req = Request(url, headers={"User-Agent": FETCH_UA})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — operator-triggered, host-filtered
        if getattr(resp, "status", 200) != 200:
            raise FetchError(f"HTTP {resp.status}")
        return resp.read()


def _gps_in_exif(exif_bytes: bytes) -> bool:
    if not exif_bytes or b"GPS" in exif_bytes:
        # Cheap scan; also try piexif when present for a structured check.
        if b"GPS" in (exif_bytes or b""):
            return True
    try:
        import piexif

        data = piexif.load(exif_bytes)
        gps = data.get("GPS") or {}
        return bool(gps)
    except Exception:
        return bool(exif_bytes and b"GPS" in exif_bytes)


def source_has_gps(source: bytes | None, declared: bool | None = None) -> bool:
    if declared is True:
        return True
    if not source:
        return bool(declared)
    try:
        with Image.open(io.BytesIO(source)) as im:
            exif = im.info.get("exif") or b""
            if _gps_in_exif(exif):
                return True
    except Exception:
        pass
    return bool(source and b"GPS" in source)


def _iptc_iim(title: str, description: str, keywords: list[str], credit: str, copyright: str) -> bytes:
    def rec(dataset: int, text: str) -> bytes:
        raw = text.encode("utf-8")[:2048]
        return b"\x1c\x02" + bytes([dataset]) + struct.pack(">H", len(raw)) + raw

    chunks = []
    if title:
        chunks.append(rec(5, title))  # ObjectName
    for kw in keywords:
        if kw:
            chunks.append(rec(25, kw))  # Keywords
    if credit:
        chunks.append(rec(110, credit))  # Credit
        chunks.append(rec(80, credit))  # By-line
    if copyright:
        chunks.append(rec(116, copyright))
    if description:
        chunks.append(rec(120, description))  # Caption
    return b"".join(chunks)


def _app13_iptc(iim: bytes) -> bytes:
    # Photoshop IRB: 8BIM + type 0x0404 (IPTC) + Pascal name (empty) + data
    name = b"\x00"
    if len(name) % 2 == 0:
        name += b"\x00"  # already odd with the length byte 0? empty name is 0 then pad
    # Empty resource name: one 0 length byte, then pad to even.
    name = b"\x00\x00"
    irb = b"8BIM" + b"\x04\x04" + name + struct.pack(">I", len(iim)) + iim
    if len(iim) % 2 == 1:
        irb += b"\x00"
    payload = b"Photoshop 3.0\x00" + irb
    return b"\xff\xed" + struct.pack(">H", len(payload) + 2) + payload


def _xml_esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_xmp(
    *,
    title: str,
    description: str,
    keywords: list[str],
    credit: str,
    copyright: str,
) -> bytes:
    kw = "".join(f"<rdf:li>{_xml_esc(k)}</rdf:li>" for k in keywords if k)
    xml = (
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">'
        f"<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">{_xml_esc(title)}</rdf:li></rdf:Alt></dc:title>"
        f"<dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">{_xml_esc(description)}</rdf:li></rdf:Alt></dc:description>"
        f"<dc:subject><rdf:Bag>{kw}</rdf:Bag></dc:subject>"
        f"<dc:rights><rdf:Alt><rdf:li xml:lang=\"x-default\">{_xml_esc(copyright)}</rdf:li></rdf:Alt></dc:rights>"
        f"<photoshop:Credit>{_xml_esc(credit)}</photoshop:Credit>"
        "</rdf:Description></rdf:RDF></x:xmpmeta>"
        '<?xpacket end="w"?>'
    )
    return xml.encode("utf-8")


def _insert_jpeg_app(jpeg: bytes, segments: list[bytes]) -> bytes:
    """Insert APP segments after SOI and a leading JFIF APP0, if present."""
    if len(jpeg) < 4 or jpeg[:2] != b"\xff\xd8":
        return jpeg
    at = 2
    if jpeg[2:4] == b"\xff\xe0":
        seglen = int.from_bytes(jpeg[4:6], "big")
        at = 4 + seglen
    return jpeg[:at] + b"".join(segments) + jpeg[at:]


def embed_metadata_jpeg(jpeg: bytes, meta: dict[str, Any]) -> bytes:
    xmp = build_xmp(
        title=meta.get("title") or "",
        description=meta.get("description") or "",
        keywords=list(meta.get("keywords") or []),
        credit=meta.get("credit") or "",
        copyright=meta.get("copyright") or "westernbootworld.com",
    )
    # XMP in APP1: "http://ns.adobe.com/xap/1.0/\0" + packet
    xmp_payload = b"http://ns.adobe.com/xap/1.0/\x00" + xmp
    xmp_seg = b"\xff\xe1" + struct.pack(">H", len(xmp_payload) + 2) + xmp_payload
    iim = _iptc_iim(
        meta.get("title") or "",
        meta.get("description") or "",
        list(meta.get("keywords") or []),
        meta.get("credit") or "",
        meta.get("copyright") or "westernbootworld.com",
    )
    iptc_seg = _app13_iptc(iim) if iim else b""
    return _insert_jpeg_app(jpeg, [seg for seg in (xmp_seg, iptc_seg) if seg])


def optimize_image(
    source: bytes,
    *,
    meta: dict[str, Any],
    max_edge: int | None = None,
) -> dict[str, Any]:
    """Full-size copy for SEO tags. No resize, no lossy re-encode, no WebP conversion.

    JPEG gets XMP/IPTC inserted around the original scan. Other formats are copied
    unchanged. max_edge is ignored; it used to downscale the long edge to 2000px.
    The caller's source file is not modified.
    """
    del max_edge
    had_gps = source_has_gps(source)
    with Image.open(io.BytesIO(source)) as im:
        w, h = im.size
    jpeg = embed_metadata_jpeg(source, meta) if source[:2] == b"\xff\xd8" else source
    gps_out = source_has_gps(jpeg)
    return {
        "jpeg": jpeg,
        "webp": None,
        "width": w,
        "height": h,
        "gps_stripped": bool(had_gps and not gps_out),
        "gps_present_in_output": bool(gps_out),
    }


def media_source(entry: dict[str, Any] | None, *, fetch: bool = False) -> tuple[bytes | None, str]:
    """Load bytes from attached path/base64, or fetch the URL if allowed."""
    if not entry:
        return None, "no-media"
    if entry.get("bytes") is not None and isinstance(entry["bytes"], (bytes, bytearray)):
        return bytes(entry["bytes"]), "attached-bytes"
    b64 = entry.get("base64")
    if b64:
        import base64

        return base64.b64decode(b64), "attached-base64"
    path = entry.get("path")
    if path:
        p = Path(path)
        if p.is_file():
            return p.read_bytes(), "local-path"
        return None, f"missing-path:{path}"
    url = entry.get("stored_url") or entry.get("url")
    if url and fetch:
        return fetch_url(str(url)), "fetched"
    if url:
        return None, "url-not-fetched"
    return None, "no-source"
