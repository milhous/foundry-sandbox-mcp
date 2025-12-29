/**
 * Forge 命令执行器
 */

import type { ForgeCommand, ForgeResult } from "./types.js";
import { DockerManager } from "./docker-manager.js";

export class ForgeExecutor {
  private dockerManager: DockerManager;
  private defaultContainerName = "foundry-mcp-sandbox";

  constructor(dockerManager: DockerManager) {
    this.dockerManager = dockerManager;
  }

  /**
   * 执行 forge 命令
   */
  async execute(
    command: ForgeCommand,
    containerName?: string
  ): Promise<ForgeResult> {
    const name = containerName || this.defaultContainerName;

    try {
      // 获取或创建容器
      const container = await this.dockerManager.getOrCreateContainer({
        name,
        image: "ghcr.io/foundry-rs/foundry:latest",
        workingDir: command.workingDir || "/app",
      });

      // 构建完整的 forge 命令
      const forgeCommand = "forge";
      const args = [command.command, ...(command.args || [])];

      // 执行命令
      const result = await this.dockerManager.execCommand(
        container,
        forgeCommand,
        args,
        command.workingDir
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
    workingDir?: string,
    containerName?: string
  ): Promise<ForgeResult> {
    const name = containerName || this.defaultContainerName;

    try {
      const container = await this.dockerManager.getOrCreateContainer({
        name,
        workingDir: workingDir || "/app",
      });

      const result = await this.dockerManager.execCommand(
        container,
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
}
