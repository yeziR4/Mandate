/**
 * Minimal .env loader. No dependency, no shell setup.
 *
 * It reads <repo>/.env.local (then .env) and fills process.env for any key that is not
 * already set, so a real environment variable still wins. The file is gitignored.
 */
import { existsSync, readFileSync } from "node:fs";

export function loadEnv(files: string[]): string[] {
  const loaded: string[] = [];

  for (const file of files) {
    if (!existsSync(file)) continue;
    loaded.push(file);

    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, key, raw] = match;
      let value = raw;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }

  return loaded;
}
