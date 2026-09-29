#!/usr/bin/env python3
"""Regenerate the text-extraction fixture using an openly licensed embedded font.

Requires Python reportlab and the project's locked npm dependencies.
The legacy fixture filename is retained so existing tests keep their input path.
"""
from pathlib import Path
from shutil import copyfile

from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "node_modules" / "pdfjs-dist" / "standard_fonts"
FIXTURES = ROOT / "tests" / "fixtures"
FONT_NAME = "LiberationSansFixture"

pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_DIR / "LiberationSans-Regular.ttf")))
FIXTURES.mkdir(parents=True, exist_ok=True)
output = FIXTURES / "chromium-text.pdf"
document = canvas.Canvas(
    str(output), pagesize=letter, pageCompression=1, invariant=1,
    initialFontName=FONT_NAME, initialFontSize=12,
)
document.setTitle("Experiment brief")
document.setAuthor("Acadia contributors")
document.setSubject("Synthetic text-extraction fixture with embedded Liberation Sans")
document.setCreator("Acadia fixture generator (ReportLab)")
document.setFont(FONT_NAME, 24)
document.drawString(54, 738, "Experiment brief")
document.setFont(FONT_NAME, 12)
document.drawString(
    54, 700,
    "A comparison group is required before attributing the improvement to the research board.",
)
document.showPage()
document.save()
copyfile(FONT_DIR / "LICENSE_LIBERATION", FIXTURES / "LICENSE_LIBERATION")
print(output.relative_to(ROOT))
