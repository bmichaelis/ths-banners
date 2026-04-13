import io
import os
import pathlib
import tempfile

import fitz
from PIL import Image

PROJECT_ROOT = pathlib.Path(__file__).parent.parent


def test_create_template_whitens_logo_area():
    """After running create_template, the logo area must be white."""
    from create_template import create_template

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        out_path = f.name
    try:
        create_template(str(PROJECT_ROOT / "NFlooring.pdf"), out_path)

        with fitz.open(out_path) as doc:
            page = doc[0]
            img_list = page.get_images(full=True)
            assert len(img_list) > 0, "Output PDF must contain an embedded image"

            base_image = doc.extract_image(img_list[0][0])
            pil_img = Image.open(io.BytesIO(base_image["image"])).convert("RGB")

            # Center of where the logo was: x=2590, y=1307
            logo_cx = (1280 + 3900) // 2  # 2590
            logo_cy = (800 + 1815) // 2   # 1307
            r, g, b = pil_img.getpixel((logo_cx, logo_cy))
            assert r > 200 and g > 200 and b > 200, (
                f"Expected white at logo center ({logo_cx},{logo_cy}), got ({r},{g},{b})"
            )
    finally:
        os.unlink(out_path)
