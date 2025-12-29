/**
 * Docker 容器管理器
 * 
 * 负责管理 Docker 容器的生命周期和命令执行
 */

import Docker from "dockerode";
import { PassThrough } from "stream";
import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);

/**
 * Docker 管理器类
 */
export class DockerManager {
  private docker: Docker;
  private containerName: string = "foundry-sandbox";
  private projectPath: string;

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
   * 使用 docker-compose 启动容器
   */
  private async startContainerWithCompose(): Promise<void> {
    try {
      // 使用 docker-compose 启动容器
      const { stdout, stderr } = await execAsync(
        `docker-compose -f "${this.projectPath}/docker-compose.yml" up -d foundry-sandbox`,
        {
          cwd: this.projectPath,
          env: {
            ...process.env,
            FOUNDRY_PROJECT_PATH: this.projectPath,
          },
        }
      );

      if (stderr && !stderr.includes("Creating") && !stderr.includes("Starting")) {
        console.error(`Docker Compose stderr: ${stderr}`);
      }

      // 等待容器启动
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 验证容器是否运行
      const container = this.docker.getContainer(this.containerName);
      const info = await container.inspect();
      if (!info.State.Running) {
        throw new Error("Container started but is not running");
      }
    } catch (error) {
      throw new Error(
        `Failed to start container with docker-compose: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 确保容器存在并运行
   */
  async ensureContainerRunning(): Promise<void> {
    try {
      const container = this.docker.getContainer(this.containerName);
      const info = await container.inspect();

      // 如果容器已停止，启动它
      if (!info.State.Running) {
        await container.start();
      }
    } catch (error: unknown) {
      // 容器不存在，自动创建和启动
      if (
        error instanceof Error &&
        (error.message.includes("No such container") ||
          (error as { statusCode?: number }).statusCode === 404)
      ) {
        console.error(`Container '${this.containerName}' not found, creating...`);
        await this.startContainerWithCompose();
      } else {
        throw error;
      }
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
    await this.ensureContainerRunning();

    const container = this.docker.getContainer(this.containerName);
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
   * 清理容器状态（可选，用于确保干净环境）
   */
  async cleanContainerState(): Promise<void> {
    try {
      // 清理 forge 缓存和构建输出
      await this.execCommand("forge", ["clean"]);
    } catch (error) {
      // 忽略清理错误，可能缓存不存在
      console.error(
        `Warning: Failed to clean container state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 获取项目路径
   */
  getProjectPath(): string {
    return this.projectPath;
  }
}

