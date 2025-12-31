/**
 * Docker 容器管理器
 *
 * 负责管理 Docker 容器的生命周期和命令执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
 * 
 * 依赖管理：
 * - 容器创建后，自动使用 forge install 安装所有依赖
 * - forge install 会自动处理已存在的依赖（跳过或更新），无需手动检查
 * - 依赖会安装到 foundry.toml 中配置的 libs 目录（默认为 lib）
 */

import Docker from "dockerode";
import { PassThrough } from "stream";
import { resolve } from "path";

/**
 * Docker 管理器类
 */
export class DockerManager {
  private docker: Docker;
  private projectPath: string;
  private containerId: string | null = null;
  private logs: string[] = [];

  constructor(projectPath: string) {
    this.docker = new Docker();
    // 项目路径必须通过参数传入
    if (!projectPath) {
      throw new Error("projectPath is required");
    }
    // 解析为绝对路径
    this.projectPath = resolve(projectPath);
    // 初始化日志数组
    this.logs = [];
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
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logMessage = `[${timestamp}] [Progress] ${message}\n`;
    // 直接写入 stderr，确保实时输出
    process.stderr.write(logMessage);
    // 强制刷新 stderr 缓冲区
    if (flush) {
      process.stderr.write('', () => {});
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
    return "\n" + this.logs.map((log, index) => {
      // 提取时间戳和消息
      const match = log.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (match) {
        const [, timestamp, message] = match;
        // 格式化时间戳为更易读的格式
        const date = new Date(timestamp);
        const timeStr = date.toLocaleTimeString('zh-CN', { hour12: false });
        return `[${timeStr}] ${message}`;
      }
      return log;
    }).join("\n");
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
   * 确保 Docker 镜像存在
   */
  private async ensureImageExists(): Promise<void> {
    try {
      await this.docker.getImage("foundry-sandbox:latest").inspect();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("No such image") ||
          (error as { statusCode?: number }).statusCode === 404)
      ) {
        throw new Error(
          "Docker image 'foundry-sandbox:latest' not found. Please build it first using: docker build -t foundry-sandbox:latest -f Dockerfile.foundry ."
        );
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
        Env: ["FOUNDRY_PROFILE=default"],
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
      const logMsg = `Container '${containerName}' created and started (ID: ${container.id.substring(0, 12)})`;
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
   * 根据依赖清单安装依赖
   * 优化：统一使用 forge install 安装所有依赖
   * forge install 会自动处理已存在的依赖（跳过或更新），无需手动检查
   * 
   * @param dependencies - 依赖项数组，例如 ["foundry-rs/forge-std", "OpenZeppelin/openzeppelin-contracts"]
   */
  async installDependenciesFromManifest(dependencies: string[]): Promise<void> {
    if (!this.containerId) {
      throw new Error("Container not created. Call createAndStartContainer() first.");
    }

    if (!dependencies || dependencies.length === 0) {
      const logMsg = "No dependencies to install";
      this.addLog(logMsg);
      console.error(`[MCP Progress] ${logMsg}`);
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 确保 lib 目录存在
      const libPath = "lib";
      this.logProgress("检查并创建 lib 目录...");
      const mkdirExec = await container.exec({
        Cmd: ["mkdir", "-p", libPath],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/workspace",
      });

      const mkdirStream = await mkdirExec.start({ hijack: true, stdin: false });
      // mkdir 命令不需要实时输出
      await this._captureStreamOutput(mkdirExec, mkdirStream, 10000, false);
      this.logProgress("✓ lib 目录已就绪");

      // 使用 forge install 安装所有依赖
      // forge install 会自动处理已存在的依赖，无需手动检查
      const logMsg = `开始使用 forge install 安装 ${dependencies.length} 个依赖项...`;
      this.addLog(logMsg);
      console.error(`[MCP Progress] ${logMsg}`);

      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < dependencies.length; i++) {
        const dependency = dependencies[i];
        const progress = `[${i + 1}/${dependencies.length}]`;
        
        // 使用 forge install 安装依赖
        const installLogMsg = `${progress} 正在使用 forge install 安装依赖: ${dependency}`;
        this.addLog(installLogMsg);
        this.logProgress(installLogMsg);
        this.logProgress("正在下载依赖，请稍候...");

        const installExec = await container.exec({
          Cmd: ["forge", "install", "--root", "/workspace", dependency],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: "/workspace",
        });

        const installStream = await installExec.start({ hijack: true, stdin: false });
        // 增加超时时间到 5 分钟（300000ms），避免网络慢时超时
        // 启用实时输出，让 Agent 可以看到依赖安装的进度
        this.logProgress("📥 forge install 输出:");
        const installResult = await this._captureStreamOutput(installExec, installStream, 300000, true);

        if (installResult.exitCode === 0) {
          // forge install 成功（包括已存在的情况，forge install 会跳过已存在的依赖）
          const successMsg = `${progress} 依赖 ${dependency} 处理成功（已安装或已存在）`;
          this.addLog(successMsg);
          this.logProgress(`✓ ${successMsg}`);
          successCount++;
        } else {
          // forge install 失败
          const errorMsg = `${progress} 依赖 ${dependency} 安装失败: ${installResult.stderr || installResult.stdout}`;
          this.addLog(errorMsg);
          this.logProgress(`✗ ${errorMsg}`);
          failedCount++;
          // 继续安装其他依赖，不中断流程
        }
      }

      const completeMsg = `依赖处理完成：成功 ${successCount} 个，失败 ${failedCount} 个（共 ${dependencies.length} 个）`;
      this.addLog(completeMsg);
      this.logProgress(`✓ ${completeMsg}`);
    } catch (error) {
      // 依赖安装失败不应该阻止测试执行
      this.addLog(
        `Warning: Failed to install dependencies: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      console.error(`[MCP] Warning: Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`);
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
          process.stderr.write('', () => {});
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
          process.stderr.write('', () => {});
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
      const containerIdShort = this.containerId ? this.containerId.substring(0, 12) : "unknown";
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
        const containerIdShort = this.containerId ? this.containerId.substring(0, 12) : "unknown";
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
        process.stderr.write('', () => {});
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
        process.stderr.write('', () => {});
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
      const resultLog = exitCode === 0
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
}
