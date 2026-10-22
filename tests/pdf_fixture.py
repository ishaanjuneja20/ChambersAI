"""Tiny PDFs for the document tests, written by hand (no PDF library needed to make them)."""


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list[str]) -> bytes:
    """One page per item; its text is shown line by line. An empty string makes a page with a drawing and no text
    (what a scanned page looks like to a text extractor)."""
    n = len(pages)
    objects: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n))
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, text in enumerate(pages):
        content_no = 5 + 2 * i
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_no} 0 R "
                       f"/Resources << /Font << /F1 3 0 R >> >> >>".encode())
        if text:
            lines = "".join(f"({_escape(line)}) Tj T*\n" for line in text.split("\n"))
            stream = f"BT /F1 11 Tf 14 TL 72 720 Td\n{lines}ET".encode("latin-1")
        else:
            stream = b"0 0 612 792 re f"
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


RENT_AGREEMENT = [
    "RENT AGREEMENT\nThis agreement is made between the Landlord Mr. Sharma and the Tenant Ms. Rao.\n"
    "The monthly rent is Rs. 20,000 payable on the 5th of every month.\nThe security deposit is Rs. 60,000.",
    "The tenancy begins on 1 April 2025 and ends on 31 March 2026.\nEither party may terminate this agreement "
    "by giving 15 days written notice.\nThe tenant shall not sublet the premises without written consent.",
]
