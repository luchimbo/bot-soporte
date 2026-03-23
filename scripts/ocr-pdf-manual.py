import json
import sys

import pymupdf
from rapidocr_onnxruntime import RapidOCR


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: python scripts/ocr-pdf-manual.py <pdf-path>"}))
        return 1

    pdf_path = sys.argv[1]
    doc = pymupdf.open(pdf_path)
    ocr = RapidOCR()
    pages = []

    for index, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        image_bytes = pix.tobytes("png")
        result, _ = ocr(image_bytes)
        pages.append({"number": index, "text": to_text(result)})

    print(json.dumps({"pages": pages}, ensure_ascii=True))
    return 0


def to_text(result) -> str:
    if not result:
        return ""

    items = []
    for entry in result:
        if not entry or len(entry) < 2:
            continue
        box = entry[0]
        text = str(entry[1] or "").strip()
        if not text:
            continue
        top = min(point[1] for point in box)
        left = min(point[0] for point in box)
        items.append((round(top / 12), left, text))

    items.sort(key=lambda item: (item[0], item[1]))
    return "\n".join(text for _, _, text in items)


if __name__ == "__main__":
    raise SystemExit(main())
