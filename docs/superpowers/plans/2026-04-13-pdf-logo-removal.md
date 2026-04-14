# PDF Logo Removal & Banner Template System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "National Flooring Brokers" logo from `NFlooring.pdf` to create a reusable `template.pdf`, and provide `make_banner.py` to stamp new logos into that template.

**Architecture:** The entire PDF page is a single raster PNG image (5184×2592 px) embedded at 1:1 scale. `create_template.py` adds a PyMuPDF redaction annotation over the logo's bounding box and applies it (which modifies the embedded image pixels), then saves `template.pdf`. `make_banner.py` opens `template.pdf`, computes a centered rect for the incoming logo image within the measured white space, inserts the image, and saves the output PDF.

**Tech Stack:** Python 3, PyMuPDF (`fitz`), Pillow (`PIL`)

---

## Measured Geometry (from NFlooring.pdf)

These constants are used throughout both scripts:

| Name | Value | Description |
|------|-------|-------------|
| `LOGO_RECT` | Rect(1280, 800, 3900, 1815) | Bounding box of existing logo (includes drop shadow) |
| `WHITE_SPACE` | Rect(0, 450, 5184, 2150) | Usable white area between header and footer |
| `PADDING` | 50 | Inner padding within white space for logo insertion |

---

## File Layout

```
banners/
  NFlooring.pdf            # source (read-only, never modified)
  template.pdf             # output of create_template.py
  create_template.py       # one-time script: removes logo, writes template.pdf
  make_banner.py           # CLI: inserts a logo image into template.pdf
  tests/
    __init__.py            # empty
    conftest.py            # adds project root to sys.path
    test_create_template.py
    test_make_banner.py
```

---

## Task 1: Set up test infrastructure

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Create test support files**

```bash
mkdir -p tests && touch tests/__init__.py
```

```python
# tests/conftest.py
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
```

- [ ] **Step 2: Verify pytest runs without errors**

```bash
cd /Users/brett/brett-dev/banners
python3 -m pytest tests/ -v
```

Expected: `no tests ran` (0 collected), no import errors.

---

## Task 2: Write failing test for `create_template.py`

**Files:**
- Create: `tests/test_create_template.py`

- [ ] **Step 3: Write the failing test**

```python
# tests/test_create_template.py
import io
import os
import tempfile

import fitz
import pytest
from PIL import Image


def test_create_template_whitens_logo_area():
    """After running create_template, the logo area must be white."""
    from create_template import create_template

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        out_path = f.name
    try:
        create_template("NFlooring.pdf", out_path)

        doc = fitz.open(out_path)
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
        doc.close()
    finally:
        os.unlink(out_path)
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
python3 -m pytest tests/test_create_template.py -v
```

Expected: `ImportError: cannot import name 'create_template'`

---

## Task 3: Implement `create_template.py` and make the test pass

**Files:**
- Create: `create_template.py`

- [ ] **Step 5: Write `create_template.py`**

```python
# create_template.py
import fitz  # PyMuPDF

# Bounding box of the existing logo (including drop shadow), measured from NFlooring.pdf
LOGO_RECT = fitz.Rect(1280, 800, 3900, 1815)


def create_template(source_path: str, output_path: str) -> None:
    doc = fitz.open(source_path)
    page = doc[0]
    page.add_redact_annot(LOGO_RECT, fill=(1, 1, 1))  # white fill
    page.apply_redactions()
    doc.save(output_path)
    doc.close()


if __name__ == "__main__":
    create_template("NFlooring.pdf", "template.pdf")
    print("Saved template.pdf")
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
python3 -m pytest tests/test_create_template.py -v
```

Expected: `PASSED tests/test_create_template.py::test_create_template_whitens_logo_area`

- [ ] **Step 7: Generate `template.pdf`**

```bash
python3 create_template.py
```

Expected output: `Saved template.pdf`

- [ ] **Step 8: Visually inspect `template.pdf`**

Open `template.pdf` in Preview and confirm:
- The "National Flooring Brokers" logo is gone
- The white space is clean and empty
- Header ("PROUD SPONSORS") and footer ("TIMPANOGOS TIMBERWOLVES") are intact

- [ ] **Step 9: Commit**

```bash
git add create_template.py tests/__init__.py tests/conftest.py tests/test_create_template.py template.pdf
git commit -m "feat: add create_template script and generate blank template.pdf"
```

---

## Task 4: Write failing test for `make_banner.py`

**Files:**
- Create: `tests/test_make_banner.py`

- [ ] **Step 10: Write the failing test**

```python
# tests/test_make_banner.py
import os
import tempfile

import fitz
import pytest
from PIL import Image


def test_make_banner_places_logo_in_white_space():
    """After make_banner, the white space center must contain the inserted logo color."""
    from make_banner import make_banner, WHITE_SPACE

    # Create a solid red test logo (200×100 px)
    test_logo_path = "/tmp/test_logo_red.png"
    Image.new("RGB", (200, 100), color=(255, 0, 0)).save(test_logo_path)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        out_path = f.name
    try:
        make_banner(test_logo_path, out_path)

        # Render the output page at 25% scale to keep the test fast
        doc = fitz.open(out_path)
        page = doc[0]
        scale = 0.25
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # White space center at 25% scale
        ws_cx = int((WHITE_SPACE.x0 + WHITE_SPACE.x1) / 2 * scale)
        ws_cy = int((WHITE_SPACE.y0 + WHITE_SPACE.y1) / 2 * scale)
        r, g, b = img.getpixel((ws_cx, ws_cy))
        assert r > 200 and b < 50, (
            f"Expected red pixel at white space center, got ({r},{g},{b})"
        )
        doc.close()
    finally:
        os.unlink(out_path)
        if os.path.exists(test_logo_path):
            os.unlink(test_logo_path)
```

- [ ] **Step 11: Run test to confirm it fails**

```bash
python3 -m pytest tests/test_make_banner.py -v
```

Expected: `ImportError: cannot import name 'make_banner'`

---

## Task 5: Implement `make_banner.py` and make the test pass

**Files:**
- Create: `make_banner.py`

- [ ] **Step 12: Write `make_banner.py`**

```python
# make_banner.py
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
```

- [ ] **Step 13: Run the test and confirm it passes**

```bash
python3 -m pytest tests/test_make_banner.py -v
```

Expected: `PASSED tests/test_make_banner.py::test_make_banner_places_logo_in_white_space`

- [ ] **Step 14: Run the full test suite**

```bash
python3 -m pytest tests/ -v
```

Expected: both tests `PASSED`

- [ ] **Step 15: Smoke test with a real logo**

```bash
python3 make_banner.py /path/to/any_logo.png smoke_test.pdf
```

Open `smoke_test.pdf` and confirm:
- Logo is centered in the white space
- Logo does not overlap the header or footer
- Aspect ratio is preserved

- [ ] **Step 16: Commit**

```bash
git add make_banner.py tests/test_make_banner.py
git commit -m "feat: add make_banner script for inserting logos into template"
```

---

## Done

- `template.pdf` — blank banner template with clean white space
- `python3 make_banner.py logo.png output.pdf` — produces a finished banner PDF
- All logic covered by pytest tests
