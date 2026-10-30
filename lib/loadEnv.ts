/**
 * Minimal .env loader. No dependency, no shell setup.
 *
 * Later files win, so callers pass [.env, .env.local, .env.mandate] and the most specific
 * file takes precedence. Overwriting is deliberate: a stale variable left in a shell from
 * an earlier attempt is exactly the failure this replaces.
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
      process.env[key] = value;
    }
  }

  return loaded;
}
