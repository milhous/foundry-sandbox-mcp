/**
 * Docker 容器管理器
 *
 * 负责管理 Docker 容器的生命周期和命令执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
 *
 * 依赖管理：
 * - 容器创建后，自动检测并安装 npm 依赖（如果项目有 package.json）
 *   - 支持通过 remappings.txt 使用 @openzeppelin/ 等 npm 包路径
 *   - 自动安装 node_modules，支持 OpenZeppelin 等 npm 包
 * - 然后使用 forge install --no-git 安装所有 Git 依赖
 *   - 使用 --no-git 选项避免需要 .gitmodules 文件和 git 仓库初始化
 *   - forge install 会自动处理已存在的依赖（跳过或更新），无需手动检查
 *   - 依赖会安装到 foundry.toml 中配置的 libs 目录（默认为 lib）
 *
 * Docker 镜像管理：
 * - 自动检测 Docker 镜像是否存在
 * - 如果镜像不存在，自动从 MCP 服务器目录读取 Dockerfile.foundry 和 docker-compose.yml
 * - 使用 docker-compose build 命令构建镜像
 * - 支持通过环境变量 FOUNDRY_MCP_PROJECT_PATH 指定 MCP 服务器路径
 * - 如果未设置环境变量，会自动从常见位置查找（需要同时存在 Dockerfile.foundry 和 docker-compose.yml）
 */

