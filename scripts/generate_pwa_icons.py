"""Generate placeholder PWA icons for development.
Run once: python scripts/generate_pwa_icons.py
Requires Pillow (already in requirements.txt).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZES = [192, 512]
OUT_DIR = Path(__file__).parent.parent / "frontend" / "public"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BG_COLOR = (17, 24, 39)       # Tailwind gray-900
ACCENT_COLOR = (99, 102, 241)  # Tailwind indigo-500
TEXT_COLOR = (255, 255, 255)

for size in SIZES:
    img = Image.new("RGB", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Accent circle
    margin = size // 8
    draw.ellipse([margin, margin, size - margin, size - margin], fill=ACCENT_COLOR)

    # "PC" text label
    font_size = size // 4
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()

    text = "PC"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    draw.text(
        ((size - text_w) / 2, (size - text_h) / 2),
        text,
        fill=TEXT_COLOR,
        font=font,
    )

    out_path = OUT_DIR / f"icon-{size}.png"
    img.save(out_path, "PNG")
    print(f"Created {out_path}")

print("Done.")
