import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RunCommandResult = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type SpawnResult = {
  commandForDisplay: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type RunForgeInDockerOptions = {
  projectPath: string;
  forgeArgs: string[];
  timeoutMs?: number;
};

function getEnvString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

function getEnvBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function getDockerImage(): string {
  return getEnvString("FOUNDRY_MCP_IMAGE", "foundry-sandbox:latest");
}

export type BuiltDockerCommand = {
  dockerArgs: string[];
  commandForDisplay: string;
};

export type BuiltDockerBuildCommand = {
  dockerArgs: string[];
  commandForDisplay: string;
};

function formatCommandForDisplay(command: string, args: string[]): string {
  const formatted = args
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
  return `${command} ${formatted}`.trim();
}

async function spawnAndCapture(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<SpawnResult> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "Docker CLI not found. Please install Docker and ensure `docker` is on PATH.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  return {
    commandForDisplay: formatCommandForDisplay(command, args),
    exitCode,
    stdout,
    stderr,
  };
}

export function buildDockerBuildCommand(options?: {
  dockerImage?: string;
  buildContext?: string;
  dockerfilePath?: string;
}): BuiltDockerBuildCommand {
  const dockerImage = options?.dockerImage ?? getDockerImage();

  const buildContext = path.resolve(
    options?.buildContext ?? getEnvString("FOUNDRY_MCP_BUILD_CONTEXT", process.cwd()),
  );

  const dockerfilePath = path.resolve(
    options?.dockerfilePath ??
      getEnvString(
        "FOUNDRY_MCP_DOCKERFILE",
        path.join(buildContext, "Dockerfile.foundry"),
      ),
  );

  const dockerArgs = ["build", "-f", dockerfilePath, "-t", dockerImage, buildContext];
  return {
    dockerArgs,
    commandForDisplay: formatCommandForDisplay("docker", dockerArgs),
  };
}

/**
 * Builds the `docker run ...` argument list for running `forge` in the sandbox.
 */
export function buildForgeDockerCommand(
  options: Omit<RunForgeInDockerOptions, "timeoutMs"> & {
    containerWorkdir?: string;
  },
): BuiltDockerCommand {
  const dockerImage = getDockerImage();
  const containerWorkdir =
    options.containerWorkdir ?? getEnvString("FOUNDRY_MCP_WORKDIR", "/workspace");

  const resolvedProjectPath = path.resolve(options.projectPath);

  const dockerArgs: string[] = [
    "run",
    "--rm",
    "-i",
    "-v",
    `${resolvedProjectPath}:${containerWorkdir}`,
    "-w",
    containerWorkdir,
  ];

  // Best-effort: on Unix, run as the host user to avoid root-owned artifacts.
  if (os.platform() !== "win32") {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
    if (uid !== undefined && gid !== undefined) dockerArgs.push("-u", `${uid}:${gid}`);
  }

  dockerArgs.push(dockerImage, "forge", ...options.forgeArgs);

  const commandForDisplay = formatCommandForDisplay("docker", dockerArgs);
  return { dockerArgs, commandForDisplay };
}

function normalizeToPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function buildContainerPath(
  containerWorkdir: string,
  projectRoot: string,
  targetPath: string,
): string {
  const relativePath = path.relative(projectRoot, targetPath);
  if (relativePath.startsWith("..")) {
    throw new Error(
      `Path ${targetPath} is outside of mounted project root ${projectRoot}`,
    );
  }

  const normalizedWorkdir = normalizeToPosixPath(containerWorkdir).replace(/\/+$/, "");
  const normalizedRelative = relativePath.split(path.sep).join("/");
  if (!normalizedRelative) return normalizedWorkdir || "/";
  return `${normalizedWorkdir}/${normalizedRelative}`;
}

export function ensureConfigPathArg(
  forgeArgs: string[],
  containerConfigPath: string,
): string[] {
  const hasConfigArg = forgeArgs.some(
    (arg) => arg === "--config-path" || arg.startsWith("--config-path="),
  );
  if (hasConfigArg) return forgeArgs;
  return [...forgeArgs, "--config-path", containerConfigPath];
}