import Docker from "dockerode";
import { PassThrough } from "stream";
import { resolve, dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";

/**
 * Docker 管理器类
 */
export class DockerManager {
  private docker: Docker;
  private projectPath: string;
  private mcpProjectPath: string | null = null;
  private containerId: string | null = null;
  private logs: string[] = [];
  private readonly libsPaths: string[];

  constructor(projectPath: string, mcpProjectPath?: string, libsPaths?: string[]) {
    this.docker = new Docker();
    // 项目路径必须通过参数传入
    if (!projectPath) {
      throw new Error("projectPath is required");
    }
    // 解析为绝对路径
    this.projectPath = resolve(projectPath);

    // MCP 项目路径（包含 Dockerfile.foundry 的目录）
    if (mcpProjectPath) {
      this.mcpProjectPath = resolve(mcpProjectPath);
    } else {
      // 尝试从环境变量获取，或使用默认路径
      const envPath = process.env.FOUNDRY_MCP_PROJECT_PATH;
      if (envPath) {
        this.mcpProjectPath = resolve(envPath);
      } else {
        // 尝试从当前文件位置推断（适用于开发环境）
        try {
          // 在 ES 模块中，使用 import.meta.url 获取当前文件路径
          // 但由于这是编译后的代码，我们使用 process.cwd() 作为备选
          // 实际使用时，应该通过环境变量或参数传递
          this.mcpProjectPath = null; // 暂时设为 null，需要时再查找
        } catch {
          this.mcpProjectPath = null;
        }
      }
    }

    // 初始化日志数组
    this.logs = [];
    this.libsPaths =
      libsPaths && libsPaths.length > 0 ? libsPaths : ["lib"];
  }

  /**
   * 添加日志
   */
  private addLog(message: string): void {
    const timestamp = new Date().toISOString();
    this.logs.push(`[${timestamp}] ${message}`);
    // 实时输出到 stderr，MCP 客户端可以实时接收
    console.error(`[MCP] ${message}`);
  }

  /**
   * 输出进度日志（实时刷新）
   * 确保日志能够立即显示在 Agent 端
   *
   * 在 stdio 模式下，stderr 的输出可以被 MCP 客户端实时接收
   * 但需要确保输出立即刷新，避免缓冲延迟
   */
  private logProgress(message: string, flush: boolean = true): void {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const logMessage = `[${timestamp}] [Progress] ${message}\n`;
    // 直接写入 stderr，确保实时输出
    process.stderr.write(logMessage);
    // 强制刷新 stderr 缓冲区
    if (flush) {
      process.stderr.write("", () => {});
    }
  }

  /**
   * 获取所有日志
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * 获取格式化的日志文本
   * 确保日志格式清晰，便于 Agent 阅读
   */
  getFormattedLogs(): string {
    if (this.logs.length === 0) {
      return "\n(无执行日志)";
    }
    return (
      "\n" +
      this.logs
        .map((log, index) => {
          // 提取时间戳和消息
          const match = log.match(/^\[([^\]]+)\]\s*(.+)$/);
          if (match) {
            const [, timestamp, message] = match;
            // 格式化时间戳为更易读的格式
            const date = new Date(timestamp);
            const timeStr = date.toLocaleTimeString("zh-CN", { hour12: false });
            return `[${timeStr}] ${message}`;
          }
          return log;
        })
        .join("\n")
    );
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * 确保 Docker 环境可用
   */
  async ensureDockerAvailable(): Promise<void> {
    try {
      await this.docker.ping();
    } catch (error) {
      throw new Error(
        `Docker is not available. Please ensure Docker is running. Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 查找 MCP Docker 配置路径（包含 Dockerfile.foundry 和 docker-compose.yml 的目录）
   *
   * 查找顺序：
   * 1. 构造函数传入的 mcpProjectPath/docker 或 mcpProjectPath
   * 2. 环境变量 FOUNDRY_MCP_PROJECT_PATH/docker 或 FOUNDRY_MCP_PROJECT_PATH
   * 3. dist/docker（编译后的 docker 文件夹）
   * 4. 当前工作目录的 docker 文件夹
   * 5. 编译后的文件位置的 docker 文件夹
   */
  private findMcpProjectPath(): string | null {
    // 1. 如果已经设置，验证文件存在后返回
    if (this.mcpProjectPath) {
      // 先尝试 mcpProjectPath/docker
      const dockerPath = join(this.mcpProjectPath, "docker");
      const dockerfilePath1 = join(dockerPath, "Dockerfile.foundry");
      const composePath1 = join(dockerPath, "docker-compose.yml");
      if (existsSync(dockerfilePath1) && existsSync(composePath1)) {
        return dockerPath;
      }

      // 再尝试 mcpProjectPath 根目录
      const dockerfilePath2 = join(this.mcpProjectPath, "Dockerfile.foundry");
      const composePath2 = join(this.mcpProjectPath, "docker-compose.yml");
      if (existsSync(dockerfilePath2) && existsSync(composePath2)) {
        return this.mcpProjectPath;
      }
    }

    // 2. 尝试从环境变量获取
    const envPath = process.env.FOUNDRY_MCP_PROJECT_PATH;
    if (envPath) {
      const resolvedPath = resolve(envPath);
      // 先尝试 resolvedPath/docker
      const dockerPath = join(resolvedPath, "docker");
      const dockerfilePath1 = join(dockerPath, "Dockerfile.foundry");
      const composePath1 = join(dockerPath, "docker-compose.yml");
      if (existsSync(dockerfilePath1) && existsSync(composePath1)) {
        this.mcpProjectPath = dockerPath; // 缓存路径
        return dockerPath;
      }

      // 再尝试 resolvedPath 根目录
      const dockerfilePath2 = join(resolvedPath, "Dockerfile.foundry");
      const composePath2 = join(resolvedPath, "docker-compose.yml");
      if (existsSync(dockerfilePath2) && existsSync(composePath2)) {
        this.mcpProjectPath = resolvedPath; // 缓存路径
        return resolvedPath;
      }
    }

    // 3. 尝试从编译后的文件位置查找 dist/docker
    let currentDir: string;
    try {
      // 在 ES 模块中，从 import.meta.url 获取当前文件路径
      const __filename = fileURLToPath(import.meta.url);
      currentDir = dirname(__filename); // dist/docker-manager.js -> dist
    } catch {
      // 如果失败，使用 process.cwd()
      currentDir = process.cwd();
    }

    // 优先查找 dist/docker
    const distDockerPath = join(currentDir, "docker");
    const dockerfilePathDist = join(distDockerPath, "Dockerfile.foundry");
    const composePathDist = join(distDockerPath, "docker-compose.yml");
    if (existsSync(dockerfilePathDist) && existsSync(composePathDist)) {
      this.mcpProjectPath = distDockerPath; // 缓存路径
      return distDockerPath;
    }

    // 4. 尝试从当前工作目录的 docker 文件夹查找
    const cwd = process.cwd();
    const cwdDockerPath = join(cwd, "docker");
    const dockerfilePathCwd = join(cwdDockerPath, "Dockerfile.foundry");
    const composePathCwd = join(cwdDockerPath, "docker-compose.yml");
    if (existsSync(dockerfilePathCwd) && existsSync(composePathCwd)) {
      this.mcpProjectPath = cwdDockerPath; // 缓存路径
      return cwdDockerPath;
    }

    // 5. 尝试从其他常见位置查找
    const commonPaths = [
      join(currentDir, "..", "docker"), // dist/../docker (项目根/docker)
      join(currentDir, "..", "..", "docker"), // dist/../../docker
      currentDir, // dist
      join(currentDir, ".."), // dist/..
    ];

    for (const path of commonPaths) {
      const dockerfilePath = join(path, "Dockerfile.foundry");
      const composePath = join(path, "docker-compose.yml");
      if (existsSync(dockerfilePath) && existsSync(composePath)) {
        this.mcpProjectPath = path; // 缓存路径
        return path;
      }
    }

    return null;
  }

  /**
   * 使用 docker-compose 构建 Docker 镜像
   * 从 MCP 服务器目录读取 Dockerfile.foundry 和 docker-compose.yml
   */
  private async buildImageWithCompose(mcpProjectPath: string): Promise<void> {
    this.logProgress("═══════════════════════════════════════════════════════");
    this.logProgress("🔨 Docker 镜像不存在，开始使用 docker-compose 构建...");
    this.logProgress("═══════════════════════════════════════════════════════");
    this.logProgress(`📁 Docker 配置路径: ${mcpProjectPath}`);
    this.logProgress(
      `📄 Dockerfile: ${join(mcpProjectPath, "Dockerfile.foundry")}`
    );
    this.logProgress(
      `📄 docker-compose.yml: ${join(mcpProjectPath, "docker-compose.yml")}`
    );

    const dockerfilePath = join(mcpProjectPath, "Dockerfile.foundry");
    const composePath = join(mcpProjectPath, "docker-compose.yml");

    if (!existsSync(dockerfilePath)) {
      throw new Error(`Dockerfile.foundry not found at: ${dockerfilePath}`);
    }

    if (!existsSync(composePath)) {
      throw new Error(`docker-compose.yml not found at: ${composePath}`);
    }

    try {
      // 使用 docker compose/docker-compose build 构建镜像
      // -f 指定 compose 文件路径
      // 构建上下文使用 docker 文件夹的父目录（因为 Dockerfile 中的路径是相对于构建上下文的）
      const buildContext = resolve(mcpProjectPath, ".."); // docker 文件夹的父目录
      const composeCommand = this.getComposeCommand();
      const composeArgs = [
        ...composeCommand.args,
        "-f",
        composePath,
        "build",
        "foundry-sandbox",
      ];
      this.logProgress(
        `正在执行: ${composeCommand.command} ${composeArgs.join(" ")}...`
      );
      this.logProgress(`📁 构建上下文: ${buildContext}`);
      this.logProgress("📥 docker-compose 构建输出:");

      // 使用 spawn 实现实时输出
      return new Promise<void>((resolve, reject) => {
        const composeProcess = spawn(
          composeCommand.command,
          composeArgs,
          {
            cwd: buildContext, // 构建上下文使用 docker 文件夹的父目录
            stdio: ["ignore", "pipe", "pipe"], // stdin 忽略，stdout 和 stderr 使用管道
          }
        );

        // 处理标准输出（构建进度）
        composeProcess.stdout?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          const lines = text.split("\n").filter((line) => line.trim());
          for (const line of lines) {
            if (line.trim()) {
              // 过滤掉过于详细的进度信息
              if (
                !line.includes("Downloading") &&
                !line.includes("Extracting") &&
                !line.includes("Pulling")
              ) {
                this.logProgress(line.trim(), false);
              }
            }
          }
        });

        // 处理标准错误输出（可能包含构建日志）
        composeProcess.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          const lines = text.split("\n").filter((line) => line.trim());
          for (const line of lines) {
            if (line.trim()) {
              // 过滤警告和过于详细的信息
              if (
                !line.includes("WARNING") &&
                !line.includes("Downloading") &&
                !line.includes("Extracting")
              ) {
                this.logProgress(line.trim(), false);
              }
            }
          }
        });

        // 处理进程退出
        composeProcess.on("close", (code: number | null) => {
          if (code === 0) {
            this.logProgress(
              "═══════════════════════════════════════════════════════"
            );
            this.logProgress("✅ Docker 镜像构建完成");
            this.logProgress(
              "═══════════════════════════════════════════════════════"
            );
            this.addLog(
              "Docker image 'foundry-sandbox:latest' built successfully using docker-compose"
            );
            resolve();
          } else {
            const errorMsg = `docker-compose build failed with exit code ${code}`;
            this.logProgress(`❌ ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        });

        // 处理进程错误
        composeProcess.on("error", (error: Error) => {
          const errorMsg = `Failed to execute docker-compose: ${error.message}`;
          this.logProgress(`❌ ${errorMsg}`);
          reject(new Error(errorMsg));
        });
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logProgress(`❌ 构建失败: ${errorMessage}`);
      throw new Error(
        `Failed to build Docker image using docker-compose: ${errorMessage}`
      );
    }
  }

  /**
   * 确保 Docker 镜像存在，如果不存在则自动构建
   */
  private async ensureImageExists(): Promise<void> {
    try {
      await this.docker.getImage("foundry-sandbox:latest").inspect();
      // 镜像存在，无需构建
      return;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("No such image") ||
          (error as { statusCode?: number }).statusCode === 404)
      ) {
        // 镜像不存在，尝试使用 docker-compose 自动构建
        const mcpProjectPath = this.findMcpProjectPath();

        if (!mcpProjectPath) {
          throw new Error(
            "Docker image 'foundry-sandbox:latest' not found and cannot auto-build. " +
              "Please set FOUNDRY_MCP_PROJECT_PATH environment variable to point to MCP server directory " +
              "(containing Dockerfile.foundry and docker-compose.yml), or build manually: " +
              "docker-compose build foundry-sandbox"
          );
        }

        // 使用 docker-compose 自动构建镜像
        await this.buildImageWithCompose(mcpProjectPath);
      } else {
        throw error;
      }
    }
  }

  /**
   * 创建并启动容器
   * 每次测试时创建新容器，使用唯一名称
   */
  async createAndStartContainer(): Promise<void> {
    await this.ensureDockerAvailable();
    await this.ensureImageExists();

    // 生成唯一容器名称（基于时间戳）
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const containerName = `foundry-sandbox-${timestamp}-${randomSuffix}`;

    try {
      // 创建容器
      const container = await this.docker.createContainer({
        Image: "foundry-sandbox:latest",
        name: containerName,
        Cmd: ["tail", "-f", "/dev/null"], // 保持容器运行
        WorkingDir: "/workspace",
        HostConfig: {
          Binds: [
            `${this.projectPath}:/workspace`, // 挂载项目目录
          ],
          AutoRemove: false, // 手动删除，以便在测试完成后清理
        },
        Env: [
          "FOUNDRY_PROFILE=default",
          "FOUNDRY_DISABLE_NIGHTLY_WARNING=1", // 禁用 nightly 版本警告
        ],
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        OpenStdin: true,
      });

      // 启动容器
      this.logProgress("正在启动容器...");
      await container.start();
      this.logProgress("✓ 容器已启动");

      // 等待容器完全启动
      this.logProgress("等待容器就绪...");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 验证容器是否运行
      this.logProgress("验证容器状态...");
      const info = await container.inspect();
      if (!info.State.Running) {
        throw new Error("Container created but is not running");
      }
      this.logProgress("✓ 容器运行正常");

      this.containerId = container.id;
      const logMsg = `Container '${containerName}' created and started (ID: ${container.id.substring(
        0,
        12
      )})`;
      this.addLog(logMsg);
      this.logProgress(`✓ ${logMsg}`);
    } catch (error) {
      throw new Error(
        `Failed to create and start container: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 检查并安装 npm 依赖（如果项目有 package.json）
   *
   * @returns 是否成功安装了 npm 依赖
   */
  private async installNpmDependencies(): Promise<boolean> {
    if (!this.containerId) {
      return false;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 检查 package.json 是否存在
      this.logProgress("检查项目是否有 package.json...");
      const checkPackageJson = await container.exec({
        Cmd: ["test", "-f", "package.json"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
      });

      const checkStream = await checkPackageJson.start({
        hijack: true,
        stdin: false,
      });
      const checkResult = await this._captureStreamOutput(
        checkPackageJson,
        checkStream,
        10000,
        false
      );

      if (checkResult.exitCode !== 0) {
        // package.json 不存在，跳过 npm 安装
        this.logProgress("✓ 项目没有 package.json，跳过 npm 依赖安装");
        return true; // 不是错误，只是跳过
      }

      // 检查是否已安装 node_modules
      this.logProgress("检查 node_modules 是否已存在...");
      const checkNodeModules = await container.exec({
        Cmd: ["test", "-d", "node_modules"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
      });

      const checkNodeModulesStream = await checkNodeModules.start({
        hijack: true,
        stdin: false,
      });
      const checkNodeModulesResult = await this._captureStreamOutput(
        checkNodeModules,
        checkNodeModulesStream,
        10000,
        false
      );

      if (checkNodeModulesResult.exitCode === 0) {
        this.logProgress("✓ node_modules 已存在，跳过 npm 安装");
        return true;
      }

      // 安装 npm 依赖
      this.logProgress("正在安装 npm 依赖...");
      this.logProgress("📦 npm install 输出:");

      // 检查是否有 npm 命令
      const checkNpm = await container.exec({
        Cmd: ["which", "npm"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
      });

      const checkNpmStream = await checkNpm.start({
        hijack: true,
        stdin: false,
      });
      const checkNpmResult = await this._captureStreamOutput(
        checkNpm,
        checkNpmStream,
        10000,
        false
      );

      if (checkNpmResult.exitCode !== 0) {
        this.logProgress("⚠️ npm 未安装，跳过 npm 依赖安装");
        this.addLog(
          "Warning: npm is not installed in the container, skipping npm dependencies"
        );
        return true; // 不是错误，只是跳过
      }

      // 执行 npm install
      const npmExec = await container.exec({
        Cmd: ["npm", "install", "--legacy-peer-deps"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
        Env: ["FOUNDRY_DISABLE_NIGHTLY_WARNING=1"],
      });

      const npmStream = await npmExec.start({ hijack: true, stdin: false });
      const npmResult = await this._captureStreamOutput(
        npmExec,
        npmStream,
        300000,
        true
      ); // 5 分钟超时

      if (npmResult.exitCode === 0) {
        this.logProgress("✓ npm 依赖安装成功");
        this.addLog("npm dependencies installed successfully");
        return true;
      } else {
        const errorMsg = `npm 依赖安装失败: ${
          npmResult.stderr || npmResult.stdout
        }`;
        this.logProgress(`✗ ${errorMsg}`);
        this.addLog(`Warning: ${errorMsg}`);
        // npm 安装失败不应该阻止测试执行
        return false;
      }
    } catch (error) {
      const errorMsg = `Failed to install npm dependencies: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logProgress(`⚠️ ${errorMsg}`);
      this.addLog(`Warning: ${errorMsg}`);
      // npm 安装失败不应该阻止测试执行
      return false;
    }
  }

  /**
   * 安装指定的 yarn 包
   * 支持版本号，格式：package@version，例如 ["@openzeppelin/contracts@^4.0.0"]
   * 如果不指定版本号，使用最新版本
   *
   * @param packages - yarn 包名数组，例如 ["@openzeppelin/contracts@^4.0.0", "@chainlink/contracts@^1.0.0"]
   */
  private async installYarnPackages(packages: string[]): Promise<void> {
    if (!this.containerId || !packages || packages.length === 0) {
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 检查是否有 yarn 命令
      const checkYarn = await container.exec({
        Cmd: ["which", "yarn"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
      });

      const checkYarnStream = await checkYarn.start({
        hijack: true,
        stdin: false,
      });
      const checkYarnResult = await this._captureStreamOutput(
        checkYarn,
        checkYarnStream,
        10000,
        false
      );

      if (checkYarnResult.exitCode !== 0) {
        this.logProgress("⚠️ yarn 未安装，跳过 yarn 依赖安装");
        this.addLog(
          "Warning: yarn is not installed in the container, skipping yarn packages"
        );
        return;
      }

      // 安装指定的 yarn 包
      this.logProgress(`正在安装 ${packages.length} 个 yarn 包...`);
      this.logProgress("📦 yarn add 输出:");

      const yarnExec = await container.exec({
        Cmd: ["yarn", "add", ...packages],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
        Env: ["FOUNDRY_DISABLE_NIGHTLY_WARNING=1"],
      });

      const yarnStream = await yarnExec.start({ hijack: true, stdin: false });
      const yarnResult = await this._captureStreamOutput(
        yarnExec,
        yarnStream,
        300000,
        true
      ); // 5 分钟超时

      if (yarnResult.exitCode === 0) {
        this.logProgress(`✓ yarn 包安装成功（${packages.length} 个）`);
        this.addLog(
          `yarn packages installed successfully: ${packages.join(", ")}`
        );
      } else {
        const errorMsg = `yarn 包安装失败: ${
          yarnResult.stderr || yarnResult.stdout
        }`;
        this.logProgress(`✗ ${errorMsg}`);
        this.addLog(`Warning: ${errorMsg}`);
        // yarn 安装失败不应该阻止测试执行
      }
    } catch (error) {
      const errorMsg = `Failed to install yarn packages: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logProgress(`⚠️ ${errorMsg}`);
      this.addLog(`Warning: ${errorMsg}`);
      // yarn 安装失败不应该阻止测试执行
    }
  }

  /**
   * 安装指定的 npm 包
   * 支持版本号，格式：package@version，例如 ["@openzeppelin/contracts@^4.0.0"]
   * 如果不指定版本号，使用最新版本
   *
   * @param packages - npm 包名数组，例如 ["@openzeppelin/contracts@^4.0.0", "@chainlink/contracts@^1.0.0"]
   */
  private async installNpmPackages(packages: string[]): Promise<void> {
    if (!this.containerId || !packages || packages.length === 0) {
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 检查是否有 npm 命令
      const checkNpm = await container.exec({
        Cmd: ["which", "npm"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
      });

      const checkNpmStream = await checkNpm.start({
        hijack: true,
        stdin: false,
      });
      const checkNpmResult = await this._captureStreamOutput(
        checkNpm,
        checkNpmStream,
        10000,
        false
      );

      if (checkNpmResult.exitCode !== 0) {
        this.logProgress("⚠️ npm 未安装，跳过 npm 依赖安装");
        this.addLog(
          "Warning: npm is not installed in the container, skipping npm packages"
        );
        return;
      }

      // 安装指定的 npm 包
      this.logProgress(`正在安装 ${packages.length} 个 npm 包...`);
      this.logProgress("📦 npm install 输出:");

      const npmExec = await container.exec({
        Cmd: ["npm", "install", "--legacy-peer-deps", ...packages],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
        Env: ["FOUNDRY_DISABLE_NIGHTLY_WARNING=1"],
      });

      const npmStream = await npmExec.start({ hijack: true, stdin: false });
      const npmResult = await this._captureStreamOutput(
        npmExec,
        npmStream,
        300000,
        true
      ); // 5 分钟超时

      if (npmResult.exitCode === 0) {
        this.logProgress(`✓ npm 包安装成功（${packages.length} 个）`);
        this.addLog(`npm packages installed successfully: ${packages.join(", ")}`);
      } else {
        const errorMsg = `npm 包安装失败: ${
          npmResult.stderr || npmResult.stdout
        }`;
        this.logProgress(`✗ ${errorMsg}`);
        this.addLog(`Warning: ${errorMsg}`);
        // npm 安装失败不应该阻止测试执行
      }
    } catch (error) {
      const errorMsg = `Failed to install npm packages: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logProgress(`⚠️ ${errorMsg}`);
      this.addLog(`Warning: ${errorMsg}`);
      // npm 安装失败不应该阻止测试执行
    }
  }

  /**
   * 根据依赖清单安装依赖
   * 支持三种包管理器，依赖项格式为 package@version（版本号可选）
   * - forge: 使用 forge install --no-git 安装 Git 依赖
   *   格式：repo@version 或 repo（不指定版本号使用最新版本）
   * - npm: 使用 npm install 安装 npm 包
   *   格式：package@version 或 package（不指定版本号使用最新版本）
   * - yarn: 使用 yarn add 安装 yarn 包
   *   格式：package@version 或 package（不指定版本号使用最新版本）
   *
   * 注意：依赖项已经过格式化处理，数组格式和对象格式都已转换为 package@version 格式
   *
   * @param forgeDependencies - Forge 依赖项数组，例如 ["foundry-rs/forge-std@v1.0.0", "OpenZeppelin/openzeppelin-contracts"]
   * @param npmDependencies - npm 依赖项数组，例如 ["@openzeppelin/contracts@^5.0.2", "@chainlink/contracts"]
   * @param yarnDependencies - yarn 依赖项数组，例如 ["@openzeppelin/contracts@^5.0.2", "@chainlink/contracts"]
   */
  async installDependenciesFromManifest(
    forgeDependencies: string[],
    npmDependencies: string[],
    yarnDependencies: string[]
  ): Promise<void> {
    if (!this.containerId) {
      throw new Error(
        "Container not created. Call createAndStartContainer() first."
      );
    }

    const totalDeps =
      (forgeDependencies?.length || 0) +
      (npmDependencies?.length || 0) +
      (yarnDependencies?.length || 0);
    if (totalDeps === 0) {
      const logMsg = "No dependencies to install";
      this.addLog(logMsg);
      console.error(`[MCP Progress] ${logMsg}`);
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 确保所有 libs 目录存在
      const uniqueLibs = Array.from(new Set(this.libsPaths));
      for (const libPath of uniqueLibs) {
        this.logProgress(`检查并创建 ${libPath} 目录...`);
        const mkdirExec = await container.exec({
          Cmd: ["mkdir", "-p", libPath],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: "/workspace",
        });

        const mkdirStream = await mkdirExec.start({ hijack: true, stdin: false });
        await this._captureStreamOutput(mkdirExec, mkdirStream, 10000, false);
        this.logProgress(`✓ ${libPath} 目录已就绪`);
      }

      // 计算步骤总数
      let stepNumber = 1;
      const totalSteps =
        1 + // 项目 npm 依赖
        (npmDependencies && npmDependencies.length > 0 ? 1 : 0) +
        (yarnDependencies && yarnDependencies.length > 0 ? 1 : 0) +
        (forgeDependencies && forgeDependencies.length > 0 ? 1 : 0);

      // 步骤 1: 安装 npm 依赖（如果项目有 package.json）
      this.logProgress(
        "═══════════════════════════════════════════════════════"
      );
      this.logProgress(
        `步骤 ${stepNumber}/${totalSteps}: 检查并安装项目 npm 依赖（如果存在 package.json）`
      );
      this.logProgress(
        "═══════════════════════════════════════════════════════"
      );
      await this.installNpmDependencies();
      this.logProgress("");
      stepNumber++;

      // 安装依赖清单中指定的 npm 包
      if (npmDependencies && npmDependencies.length > 0) {
        this.logProgress(
          "═══════════════════════════════════════════════════════"
        );
        this.logProgress(
          `步骤 ${stepNumber}/${totalSteps}: 安装 npm 依赖（${npmDependencies.length} 个）`
        );
        this.logProgress(
          "═══════════════════════════════════════════════════════"
        );
        await this.installNpmPackages(npmDependencies);
        this.logProgress("");
        stepNumber++;
      }

      // 安装依赖清单中指定的 yarn 包
      if (yarnDependencies && yarnDependencies.length > 0) {
        this.logProgress(
          "═══════════════════════════════════════════════════════"
        );
        this.logProgress(
          `步骤 ${stepNumber}/${totalSteps}: 安装 yarn 依赖（${yarnDependencies.length} 个）`
        );
        this.logProgress(
          "═══════════════════════════════════════════════════════"
        );
        await this.installYarnPackages(yarnDependencies);
        this.logProgress("");
        stepNumber++;
      }

      // 使用 forge install 安装所有 Forge 依赖
      if (forgeDependencies && forgeDependencies.length > 0) {
        this.logProgress(
          "═══════════════════════════════════════════════════════"
        );
        this.logProgress(
          `步骤 ${stepNumber}/${totalSteps}: 安装 forge 依赖（forge install --no-git，${forgeDependencies.length} 个）`
        );
        this.logProgress(
          "═══════════════════════════════════════════════════════"
        );
        const logMsg = `开始使用 forge install --no-git 安装 ${forgeDependencies.length} 个 forge 依赖项...`;
        this.addLog(logMsg);
        console.error(`[MCP Progress] ${logMsg}`);

        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < forgeDependencies.length; i++) {
          const dependency = forgeDependencies[i];
          const progress = `[${i + 1}/${forgeDependencies.length}]`;

          const installLogMsg = `${progress} 正在使用 forge install --no-git 安装依赖: ${dependency}`;
          this.addLog(installLogMsg);
          this.logProgress(installLogMsg);
          this.logProgress("正在下载依赖，请稍候...");

          const installExec = await container.exec({
            Cmd: [
              "forge",
              "install",
              "--root",
              "/workspace",
              "--no-git",
              dependency,
            ],
            AttachStdout: true,
            AttachStderr: true,
            WorkingDir: "/workspace",
            Env: ["FOUNDRY_DISABLE_NIGHTLY_WARNING=1"],
          });

          const installStream = await installExec.start({
            hijack: true,
            stdin: false,
          });
          this.logProgress("📥 forge install 输出:");
          const installResult = await this._captureStreamOutput(
            installExec,
            installStream,
            300000,
            true
          );

          if (installResult.exitCode === 0) {
            const successMsg = `${progress} 依赖 ${dependency} 安装成功`;
            this.addLog(successMsg);
            this.logProgress(`✓ ${successMsg}`);
            successCount++;
          } else {
            const errorOutput = installResult.stderr || installResult.stdout;
            const cleanError = errorOutput
              .split("\n")
              .filter(
                (line) =>
                  !line.includes("nightly build") &&
                  !line.includes("FOUNDRY_DISABLE_NIGHTLY_WARNING")
              )
              .join("\n")
              .trim();

            const errorMsg = `${progress} 依赖 ${dependency} 安装失败${
              cleanError ? `: ${cleanError}` : ""
            }`;
            this.addLog(errorMsg);
            this.logProgress(`✗ ${errorMsg}`);
            failedCount++;
          }
        }

        const completeMsg = `Forge 依赖处理完成：成功 ${successCount} 个，失败 ${failedCount} 个（共 ${forgeDependencies.length} 个）`;
        this.addLog(completeMsg);
        this.logProgress(`✓ ${completeMsg}`);
      }
    } catch (error) {
      this.addLog(
        `Warning: Failed to install dependencies: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      console.error(
        `[MCP] Warning: Failed to install dependencies: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 捕获流输出（内部方法，用于依赖检查和安装）
   * 实时输出 Docker 命令的执行日志到 Agent
   */
  private async _captureStreamOutput(
    exec: Docker.Exec,
    stream: NodeJS.ReadableStream & { destroy?: () => void },
    timeout: number = 600000,
    realtimeOutput: boolean = true
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      // 实时输出到 stderr，让 Agent 可以看到 Docker 命令的输出
      // 在 stdio 模式下，stderr 的输出可以被 MCP 客户端实时接收
      if (realtimeOutput) {
        const text = chunk.toString("utf-8");
        process.stderr.write(text, () => {
          // 写入完成后立即刷新，确保实时显示
          process.stderr.write("", () => {});
        });
      }
    });

    stderrStream.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // 实时输出到 stderr，让 Agent 可以看到 Docker 命令的错误输出
      // 在 stdio 模式下，stderr 的输出可以被 MCP 客户端实时接收
      if (realtimeOutput) {
        const text = chunk.toString("utf-8");
        process.stderr.write(text, () => {
          // 写入完成后立即刷新，确保实时显示
          process.stderr.write("", () => {});
        });
      }
    });

    // 获取容器对象以使用 demuxStream
    if (!this.containerId) {
      throw new Error("Container ID is not set");
    }
    const container = this.docker.getContainer(this.containerId);
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (typeof (stream as any).destroy === "function") {
          (stream as any).destroy();
        }
        reject(new Error(`Command execution timeout after ${timeout}ms`));
      }, timeout);

      stream.on("end", async () => {
        clearTimeout(timeoutId);

        // 等待流结束，添加超时保护（最多等待5秒）
        await Promise.race([
          new Promise<void>((resolveStream) => {
            let ended = 0;
            const checkEnd = () => {
              ended++;
              if (ended === 2) resolveStream();
            };
            stdoutStream.on("end", checkEnd);
            stderrStream.on("end", checkEnd);
            // 如果流已经结束，立即检查
            if (stdoutStream.readableEnded) checkEnd();
            if (stderrStream.readableEnded) checkEnd();
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);

        try {
          const inspect = await exec.inspect();
          const exitCode = inspect.ExitCode ?? -1;

          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          resolve({ stdout, stderr, exitCode });
        } catch (error) {
          reject(
            new Error(
              `Failed to inspect exec: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          );
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Stream error: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      });
    });
  }

  /**
   * 删除容器
   */
  async removeContainer(): Promise<void> {
    if (!this.containerId) {
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 检查容器状态
      const info = await container.inspect();

      // 如果容器正在运行，先停止
      if (info.State.Running) {
        await container.stop({ t: 10 }); // 10秒超时
      }

      // 删除容器
      await container.remove({ force: true });
      const containerIdShort = this.containerId
        ? this.containerId.substring(0, 12)
        : "unknown";
      const logMsg = `Container removed (ID: ${containerIdShort})`;
      this.addLog(logMsg);
      console.error(`[MCP] ${logMsg}`);
      this.containerId = null;
    } catch (error: unknown) {
      // 如果容器不存在，忽略错误
      if (
        error instanceof Error &&
        (error.message.includes("No such container") ||
          (error as { statusCode?: number }).statusCode === 404)
      ) {
        const containerIdShort = this.containerId
          ? this.containerId.substring(0, 12)
          : "unknown";
        this.addLog(`Container already removed (ID: ${containerIdShort})`);
        this.containerId = null;
        return;
      }
      // 其他错误记录但不抛出，确保清理流程继续
      this.addLog(
        `Warning: Failed to remove container: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.containerId = null;
    }
  }

  /**
   * 清理 Docker system 缓存
   * 使用 docker system prune -f 清理未使用的数据（容器、网络、镜像、构建缓存）
   */
  async cleanupDockerSystemCache(): Promise<void> {
    try {
      this.logProgress("正在清理 Docker system 缓存...");
      this.addLog("Cleaning up Docker system cache...");

      // 使用 spawn 执行 docker system prune -f 命令
      // -f 表示强制清理，不需要确认
      return new Promise<void>((resolve, reject) => {
        const pruneProcess = spawn("docker", ["system", "prune", "-f"], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        // 处理标准输出
        pruneProcess.stdout?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          stdout += text;
          // 实时输出清理进度
          const lines = text.split("\n").filter((line) => line.trim());
          for (const line of lines) {
            if (line.trim()) {
              this.logProgress(line.trim(), false);
            }
          }
        });

        // 处理标准错误输出
        pruneProcess.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          stderr += text;
          // 实时输出清理信息
          const lines = text.split("\n").filter((line) => line.trim());
          for (const line of lines) {
            if (line.trim()) {
              this.logProgress(line.trim(), false);
            }
          }
        });

        // 处理进程退出
        pruneProcess.on("close", (code: number | null) => {
          if (code === 0) {
            const logMsg = "Docker system cache cleaned successfully";
            this.addLog(logMsg);
            this.logProgress(`✓ ${logMsg}`);
            // 如果输出中包含清理信息，记录到日志
            if (stdout.trim()) {
              this.addLog(`Cleanup output: ${stdout.trim()}`);
            }
            resolve();
          } else {
            // 清理失败不应该阻止流程继续，只记录警告
            const errorMsg = `Docker system prune exited with code ${code}${
              stderr ? `: ${stderr.trim()}` : ""
            }`;
            this.addLog(`Warning: ${errorMsg}`);
            this.logProgress(`⚠️ ${errorMsg}`);
            // 不抛出错误，允许流程继续
            resolve();
          }
        });

        // 处理进程错误
        pruneProcess.on("error", (error: Error) => {
          // 清理失败不应该阻止流程继续，只记录警告
          const errorMsg = `Failed to execute docker system prune: ${error.message}`;
          this.addLog(`Warning: ${errorMsg}`);
          this.logProgress(`⚠️ ${errorMsg}`);
          // 不抛出错误，允许流程继续
          resolve();
        });
      });
    } catch (error) {
      // 清理失败不应该阻止流程继续，只记录警告
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorMsg = `Failed to cleanup Docker system cache: ${errorMessage}`;
      this.addLog(`Warning: ${errorMsg}`);
      this.logProgress(`⚠️ ${errorMsg}`);
      // 不抛出错误，允许流程继续
    }
  }

  /**
   * 在容器中执行命令
   *
   * @param command - 要执行的命令
   * @param args - 命令参数数组
   * @param timeout - 超时时间（毫秒），默认 5 分钟
   * @returns 命令执行结果
   */
  async execCommand(
    command: string,
    args: string[] = [],
    timeout: number = 600000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // 如果容器不存在，创建并启动（会自动检查并创建 libs 目录）
    if (!this.containerId) {
      const logMsg = "Container not found, creating new container...";
      this.addLog(logMsg);
      this.logProgress(logMsg);
      await this.createAndStartContainer();
    }

    const container = this.docker.getContainer(this.containerId!);
    const fullCommand = [command, ...args];
    const cmdLog = `Executing command: ${fullCommand.join(" ")}`;
    this.addLog(cmdLog);
    this.logProgress(cmdLog);
    this.logProgress("命令执行中，请稍候...");

    // 创建执行选项
    const execOptions = {
      Cmd: fullCommand,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
    };

    // 创建 exec 实例
    const exec = await container.exec(execOptions);

    // 执行命令并获取输出
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // 启动 exec（返回 Promise）
    const stream = await exec.start({ hijack: true, stdin: false });

    // 创建 PassThrough 流用于分离 stdout 和 stderr
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    // 收集 stdout 数据并实时输出到控制台
    stdoutStream.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      // 实时输出 Docker 命令的输出（不添加前缀，保持原始格式）
      // 这样 Agent 可以看到 forge test 的实时输出
      // 在 stdio 模式下，stderr 的输出可以被 MCP 客户端实时接收
      const text = chunk.toString("utf-8");
      process.stderr.write(text, () => {
        // 写入完成后立即刷新，确保实时显示
        process.stderr.write("", () => {});
      });
    });

    // 收集 stderr 数据并实时输出到控制台
    stderrStream.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // 实时输出 Docker 命令的错误输出（不添加前缀，保持原始格式）
      // 这样 Agent 可以看到 forge test 的错误信息
      // 在 stdio 模式下，stderr 的输出可以被 MCP 客户端实时接收
      const text = chunk.toString("utf-8");
      process.stderr.write(text, () => {
        // 写入完成后立即刷新，确保实时显示
        process.stderr.write("", () => {});
      });
    });

    // 使用 demuxStream 分离 stdout 和 stderr
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    // 返回 Promise，等待命令执行完成
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command execution timeout after ${timeout}ms`));
      }, timeout);

      stream.on("end", async () => {
        clearTimeout(timeoutId);

        // 等待流结束，添加超时保护（最多等待5秒）
        await Promise.race([
          new Promise<void>((resolveStream) => {
            let ended = 0;
            const checkEnd = () => {
              ended++;
              if (ended === 2) resolveStream();
            };
            stdoutStream.on("end", checkEnd);
            stderrStream.on("end", checkEnd);
            // 如果流已经结束，立即检查
            if (stdoutStream.readableEnded) checkEnd();
            if (stderrStream.readableEnded) checkEnd();
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);

        try {
          const inspect = await exec.inspect();
          const exitCode = inspect.ExitCode ?? -1;

          // 合并所有输出
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");

          // 记录命令执行结果
          const resultLog =
            exitCode === 0
              ? `Command executed successfully (exit code: ${exitCode})`
              : `Command failed (exit code: ${exitCode})`;
          this.addLog(resultLog);

          resolve({ stdout, stderr, exitCode });
        } catch (error) {
          reject(
            new Error(
              `Failed to inspect exec: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          );
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Stream error: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      });
    });
  }

  /**
   * 获取项目路径
   */
  getProjectPath(): string {
    return this.projectPath;
  }

  /**
   * 获取容器 ID（用于调试）
   */
  getContainerId(): string | null {
    return this.containerId;
  }

  /**
   * 选择 docker compose 命令（优先新版 "docker compose"）
   */
  private getComposeCommand(): { command: string; args: string[] } {
    const commonOptions = { stdio: "ignore" as const };

    const dockerCompose = spawnSync("docker", ["compose", "version"], commonOptions);
    if (!dockerCompose.error && dockerCompose.status === 0) {
      return { command: "docker", args: ["compose"] };
    }

    const legacyCompose = spawnSync("docker-compose", ["version"], commonOptions);
    if (!legacyCompose.error && legacyCompose.status === 0) {
      return { command: "docker-compose", args: [] };
    }

    throw new Error(
      "Neither 'docker compose' nor 'docker-compose' is available. Please install Docker Compose."
    );
  }
}
