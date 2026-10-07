"""Optional independent offline QA: PyMuPDF 1.26.7 in an isolated QA venv, never application runtime.
Usage: python scripts/inspect-pdf-fixtures.py /tmp/reading-pdf-qa/outputs
The tool's AGPL/commercial licensing is separate from the MIT production pdf-lib dependency.
"""
import hashlib
import json
import pathlib
import sys
import fitz

root = pathlib.Path(sys.argv[1])
evidence = []
for path in sorted(root.glob("*.pdf")):
    raw = path.read_bytes()
    manifest = json.loads(path.with_suffix(".json").read_text())
    doc = fitz.open(stream=raw, filetype="pdf")
    assert not doc.is_repaired and len(doc) == manifest["metadata"]["pageCount"]
    assert hashlib.sha256(raw).hexdigest() == manifest["metadata"]["sha256"]
    traces = []
    rasters = []
    for index, page in enumerate(doc):
        assert abs(page.rect.width - 595.276) < .001 and abs(page.rect.height - 841.890) < .001
        for span in page.get_texttrace():
            # ToUnicode ligature expansion may emit extra Unicode characters with gid=-1.
            for _, gid, origin, _ in span["chars"]:
                if gid >= 0:
                    traces.append(dict(page=index, font=span["font"], size=span["size"], gid=gid, x=origin[0], y=origin[1]))
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        second = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        assert pix.samples == second.samples
        for slot in manifest["layout"]["pages"][index]["elements"]:
            if slot["kind"] == "CARD":
                box = slot["image"]
                pixel = pix.pixel(round((box["x"]+box["width"]*.5)/1000), round((box["y"]+box["height"]*.2)/1000))
                reversed_card = manifest["layout"]["media"]["cards"][slot["position"]]["orientation"] == "REVERSED"
                assert (pixel[2] > pixel[0]) if reversed_card else (pixel[0] > pixel[2]), (path.name, slot, pixel)
        pix.save(str(path.with_name(f"{path.stem}-{index+1}.png")))
        rasters.append(hashlib.sha256(pix.samples).hexdigest())
    assert len(traces) == len(manifest["glyphs"]), (path.name, len(traces), len(manifest["glyphs"]))
    for actual, expected in zip(traces, manifest["glyphs"]):
        assert all(actual[k] == expected[k] for k in ("page", "font", "gid")), (path.name, actual, expected)
        assert all(abs(actual[k] - expected[k]) < .002 for k in ("size", "x", "y")), (path.name, actual, expected)
    text = "".join(page.get_text() for page in doc)
    assert "ğ Ğ ş Ş ı İ ç Ç ö Ö ü Ü" in text
    evidence.append(dict(fixture=path.name, pages=len(doc), glyphs=len(traces), sha256=manifest["metadata"]["sha256"], pixelHashes=rasters))
    print(path.name, len(doc), "pages", len(traces), "exact glyph positions; raster repeat PASS")
(root / "independent-qa.json").write_text(json.dumps(dict(parser=fitz.VersionBind, evidence=evidence), indent=2))
