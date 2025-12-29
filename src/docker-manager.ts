/**
 * Docker 容器管理模块
 */

import Docker from "dockerode";
import type { ContainerInfo, CreateContainerOptions } from "./types.js";

export class DockerManager {
  private docker: Docker;
  private containers: Map<string, Docker.Container> = new Map();

  constructor() {
    this.docker = new Docker();
  }

  /**
   * 检查 Docker 是否可用
   */
  async checkDockerAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取或创建 Foundry 容器
   */
  async getOrCreateContainer(
    options: CreateContainerOptions = {}
  ): Promise<Docker.Container> {
    const {
      image = "ghcr.io/foundry-rs/foundry:latest",
      name = "foundry-mcp-sandbox",
      workingDir = "/app",
    } = options;

    // 检查容器是否已存在
    if (this.containers.has(name)) {
      const container = this.containers.get(name)!;
      try {
        const info = await container.inspect();
        if (info.State.Running) {
          return container;
        }
        // 容器存在但未运行，启动它
        await container.start();
        return container;
      } catch (error) {
        // 容器不存在，从 map 中移除
        this.containers.delete(name);
      }
    }

    // 查找已存在的容器
    try {
      const existingContainer = this.docker.getContainer(name);
      const info = await existingContainer.inspect();
      this.containers.set(name, existingContainer);
      if (!info.State.Running) {
        await existingContainer.start();
      }
      return existingContainer;
    } catch (error) {
      // 容器不存在，创建新容器
    }

    // 创建新容器
    const container = await this.docker.createContainer({
      Image: image,
      name,
      WorkingDir: workingDir,
      Cmd: ["tail", "-f", "/dev/null"], // 保持容器运行
      Tty: true,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        AutoRemove: false,
        ...(options.volumes && {
          Binds: Object.entries(options.volumes).map(
            ([host, container]) => `${host}:${container}`
          ),
        }),
      },
    });

    await container.start();
    this.containers.set(name, container);
    return container;
  }

  /**
   * 执行容器内的命令
   */
  async execCommand(
    container: Docker.Container,
    command: string,
    args: string[] = [],
    workingDir?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const fullCommand = workingDir
      ? `cd ${workingDir} && ${command} ${args.join(" ")}`
      : `${command} ${args.join(" ")}`;

    const exec = await container.exec({
      Cmd: ["/bin/sh", "-c", fullCommand],
      AttachStdout: true,
      AttachStderr: true,
    });

    return new Promise((resolve, reject) => {
      const output: { stdout: string[]; stderr: string[] } = {
        stdout: [],
        stderr: [],
      };

      exec.start(
        { hijack: true, stdin: false },
        (err: Error | null, stream?: any) => {
          if (err) {
            reject(err);
            return;
          }

          if (!stream) {
            reject(new Error("Failed to get exec stream"));
            return;
          }

          // 分离 stdout 和 stderr
          container.modem.demuxStream(
            stream,
            {
              write: (chunk: any) => {
                output.stdout.push(chunk.toString());
              },
            },
            {
              write: (chunk: any) => {
                output.stderr.push(chunk.toString());
              },
            }
          );

          stream.on("end", async () => {
            try {
              const inspect = await exec.inspect();
              resolve({
                stdout: output.stdout.join(""),
                stderr: output.stderr.join(""),
                exitCode: inspect.ExitCode || 0,
              });
            } catch (error) {
              reject(error);
            }
          });
        }
      );
    });
  }

  /**
   * 列出所有管理的容器
   */
  async listContainers(): Promise<ContainerInfo[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .filter((c: any) =>
        c.Names?.some((n: string) => n.includes("foundry-mcp"))
      )
      .map((c: any) => ({
        id: c.Id,
        name: c.Names?.[0]?.replace("/", "") || "unknown",
        status: c.Status,
        image: c.Image,
      }));
  }

  /**
   * 停止并删除容器
   */
  async removeContainer(name: string): Promise<void> {
    if (this.containers.has(name)) {
      const container = this.containers.get(name)!;
      try {
        await container.stop();
        await container.remove();
      } catch (error) {
        // 忽略错误，可能容器已经停止
      }
      this.containers.delete(name);
    } else {
      try {
        const container = this.docker.getContainer(name);
        await container.stop();
        await container.remove();
      } catch (error) {
        // 容器可能不存在
      }
    }
  }

  /**
   * 清理所有容器
   */
  async cleanup(): Promise<void> {
    const names = Array.from(this.containers.keys());
    await Promise.all(names.map((name) => this.removeContainer(name)));
  }
}
