from __future__ import annotations

import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = ROOT / "kommo-widget" / "images"

IMAGE_SPECS = {
    "logo_min.png": (84, 84),
    "logo_medium.png": (240, 84),
    "logo_main.png": (400, 272),
    "logo.png": (130, 100),
    "logo_small.png": (108, 108),
    "logo_dp.png": (174, 109),
}

BACKGROUND = (22, 27, 34)
ACCENT = (49, 196, 141)


def main() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    for name, (width, height) in IMAGE_SPECS.items():
        output_path = IMAGES_DIR / name
        output_path.write_bytes(build_png(width, height))
        print(f"Generado: {output_path}")


def build_png(width: int, height: int) -> bytes:
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            pixel = choose_pixel(width, height, x, y)
            row.extend(pixel)
        rows.append(bytes(row))

    raw_data = b"".join(rows)
    compressed = zlib.compress(raw_data, 9)

    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
            png_chunk(b"IDAT", compressed),
            png_chunk(b"IEND", b""),
        ]
    )


def choose_pixel(width: int, height: int, x: int, y: int) -> tuple[int, int, int]:
    border = max(2, min(width, height) // 18)
    band_height = max(4, height // 7)
    band_y_start = height // 2 - band_height // 2
    band_y_end = band_y_start + band_height
    band_x_start = width // 6
    band_x_end = width - band_x_start

    if x < border or y < border or x >= width - border or y >= height - border:
        return ACCENT

    if band_y_start <= y <= band_y_end and band_x_start <= x <= band_x_end:
        return ACCENT

    return BACKGROUND


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return b"".join(
        [
            struct.pack(">I", len(data)),
            chunk_type,
            data,
            struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF),
        ]
    )


if __name__ == "__main__":
    main()
