import pathlib

import fitz  # PyMuPDF

# Bounding box of the existing logo (including drop shadow), measured from NFlooring.pdf
LOGO_RECT = fitz.Rect(1280, 800, 3900, 1815)


def create_template(source_path: str, output_path: str) -> None:
    if not pathlib.Path(source_path).exists():
        raise FileNotFoundError(f"Source PDF not found: {source_path}")
    doc = fitz.open(source_path)
    page = doc[0]
    page.add_redact_annot(LOGO_RECT, fill=(1, 1, 1))  # white fill
    page.apply_redactions()
    doc.save(output_path)
    doc.close()


if __name__ == "__main__":
    create_template("NFlooring.pdf", "template.pdf")
    print("Saved template.pdf")
