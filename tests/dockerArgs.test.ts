import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildDockerBuildCommand,
  buildForgeDockerCommand,
} from "../src/utils/runForgeInDocker.js";

test("buildForgeDockerCommand includes volume mount and forge args", () => {
  const projectPath = path.resolve(process.cwd());
  const built = buildForgeDockerCommand({ projectPath, forgeArgs: ["test"] });
  assert.ok(built.commandForDisplay.startsWith("docker "));
  assert.ok(built.dockerArgs.includes("-v"));
  assert.ok(built.dockerArgs.includes("-w"));
  assert.ok(built.dockerArgs.includes("forge"));
});

test("buildDockerBuildCommand includes dockerfile, tag, and context", () => {
  const built = buildDockerBuildCommand({
    dockerImage: "foundry-sandbox:latest",
    buildContext: "/tmp/context",
    dockerfilePath: "/tmp/context/Dockerfile.foundry",
  });
  assert.deepEqual(built.dockerArgs.slice(0, 5), [
    "build",
    "-f",
    "/tmp/context/Dockerfile.foundry",
    "-t",
    "foundry-sandbox:latest",
  ]);
  assert.equal(built.dockerArgs[built.dockerArgs.length - 1], "/tmp/context");
});
