import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureConfigPathArg,
  findFoundryProjectRoot,
} from "../src/utils/runForgeInDocker.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foundry-mcp-"));
  try {
    return await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test("findFoundryProjectRoot locates foundry.toml in ancestor directories", async () => {
  await withTempDir(async (root) => {
    const nested = path.join(root, "contracts", "core");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(root, "foundry.toml"), "[profile.default]\n");

    const result = await findFoundryProjectRoot(nested);
    assert.equal(result.projectRoot, root);
    assert.equal(result.configPath, path.join(root, "foundry.toml"));
  });
});

test("findFoundryProjectRoot rejects when foundry.toml is missing", async () => {
  await withTempDir(async (root) => {
    const nested = path.join(root, "contracts");
    await fs.mkdir(nested, { recursive: true });
    await assert.rejects(
      findFoundryProjectRoot(nested),
      /foundry\.toml not found/i,
    );
  });
});

test("ensureConfigPathArg appends config path if missing", () => {
  const args = ["test", "--match-path", "contracts/core"];
  const result = ensureConfigPathArg(args, "/workspace/foundry.toml");
  assert.deepEqual(result.slice(-2), ["--config-path", "/workspace/foundry.toml"]);
  assert.notStrictEqual(result, args);
});

test("ensureConfigPathArg keeps existing config path arguments intact", () => {
  const args = ["build", "--config-path", "/custom/config.toml"];
  const result = ensureConfigPathArg(args, "/workspace/foundry.toml");
  assert.strictEqual(result, args);
});
