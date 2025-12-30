/**
 * Forge 工具实现
 *
 * 提供 forge test 命令的执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
 * 
 * 依赖管理：
 * - 容器创建后，自动检查 foundry.toml 中配置的 libs 目录
 * - 如果 libs 目录不存在或为空，自动创建目录
 * - 当 forge 需要安装依赖时，会安装到 libs 指定的文件夹中
 */

import { DockerManager } from "../docker-manager.js";
import { z } from "zod";
import { parseFoundryToml, validateFoundryTomlPath, FoundryConfig } from "../config/foundry-config.js";

/**
 * Forge 测试参数验证 Schema
 */
const ForgeTestArgsSchema = z.object({
  foundryTomlPath: z
    .string()
    .describe("foundry.toml 文件的绝对路径"),
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
    // 验证参数
    const validatedArgs = ForgeTestArgsSchema.parse(args);

    // 验证并解析 foundry.toml
    let foundryConfig: FoundryConfig;
    try {
      const foundryTomlPath = validateFoundryTomlPath(validatedArgs.foundryTomlPath);
      foundryConfig = parseFoundryToml(foundryTomlPath);
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }

    // 为每次测试创建新的 DockerManager（会创建新容器）
    // 使用解析出的项目根目录和配置信息
    const dockerManager = new DockerManager(foundryConfig.projectRoot, foundryConfig);

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
      // 执行测试命令（会自动创建容器并检查依赖）
      let result = await dockerManager.execCommand("forge", cmdArgs);

      // 检查是否需要安装依赖（通过错误信息判断）
      const output = result.stdout + (result.stderr ? `\n\nSTDERR:\n${result.stderr}` : "");
      const missingDependencyPattern = /Unable to resolve import|File not found|No such file or directory/i;
      
      if (result.exitCode !== 0 && missingDependencyPattern.test(output)) {
        // 检测到依赖缺失错误
        console.error("检测到依赖缺失错误，请确保 libs 目录中包含所需的依赖。");
      }

      // 格式化输出
      let formattedOutput = result.stdout;
      if (result.stderr) {
        formattedOutput += `\n\nSTDERR:\n${result.stderr}`;
      }

      // 判断测试结果
      const isSuccess = result.exitCode === 0;
      const status = isSuccess ? "PASS" : "FAIL";

      // 提取失败原因（如果存在）
      let reason = "";
      if (!isSuccess) {
        // 尝试从输出中提取错误信息
        const errorMatch = formattedOutput.match(
          /(Error|Failed|Revert|ReentrancyGuard|AssertionError|Unable to resolve)[^\n]*/
        );
        if (errorMatch) {
          reason = errorMatch[0];
        } else {
          reason = "Test execution failed";
        }
      }

      // 获取执行日志
      const logs = dockerManager.getFormattedLogs();

      // 构建返回文本，包含日志和测试结果
      const resultText = reason
        ? `${status}. Reason: ${reason}${logs}\n\n${formattedOutput}`
        : `${status}${logs}\n\n${formattedOutput}`;

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
