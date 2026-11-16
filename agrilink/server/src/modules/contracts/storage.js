import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Write-once, versioned document store (local stand-in for AWS S3 with Versioning + Object Lock).
 * Keys look like  AGL-2026-00001/v1-signed.pdf . An existing key can never be overwritten ("wx" flag).
 */
const ROOT = process.env.DOC_STORE_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../storage/agreements");

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function createStore(root = ROOT) {
  return {
    root,
    async putOnce(key, buf) {
      const file = path.join(root, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const fh = await fs.open(file, "wx"); // throws EEXIST instead of overwriting
      try { await fh.writeFile(buf); } finally { await fh.close(); }
      return { key, sha256: sha256(buf), size: buf.length };
    },
    async get(key) {
      return fs.readFile(path.join(root, key));
    },
  };
}
