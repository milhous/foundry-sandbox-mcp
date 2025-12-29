/**
 * Forge 工具实现
 *
 * 提供 forge test、forge build 等命令的执行
 */

import { DockerManager } from "../docker-manager.js";
import { z } from "zod";
import { resolve } from "path";

/**
 * Forge 测试参数验证 Schema
 */
const ForgeTestArgsSchema = z.object({
  projectPath: z
    .string()
    .describe("Foundry 项目根路径（包含 foundry.toml 的目录）"),
  testPath: z.string().optional(),
  matchPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
});

/**
 * Forge 构建参数验证 Schema
 */
const ForgeBuildArgsSchema = z.object({
  projectPath: z
    .string()
    .describe("Foundry 项目根路径（包含 foundry.toml 的目录）"),
  extraArgs: z.array(z.string()).optional(),
});

/**
 * Forge 清理参数验证 Schema
 */
const ForgeCleanArgsSchema = z.object({
  projectPath: z
    .string()
    .describe("Foundry 项目根路径（包含 foundry.toml 的目录）"),
});

/**
 * Forge 工具类
 */
export class ForgeTool {
  // 缓存项目路径到 DockerManager 的映射
  private dockerManagers: Map<string, DockerManager> = new Map();

  /**
   * 获取或创建 DockerManager
   */
  private getDockerManager(projectPath: string): DockerManager {
    // 解析为绝对路径
    const resolvedPath = resolve(projectPath);

    if (!this.dockerManagers.has(resolvedPath)) {
      this.dockerManagers.set(resolvedPath, new DockerManager(resolvedPath));
    }

    return this.dockerManagers.get(resolvedPath)!;
  }

  /**
   * 运行 forge test 命令
   */
  async runTest(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const validatedArgs = ForgeTestArgsSchema.parse(args);

    // 获取对应项目路径的 DockerManager
    const dockerManager = this.getDockerManager(validatedArgs.projectPath);

    // 构建命令参数
    const cmdArgs: string[] = ["test"];

    // 处理测试路径匹配
    if (validatedArgs.matchPath) {
      cmdArgs.push("--match-path", validatedArgs.matchPath);
    } else if (validatedArgs.testPath) {
      // 如果提供了 testPath，使用 --match-path
      cmdArgs.push("--match-path", validatedArgs.testPath);
    }

    // 添加额外参数
    if (validatedArgs.extraArgs) {
      cmdArgs.push(...validatedArgs.extraArgs);
    }

    try {
      const result = await dockerManager.execCommand("forge", cmdArgs);

      // 格式化输出
      let output = result.stdout;
      if (result.stderr) {
        output += `\n\nSTDERR:\n${result.stderr}`;
      }

      // 判断测试结果
      const isSuccess = result.exitCode === 0;
      const status = isSuccess ? "PASS" : "FAIL";

      // 提取失败原因（如果存在）
      let reason = "";
      if (!isSuccess) {
        // 尝试从输出中提取错误信息
        const errorMatch = output.match(
          /(Error|Failed|Revert|ReentrancyGuard|AssertionError)[^\n]*/
        );
        if (errorMatch) {
          reason = errorMatch[0];
        } else {
          reason = "Test execution failed";
        }
      }

      const resultText = reason
        ? `${status}. Reason: ${reason}\n\n${output}`
        : `${status}\n\n${output}`;

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }

  /**
   * 运行 forge build 命令
   */
  async runBuild(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const validatedArgs = ForgeBuildArgsSchema.parse(args);

    // 获取对应项目路径的 DockerManager
    const dockerManager = this.getDockerManager(validatedArgs.projectPath);

    // 构建命令参数
    const cmdArgs: string[] = ["build"];

    // 添加额外参数
    if (validatedArgs.extraArgs) {
      cmdArgs.push(...validatedArgs.extraArgs);
    }

    try {
      const result = await dockerManager.execCommand("forge", cmdArgs);

      // 格式化输出
      let output = result.stdout;
      if (result.stderr) {
        output += `\n\nSTDERR:\n${result.stderr}`;
      }

      const status = result.exitCode === 0 ? "SUCCESS" : "FAIL";

      return {
        content: [
          {
            type: "text",
            text: `${status}\n\n${output}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }

  /**
   * 运行 forge clean 命令
   */
  async runClean(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const validatedArgs = ForgeCleanArgsSchema.parse(args);

    // 获取对应项目路径的 DockerManager
    const dockerManager = this.getDockerManager(validatedArgs.projectPath);

    try {
      const result = await dockerManager.execCommand("forge", ["clean"]);

      const status = result.exitCode === 0 ? "SUCCESS" : "FAIL";

      return {
        content: [
          {
            type: "text",
            text: `${status}\n\n${result.stdout}${
              result.stderr ? `\n\nSTDERR:\n${result.stderr}` : ""
            }`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
}
