"""
Publish the Hugging Face artefacts the submission form asks for.

    python lexsi/publish_hf.py

Creates:
  - a public model collection  (adapter added once the GPU run finishes)
  - a public dataset collection (the labelled corpus)
  - a community blog post from lexsi/ARTICLE.md

Prints the three URLs to paste into the form.
"""

from __future__ import annotations

import sys
from pathlib import Path

from huggingface_hub import HfApi

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

here = Path(__file__).parent
USER = "yeziR4"
DATASET = f"{USER}/lexsi-policy-compliance"
ARTICLE = here / "ARTICLE.md"

api = HfApi()
print("authenticated as", api.whoami()["name"])


def ensure_collection(title: str, description: str):
    collection = api.create_collection(
        title=title,
        namespace=USER,
        description=description,
        private=False,
        exists_ok=True,
    )
    return collection


models = ensure_collection(
    "Lexsi 2026 — policy-compliance safety tuning",
    "LoRA adapters and model artefacts for the judge-free treasury-agent benchmark.",
)
datasets = ensure_collection(
    "Lexsi 2026 — policy-compliance corpus",
    "Labelled transcripts, attack sets, curated splits and run logs.",
)
print("model collection  ", f"https://huggingface.co/collections/{models.slug}")
print("dataset collection", f"https://huggingface.co/collections/{datasets.slug}")

# dataset is already uploaded; attach it to its collection
try:
    api.add_collection_item(collection_slug=datasets.slug, item_id=DATASET, item_type="dataset")
    print("added dataset to collection")
except Exception as cause:
    print("dataset already in collection or failed:", str(cause)[:120])

# --- article --------------------------------------------------------------
# huggingface_hub has no blog-post API ("blog" is not a valid repo_type), and the organisers
# confirmed a markdown article is acceptable ("html article too works… a markdown (github readme
# or empty hf repo model card)"). So the write-up ships as a model-card README, which renders as
# an article on huggingface.co.

article_repo = f"{USER}/lexsi-policy-compliance"
FRONT_MATTER = """---
library_name: peft
base_model: CohereLabs/tiny-aya-global
tags:
  - safety
  - red-teaming
  - agents
  - tool-use
  - evaluation
  - lexsi
license: cc-by-4.0
---

"""
try:
    api.create_repo(repo_id=article_repo, repo_type="model", exist_ok=True, private=False)
    content = FRONT_MATTER + ARTICLE.read_text(encoding="utf-8")
    (here / "article_card.md").write_text(content, encoding="utf-8")
    api.upload_file(
        path_or_fileobj=str(here / "article_card.md"),
        path_in_repo="README.md",
        repo_id=article_repo,
        repo_type="model",
        commit_message="Judge-free agent safety: harness effects and a mechanical benchmark",
    )
    print("article           ", f"https://huggingface.co/{article_repo}")
    try:
        api.add_collection_item(collection_slug=models.slug, item_id=article_repo, item_type="model")
        print("added article repo to model collection")
    except Exception as cause:
        print("collection add skipped:", str(cause)[:100])
except Exception as cause:
    print("article upload failed:", str(cause)[:200])
