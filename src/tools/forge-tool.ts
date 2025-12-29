/**
 * Forge 工具实现
 *
 * 提供 forge test 命令的执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
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
 * Forge 工具类
 */
export class ForgeTool {

  /**
   * 运行 forge test 命令
   * 每次测试时创建新容器，测试完成后删除，确保全新环境
   */
  async runTest(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const validatedArgs = ForgeTestArgsSchema.parse(args);

    // 为每次测试创建新的 DockerManager（会创建新容器）
    const dockerManager = new DockerManager(validatedArgs.projectPath);

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
      // 执行测试命令（会自动创建容器）
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

      // 测试完成后，清理容器（确保每次都是全新环境）
      await dockerManager.removeContainer();

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      // 即使出错，也尝试清理容器
      try {
        await dockerManager.removeContainer();
      } catch (cleanupError) {
        // 忽略清理错误
        console.error(
          `Warning: Failed to cleanup container after error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }

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
