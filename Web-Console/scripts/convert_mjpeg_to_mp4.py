#!/usr/bin/env python3

from __future__ import annotations

import io
import sys
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image


def iter_jpeg_frames(data: bytes):
    start = 0
    while True:
        soi = data.find(b"\xff\xd8", start)
        if soi == -1:
            return
        eoi = data.find(b"\xff\xd9", soi + 2)
        if eoi == -1:
            return
        yield data[soi : eoi + 2]
        start = eoi + 2


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: convert_mjpeg_to_mp4.py <input.mjpeg> <output.mp4>", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.exists():
        print(f"input file not found: {input_path}", file=sys.stderr)
        return 1

    data = input_path.read_bytes()
    frame_count = 0
    writer = imageio.get_writer(
        output_path,
        fps=25,
        codec="libx264",
        format="FFMPEG",
        ffmpeg_log_level="error",
    )

    try:
        for jpeg_bytes in iter_jpeg_frames(data):
            with Image.open(io.BytesIO(jpeg_bytes)) as image:
                frame = np.array(image.convert("RGB"))
            writer.append_data(frame)
            frame_count += 1
    finally:
        writer.close()

    if frame_count == 0:
        if output_path.exists():
            output_path.unlink()
        print("no jpeg frames found in mjpeg file", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
