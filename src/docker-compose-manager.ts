/**
 * Docker Compose 管理模块
 * 使用 Docker Compose 管理 Foundry 沙盒容器
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);

export class DockerComposeManager {
  private composeFile: string;
  private projectDir: string;
  private serviceName: string;

  constructor(
    composeFile: string = "docker-compose.yml",
    serviceName: string = "foundry-sandbox"
  ) {
    this.projectDir = process.cwd();
    this.composeFile = path.join(this.projectDir, composeFile);
    this.serviceName = serviceName;
  }

  /**
   * 检查 Docker Compose 是否可用
   */
  async checkDockerComposeAvailable(): Promise<boolean> {
    try {
      await execAsync("docker compose version");
      return true;
    } catch (error) {
      // 尝试旧版本的 docker-compose
      try {
        await execAsync("docker-compose version");
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * 获取 Docker Compose 命令
   */
  private async getComposeCommand(): Promise<string> {
    try {
      // 尝试新版本的 docker compose
      await execAsync("docker compose version");
      return "docker compose";
    } catch {
      // 回退到旧版本
      return "docker-compose";
    }
  }

  /**
   * 启动容器
   */
  async up(detached: boolean = true): Promise<void> {
    if (!fs.existsSync(this.composeFile)) {
      throw new Error(`Docker Compose file not found: ${this.composeFile}`);
    }

    const composeCmd = await this.getComposeCommand();
    const cmd = detached
      ? `${composeCmd} -f ${this.composeFile} up -d`
      : `${composeCmd} -f ${this.composeFile} up`;

    const { stdout, stderr } = await execAsync(cmd, {
      cwd: this.projectDir,
    });

    if (stderr && !stderr.includes("Creating") && !stderr.includes("Starting")) {
      throw new Error(`Failed to start containers: ${stderr}`);
    }
  }

  /**
   * 停止容器
   */
  async down(removeVolumes: boolean = false): Promise<void> {
    if (!fs.existsSync(this.composeFile)) {
      return; // 如果文件不存在，认为已经停止
    }

    const composeCmd = await this.getComposeCommand();
    const cmd = removeVolumes
      ? `${composeCmd} -f ${this.composeFile} down -v`
      : `${composeCmd} -f ${this.composeFile} down`;

    await execAsync(cmd, { cwd: this.projectDir });
  }

  /**
   * 重启容器
   */
  async restart(): Promise<void> {
    await this.down();
    await this.up();
  }

  /**
   * 检查容器是否运行
   */
  async isRunning(): Promise<boolean> {
    try {
      const composeCmd = await this.getComposeCommand();
      const { stdout } = await execAsync(
        `${composeCmd} -f ${this.composeFile} ps -q ${this.serviceName}`,
        { cwd: this.projectDir }
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 获取容器状态
   */
  async getStatus(): Promise<{
    running: boolean;
    containers: Array<{ name: string; status: string }>;
  }> {
    try {
      const composeCmd = await this.getComposeCommand();
      const { stdout } = await execAsync(
        `${composeCmd} -f ${this.composeFile} ps`,
        { cwd: this.projectDir }
      );

      const lines = stdout.split("\n").filter((l) => l.trim());
      const containers = lines
        .slice(1) // 跳过标题行
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0] || "unknown",
            status: parts[1] || "unknown",
          };
        })
        .filter((c) => c.name !== "unknown");

      return {
        running: containers.length > 0,
        containers,
      };
    } catch (error) {
      return {
        running: false,
        containers: [],
      };
    }
  }

  /**
   * 在容器内执行命令
   */
  async exec(
    command: string,
    args: string[] = [],
    workingDir?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const composeCmd = await this.getComposeCommand();
    const fullCommand = workingDir
      ? `cd ${workingDir} && ${command} ${args.join(" ")}`
      : `${command} ${args.join(" ")}`;

    const cmd = `${composeCmd} -f ${this.composeFile} exec -T ${this.serviceName} sh -c ${JSON.stringify(fullCommand)}`;

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.projectDir,
      });

      return {
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || "",
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * 查看日志
   */
  async logs(lines: number = 100): Promise<string> {
    const composeCmd = await this.getComposeCommand();
    const { stdout } = await execAsync(
      `${composeCmd} -f ${this.composeFile} logs --tail=${lines} ${this.serviceName}`,
      { cwd: this.projectDir }
    );
    return stdout;
  }
}

