import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";

const src = "lexsi/kaggle/train.py";
const outDir = "lexsi/kaggle/build";
mkdirSync(outDir, { recursive: true });

let script = readFileSync(src, "utf8");
const token = readFileSync(process.env.USERPROFILE + "/.cache/huggingface/token", "utf8").trim();

script = script.replace(
  'import json\nimport os',
  `import json\nimport os\n\nos.environ.setdefault("HF_TOKEN", "${token}")`
);

writeFileSync(`${outDir}/train.py`, script);
copyFileSync("lexsi/kaggle/kernel-metadata.json", `${outDir}/kernel-metadata.json`);
console.log("build copy written (token embedded; directory is gitignored)");
