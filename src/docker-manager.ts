/**
 * Docker 容器管理器
 * 
 * 负责管理 Docker 容器的生命周期和命令执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
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

  constructor(projectPath: string) {
    this.docker = new Docker();
    // 项目路径必须通过参数传入
    if (!projectPath) {
      throw new Error("projectPath is required");
    }
    // 解析为绝对路径
    this.projectPath = resolve(projectPath);
  }

  /**
   * 确保 Docker 环境可用
   */
  async ensureDockerAvailable(): Promise<void> {
    try {
      await this.docker.ping();
    } catch (error) {
      throw new Error(
        `Docker is not available. Please ensure Docker is running. Error: ${error instanceof Error ? error.message : String(error)}`
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
      console.error(`Container '${containerName}' created and started`);
    } catch (error) {
      throw new Error(
        `Failed to create and start container: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
      console.error(`Container '${this.containerId}' removed`);
      this.containerId = null;
    } catch (error: unknown) {
      // 如果容器不存在，忽略错误
      if (
        error instanceof Error &&
        (error.message.includes("No such container") ||
          (error as { statusCode?: number }).statusCode === 404)
      ) {
        console.error(`Container '${this.containerId}' already removed`);
        this.containerId = null;
        return;
      }
      // 其他错误记录但不抛出，确保清理流程继续
      console.error(
        `Warning: Failed to remove container: ${error instanceof Error ? error.message : String(error)}`
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
    // 如果容器不存在，创建并启动
    if (!this.containerId) {
      await this.createAndStartContainer();
    }

    const container = this.docker.getContainer(this.containerId!);
    const fullCommand = [command, ...args];

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

    // 收集 stdout 数据
    stdoutStream.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    // 收集 stderr 数据
    stderrStream.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
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

          resolve({ stdout, stderr, exitCode });
        } catch (error) {
          reject(
            new Error(
              `Failed to inspect exec: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Stream error: ${error instanceof Error ? error.message : String(error)}`
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

