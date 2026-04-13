import os
import pathlib
import tempfile

import fitz
from PIL import Image

PROJECT_ROOT = pathlib.Path(__file__).parent.parent


def test_make_banner_places_logo_in_white_space():
    """After make_banner, the white space center must contain the inserted logo color."""
    from make_banner import make_banner, WHITE_SPACE

    # Create a solid red test logo (200×100 px)
    test_logo_path = "/tmp/test_logo_red.png"
    Image.new("RGB", (200, 100), color=(255, 0, 0)).save(test_logo_path)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        out_path = f.name
    try:
        make_banner(test_logo_path, out_path, template_path=str(PROJECT_ROOT / "template.pdf"))

        # Render the output page at 25% scale to keep the test fast
        with fitz.open(out_path) as doc:
            page = doc[0]
            scale = 0.25
            mat = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            # White space center at 25% scale
            ws_cx = int((WHITE_SPACE.x0 + WHITE_SPACE.x1) / 2 * scale)
            ws_cy = int((WHITE_SPACE.y0 + WHITE_SPACE.y1) / 2 * scale)
            r, g, b = img.getpixel((ws_cx, ws_cy))
            assert r > 200 and g < 50 and b < 50, (
                f"Expected red pixel at white space center, got ({r},{g},{b})"
            )
    finally:
        os.unlink(out_path)
        if os.path.exists(test_logo_path):
            os.unlink(test_logo_path)
