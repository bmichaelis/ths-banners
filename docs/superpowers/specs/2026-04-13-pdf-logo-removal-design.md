# PDF Logo Removal & Banner Template System

**Date:** 2026-04-13
**Status:** Approved

## Overview

Remove the embedded "National Flooring Brokers" logo from `NFlooring.pdf` to produce a reusable blank template (`template.pdf`). Provide a script (`make_banner.py`) that accepts a PNG/JPG logo and output path, places the logo centered in the template's white space, and writes a finished PDF.

## Source File

- `NFlooring.pdf` — a banner PDF with three zones:
  - **Header**: "PROUD SPONSORS" on dark navy with a green accent bar
  - **White space**: Central area currently containing the black rectangular logo
  - **Footer**: "TIMPANOGOS TIMBERWOLVES" with wolf logo on dark navy

## Component 1: Template Creation (`create_template.py`)

A one-time script run once to produce the blank template.

**Steps:**
1. Open `NFlooring.pdf` with PyMuPDF (`fitz`)
2. Iterate the page's image list and/or drawing paths to locate the logo element's bounding box
3. Add a redaction annotation over the logo's bounding box
4. Apply the redaction — permanently removes content from the PDF content stream
5. Save result as `template.pdf`

**Output:** `template.pdf` — identical to source except the logo is gone; the white space is clean and empty.

## Component 2: Banner Generation Script (`make_banner.py`)

A reusable CLI script for producing finished banners from a logo image.

**Interface:**
```
python3 make_banner.py <logo_image> <output_pdf>
```

**Steps:**
1. Open `template.pdf` with PyMuPDF
2. Use the white space rectangle hard-coded from the template's known geometry (measured once from `template.pdf` during implementation): the area between the bottom edge of the header bar and the top edge of the footer bar
3. Scale the logo image to fit within the white space with a small padding margin, preserving aspect ratio
4. Center the scaled image horizontally and vertically within the white space
5. Write the result to `<output_pdf>`

**Constraints:**
- Input: PNG or JPG logo image
- Aspect ratio of the input logo is always preserved
- A padding margin is applied so the logo does not touch the header/footer edges

## Dependencies

- Python 3
- PyMuPDF (`pip install pymupdf`) — already installed

## File Layout

```
banners/
  NFlooring.pdf          # original source
  template.pdf           # output of create_template.py (blank template)
  create_template.py     # one-time template generation script
  make_banner.py         # banner generation script
  docs/superpowers/specs/
    2026-04-13-pdf-logo-removal-design.md
```