export async function findFoundryProjectRoot(startDir: string): Promise<{
  projectRoot: string;
  configPath: string;
}> {
  let currentDir = startDir;
  // Ensure we always work with directories.
  const startStat = await fs.stat(currentDir).catch(() => undefined);
  if (!startStat?.isDirectory()) {
    throw new Error(`projectPath is not a directory: ${startDir}`);
  }

  while (true) {
    const candidate = path.join(currentDir, "foundry.toml");
    const configStat = await fs.stat(candidate).catch(() => undefined);
    if (configStat?.isFile()) {
      return { projectRoot: currentDir, configPath: candidate };
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error(
    `foundry.toml not found. Please ensure the project root contains foundry.toml (checked from ${startDir}).`,
  );
}

let dockerLifecycleLock: Promise<void> = Promise.resolve();

async function withDockerLifecycleLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = dockerLifecycleLock;
  let release!: () => void;
  dockerLifecycleLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    return await fn();
  } finally {
    release();
  }
}

async function ensureSandboxImage(timeoutMs: number): Promise<boolean> {
  const autoBuild = getEnvBool("FOUNDRY_MCP_AUTO_BUILD", true);
  if (!autoBuild) return false;

  const dockerImage = getDockerImage();
  const inspect = await spawnAndCapture(
    "docker",
    ["image", "inspect", dockerImage],
    Math.min(timeoutMs, 30_000),
  );
  if (inspect.exitCode === 0) return false;

  const build = buildDockerBuildCommand({ dockerImage });
  const result = await spawnAndCapture(
    "docker",
    build.dockerArgs,
    Math.max(timeoutMs, 300_000),
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to build sandbox image.\n$ ${result.commandForDisplay}\nexitCode: ${result.exitCode}\n${result.stderr || result.stdout}`,
    );
  }
  return true;
}

async function cleanupSandboxImage(
  timeoutMs: number,
  removeImage: boolean,
): Promise<void> {
  const cleanupImage = getEnvBool("FOUNDRY_MCP_CLEANUP_IMAGE", true);
  if (!cleanupImage || !removeImage) return;

  const dockerImage = getDockerImage();
  await spawnAndCapture(
    "docker",
    ["rmi", "-f", dockerImage],
    Math.min(timeoutMs, 60_000),
  ).catch(() => {
    // Best-effort cleanup.
  });
}

/**
 * Runs `forge ...` inside a Docker container with the host project mounted into the container,
 * enabling "hot sync" for file changes.
 */
export async function runForgeInDocker(
  options: RunForgeInDockerOptions,
): Promise<RunCommandResult> {
  return withDockerLifecycleLock(async () => {
    const timeoutMs = options.timeoutMs ?? 300_000;
    const requestedPath = path.resolve(options.projectPath);

    const { projectRoot, configPath } = await findFoundryProjectRoot(requestedPath);

    const containerWorkdir = getEnvString("FOUNDRY_MCP_WORKDIR", "/workspace");
    const containerConfigPath = buildContainerPath(
      containerWorkdir,
      projectRoot,
      configPath,
    );
    const forgeArgsWithConfig = ensureConfigPathArg(options.forgeArgs, containerConfigPath);

    const imageBuilt = await ensureSandboxImage(timeoutMs);

    try {
      const { dockerArgs, commandForDisplay } = buildForgeDockerCommand({
        projectPath: projectRoot,
        forgeArgs: forgeArgsWithConfig,
        containerWorkdir,
      });

      const result = await spawnAndCapture("docker", dockerArgs, timeoutMs);
      return {
        command: commandForDisplay,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } finally {
      // Container is removed via `--rm`; image cleanup is optional via env.
      await cleanupSandboxImage(timeoutMs, imageBuilt);
    }
  });
}
