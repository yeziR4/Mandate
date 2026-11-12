"""Fetch a Kaggle kernel's log without the CLI's console-encoding problems."""

import io
import sys
import zipfile
from pathlib import Path

import requests

TOKEN = Path.home() / ".kaggle" / "access_token"
KEY = TOKEN.read_text().strip()

USER = "hyezir4"
SLUG = "lexsi-tiny-aya-policy-safety-baseline-vs-tuned"

url = f"https://www.kaggle.com/api/v1/kernels/output?userName={USER}&kernelSlug={SLUG}"
response = requests.get(url, headers={"Authorization": f"Bearer {KEY}"}, timeout=120)
print("status", response.status_code, "bytes", len(response.content))

out = Path("lexsi/kaggle/out")
out.mkdir(parents=True, exist_ok=True)
archive = out / "output.zip"
archive.write_bytes(response.content)

try:
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        names = zf.namelist()
        print("files:", names[:10])
        for name in names:
            if name.endswith(".log"):
                text = zf.read(name).decode("utf-8", "replace")
                target = out / Path(name).name
                target.write_text(text, encoding="utf-8")
                print(f"\n=== {name} (tail) ===")
                print("\n".join(text.splitlines()[-40:]))
except zipfile.BadZipFile:
    print(response.text[:500])
