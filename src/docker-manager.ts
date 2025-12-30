/**
 * Docker 容器管理器
 *
 * 负责管理 Docker 容器的生命周期和命令执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
 * 
 * 依赖管理：
 * - 容器创建后，自动检查 foundry.toml 中配置的 libs 目录
 * - 如果 libs 目录不存在或为空，自动创建目录
 * - 当 forge 需要安装依赖时，会安装到 libs 指定的文件夹中
 */

import Docker from "dockerode";
import { PassThrough } from "stream";
import { resolve } from "path";
import { FoundryConfig } from "./config/foundry-config.js";

/**
 * Docker 管理器类
 */
export class DockerManager {
  private docker: Docker;
  private projectPath: string;
  private foundryConfig: FoundryConfig | null = null;
  private containerId: string | null = null;
  private logs: string[] = [];

  constructor(projectPath: string, foundryConfig?: FoundryConfig) {
    this.docker = new Docker();
    // 项目路径必须通过参数传入
    if (!projectPath) {
      throw new Error("projectPath is required");
    }
    // 解析为绝对路径
    this.projectPath = resolve(projectPath);
    // 保存配置信息（用于读取 foundry.toml 配置，不用于依赖安装）
    this.foundryConfig = foundryConfig || null;
    // 初始化日志数组
    this.logs = [];
  }

  /**
   * 添加日志
   */
  private addLog(message: string): void {
    const timestamp = new Date().toISOString();
    this.logs.push(`[${timestamp}] ${message}`);
    // 同时输出到 console.error（用于调试）
    console.error(message);
  }

  /**
   * 获取所有日志
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * 获取格式化的日志文本
   */
  getFormattedLogs(): string {
    if (this.logs.length === 0) {
      return "";
    }
    return "\n\n--- Execution Logs ---\n" + this.logs.join("\n") + "\n--- End Logs ---\n";
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
      await container.start();

      // 等待容器完全启动
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 验证容器是否运行
      const info = await container.inspect();
      if (!info.State.Running) {
        throw new Error("Container created but is not running");
      }

      this.containerId = container.id;
      const logMsg = `Container '${containerName}' created and started (ID: ${container.id.substring(0, 12)})`;
      this.addLog(logMsg);
      // 实时输出到控制台
      console.error(`[MCP] ${logMsg}`);

      // 容器创建后，检查并安装依赖（如果需要）
      await this.ensureDependenciesInstalled();
    } catch (error) {
      throw new Error(
        `Failed to create and start container: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 确保项目依赖已安装
   * 根据 foundry.toml 中的 libs 配置，检查依赖目录是否存在
   * 如果不存在或为空，则创建目录并安装依赖
   */
  private async ensureDependenciesInstalled(): Promise<void> {
    if (!this.containerId || !this.foundryConfig) {
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);
      const libsPaths = this.foundryConfig.libs || ["lib"];

      // 检查所有 libs 目录是否存在且不为空
      let needsInstall = true;
      for (const libPath of libsPaths) {
        const checkExec = await container.exec({
          Cmd: [
            "sh",
            "-c",
            `test -d ${libPath} && [ \"$(ls -A ${libPath} 2>/dev/null)\" ] && echo 'exists' || echo 'missing'`,
          ],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: "/workspace",
        });

        const checkStream = await checkExec.start({ hijack: true, stdin: false });
        const checkResult = await this._captureStreamOutput(checkExec, checkStream, 10000);
        
        if (checkResult.stdout.trim() === "exists") {
          needsInstall = false;
          break;
        }
      }

      if (needsInstall) {
        const libsInfo = libsPaths.join(", ");
        const logMsg = `libs 目录（${libsInfo}）不存在或为空，开始创建目录...`;
        this.addLog(logMsg);
        console.error(`[MCP] ${logMsg}`);

        // 确保 libs 目录存在（使用第一个 libs 路径作为主目录）
        const primaryLibPath = libsPaths[0];
        const mkdirExec = await container.exec({
          Cmd: ["mkdir", "-p", primaryLibPath],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: "/workspace",
        });

        const mkdirStream = await mkdirExec.start({ hijack: true, stdin: false });
        await this._captureStreamOutput(mkdirExec, mkdirStream, 10000);

        // 读取 foundry.toml 以获取需要安装的依赖
        // 注意：foundry.toml 可能包含 remappings，我们可以从中推断依赖
        // 但更常见的情况是，当 forge test 运行时，如果缺少依赖，会报错
        // 此时我们可以从错误信息中提取依赖名称并安装
        
        const logMsg1 = `已创建 libs 目录: ${primaryLibPath}`;
        const logMsg2 = `libs 目录已创建。当 forge 需要安装依赖时，会自动安装到 ${primaryLibPath} 目录。`;
        this.addLog(logMsg1);
        this.addLog(logMsg2);
        console.error(`[MCP] ${logMsg1}`);
        console.error(`[MCP] ${logMsg2}`);
      } else {
        const logMsg = "libs 目录已存在且不为空，跳过依赖安装";
        this.addLog(logMsg);
        console.error(`[MCP] ${logMsg}`);
      }
    } catch (error) {
      // 依赖检查/安装失败不应该阻止测试执行
      this.addLog(
        `Warning: Failed to check/install dependencies: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 捕获流输出（内部方法，用于依赖检查和安装）
   */
  private async _captureStreamOutput(
    exec: Docker.Exec,
    stream: NodeJS.ReadableStream & { destroy?: () => void },
    timeout: number = 300000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    stderrStream.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
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

        await new Promise<void>((resolveStream) => {
          let ended = 0;
          const checkEnd = () => {
            ended++;
            if (ended === 2) resolveStream();
          };
          stdoutStream.on("end", checkEnd);
          stderrStream.on("end", checkEnd);
        });

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
    timeout: number = 300000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // 如果容器不存在，创建并启动（会自动检查并创建 libs 目录）
    if (!this.containerId) {
      const logMsg = "Container not found, creating new container...";
      this.addLog(logMsg);
      console.error(`[MCP] ${logMsg}`);
      await this.createAndStartContainer();
    }

    const container = this.docker.getContainer(this.containerId!);
    const fullCommand = [command, ...args];
    const cmdLog = `Executing command: ${fullCommand.join(" ")}`;
    this.addLog(cmdLog);
    // 实时输出到控制台
    console.error(`[MCP] ${cmdLog}`);

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
      // 实时打印到控制台
      const text = chunk.toString("utf-8");
      process.stderr.write(text);
    });

    // 收集 stderr 数据并实时输出到控制台
    stderrStream.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // 实时打印到控制台
      const text = chunk.toString("utf-8");
      process.stderr.write(text);
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

        // 等待流结束
        await new Promise<void>((resolveStream) => {
          let ended = 0;
          const checkEnd = () => {
            ended++;
            if (ended === 2) resolveStream();
          };
          stdoutStream.on("end", checkEnd);
          stderrStream.on("end", checkEnd);
        });

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
          // 实时输出到控制台
          console.error(`[MCP] ${resultLog}`);

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
