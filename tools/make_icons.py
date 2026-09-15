#!/usr/bin/env python3
"""Generate the PWA icons.

The mark is our own ID glyph -- a ring around a dot, the icon that means "this die,
being itself". It is the one glyph in the set that reads at 48px, which is the size
an Android launcher actually shows.

Usage:  python tools/make_icons.py
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public"

BG = (47, 111, 79)        # --accent
FG = (251, 250, 248)      # --bg light

# Fraction of the canvas the mark occupies. Maskable icons get cropped to a circle
# of ~80% diameter by some launchers, so the mark stays well inside that.
PLAIN_SCALE = 0.62
MASKABLE_SCALE = 0.44


def draw_icon(size: int, scale: float, rounded: bool) -> Image.Image:
    # Supersample, then downscale: Pillow has no antialiased ellipse stroke.
    ss = 4
    canvas = size * ss
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if rounded:
        draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=int(canvas * 0.22), fill=BG)
    else:
        draw.rectangle([0, 0, canvas - 1, canvas - 1], fill=BG)

    centre = canvas / 2
    outer = canvas * scale / 2
    stroke = max(2, int(canvas * scale * 0.11))

    draw.ellipse(
        [centre - outer, centre - outer, centre + outer, centre + outer],
        outline=FG,
        width=stroke,
    )
    dot = outer * 0.33
    draw.ellipse([centre - dot, centre - dot, centre + dot, centre + dot], fill=FG)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    written = []

    for size in (180, 192, 512):
        path = OUT / f"icon-{size}.png"
        draw_icon(size, PLAIN_SCALE, rounded=True).save(path)
        written.append(path)

    # Maskable: full bleed, mark inside the safe zone, no rounding of our own.
    path = OUT / "icon-maskable-512.png"
    draw_icon(512, MASKABLE_SCALE, rounded=False).save(path)
    written.append(path)

    svg = OUT / "favicon.svg"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<rect width="24" height="24" rx="5" fill="#2f6f4f"/>'
        '<circle cx="12" cy="12" r="6.2" fill="none" stroke="#fbfaf8" stroke-width="1.8"/>'
        '<circle cx="12" cy="12" r="2.1" fill="#fbfaf8"/>'
        "</svg>\n",
        encoding="utf-8",
    )
    written.append(svg)

    for path in written:
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
