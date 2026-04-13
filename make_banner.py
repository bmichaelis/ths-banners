import sys

import fitz  # PyMuPDF
from PIL import Image

# White space bounds in template.pdf (measured from NFlooring.pdf geometry)
WHITE_SPACE = fitz.Rect(0, 450, 5184, 2150)
PADDING = 50
TEMPLATE_PATH = "template.pdf"


def make_banner(logo_path: str, output_path: str, template_path: str = TEMPLATE_PATH) -> None:
    doc = fitz.open(template_path)
    page = doc[0]

    with Image.open(logo_path) as img:
        img_w, img_h = img.size

    avail_w = WHITE_SPACE.width - 2 * PADDING
    avail_h = WHITE_SPACE.height - 2 * PADDING
    scale = min(avail_w / img_w, avail_h / img_h)
    fit_w = img_w * scale
    fit_h = img_h * scale

    cx = (WHITE_SPACE.x0 + WHITE_SPACE.x1) / 2
    cy = (WHITE_SPACE.y0 + WHITE_SPACE.y1) / 2
    insert_rect = fitz.Rect(
        cx - fit_w / 2,
        cy - fit_h / 2,
        cx + fit_w / 2,
        cy + fit_h / 2,
    )

    page.insert_image(insert_rect, filename=logo_path)
    doc.save(output_path)
    doc.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 make_banner.py <logo_image> <output_pdf>")
        sys.exit(1)
    make_banner(sys.argv[1], sys.argv[2])
    print(f"Saved {sys.argv[2]}")
