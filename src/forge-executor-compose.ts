/**
 * Forge 命令执行器（使用 Docker Compose）
 */

import type { ForgeCommand, ForgeResult } from "./types.js";
import { DockerComposeManager } from "./docker-compose-manager.js";

export class ForgeExecutorCompose {
  private composeManager: DockerComposeManager;
  private composeFile: string;

  constructor(composeFile: string = "docker-compose.yml") {
    this.composeFile = composeFile;
    this.composeManager = new DockerComposeManager(composeFile);
  }

  /**
   * 确保容器运行
   */
  private async ensureRunning(): Promise<void> {
    const isRunning = await this.composeManager.isRunning();
    if (!isRunning) {
      await this.composeManager.up();
      // 等待容器启动
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  /**
   * 执行 forge 命令
   */
  async execute(
    command: ForgeCommand,
    workingDir: string = "/app"
  ): Promise<ForgeResult> {
    try {
      await this.ensureRunning();

      // 构建完整的 forge 命令
      const forgeCommand = "forge";
      const args = [command.command, ...(command.args || [])];

      // 执行命令
      const result = await this.composeManager.exec(
        forgeCommand,
        args,
        command.workingDir || workingDir
      );

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        command: `forge ${command.command} ${args.slice(1).join(" ")}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stdout: "",
        stderr: errorMessage,
        exitCode: 1,
        command: `forge ${command.command} ${(command.args || []).join(" ")}`,
      };
    }
  }

  /**
   * 执行自定义命令（非 forge）
   */
  async executeCustom(
    command: string,
    args: string[] = [],
    workingDir: string = "/app"
  ): Promise<ForgeResult> {
    try {
      await this.ensureRunning();

      const result = await this.composeManager.exec(
        command,
        args,
        workingDir
      );

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        command: `${command} ${args.join(" ")}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stdout: "",
        stderr: errorMessage,
        exitCode: 1,
        command: `${command} ${args.join(" ")}`,
      };
    }
  }

  /**
   * 获取容器状态
   */
  async getStatus() {
    return await this.composeManager.getStatus();
  }

  /**
   * 重启容器
   */
  async restart() {
    return await this.composeManager.restart();
  }
}

