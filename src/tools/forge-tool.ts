/**
 * Forge 工具实现
 *
 * 提供 forge test 命令的执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
 *
 * 依赖管理：
 * - 容器创建后，根据依赖清单文件自动安装依赖
 *   - forge 依赖：使用 forge install --no-git 安装，避免需要 .gitmodules 文件和 git 仓库初始化
 *   - npm 依赖：使用 npm install 安装指定的 npm 包
 *   - yarn 依赖：使用 yarn add 安装指定的 yarn 包
 *   - forge install 会自动处理已存在的依赖（跳过或更新），无需手动检查
 * - 依赖清单文件格式支持两种格式：
 *   1. 数组格式（不带版本号）：["package-name"] - 使用最新版本
 *   2. 对象格式（带版本号）：{"package-name": "version"} - 指定版本
 * - 示例：
 *   {
 *     "forge": ["foundry-rs/forge-std"],  // 数组格式
 *     "npm": {"@openzeppelin/contracts": "^5.0.2"},  // 对象格式
 *     "yarn": ["@chainlink/contracts"]  // 数组格式
 *   }
 */

import { DockerManager } from "../docker-manager.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

/**
 * 依赖清单文件格式
 * 支持两种格式：
 * 1. 数组格式（不带版本号）：["package-name"]
 * 2. 对象格式（带版本号）：{"package-name": "version"}
 *
 * 示例：
 * {
 *   "forge": ["foundry-rs/forge-std"],  // 数组格式
 *   "npm": {                             // 对象格式
 *     "@openzeppelin/contracts": "^5.0.2"
 *   },
 *   "yarn": ["@chainlink/contracts"]    // 数组格式
 * }
 *
 * 注意：
 * - forge: 使用 forge install --no-git 安装 Git 依赖
 *   - 数组格式：["foundry-rs/forge-std"]（使用最新版本）
 *   - 对象格式：{"foundry-rs/forge-std": "v1.0.0"}（指定版本或 tag）
 * - npm: 使用 npm install 安装 npm 包
 *   - 数组格式：["@openzeppelin/contracts"]（使用最新版本）
 *   - 对象格式：{"@openzeppelin/contracts": "^5.0.2"}（指定版本）
 * - yarn: 使用 yarn add 安装 yarn 包
 *   - 数组格式：["@chainlink/contracts"]（使用最新版本）
 *   - 对象格式：{"@chainlink/contracts": "^1.0.0"}（指定版本）
 * - 所有字段都是可选的，但至少需要提供一个字段
 * - 每个字段可以独立选择使用数组或对象格式
 */
interface DependenciesManifest {
  forge?: string[] | Record<string, string>;
  npm?: string[] | Record<string, string>;
  yarn?: string[] | Record<string, string>;
}

/**
 * Forge 测试参数验证 Schema
 */
const ForgeTestArgsSchema = z.object({
  projectRoot: z.string().describe("项目根路径（绝对路径），用于 Docker 挂载"),
  testFolderPath: z
    .string()
    .describe(
      "测试合约文件夹路径（相对项目根路径），例如 'test' 或 'test/unit'"
    ),
  dependenciesManifestPath: z
    .string()
    .describe(
      "依赖项清单文件路径（相对项目根路径），JSON 对象格式，例如 'dependencies.json'"
    ),
  extraArgs: z.array(z.string()).optional().describe("额外的 forge test 参数"),
});

/**
 * Forge 工具类
 */
export class ForgeTool {
  private server: Server | null = null;

  constructor(server?: Server) {
    this.server = server || null;
  }

  /**
   * 发送日志通知（MCP 协议标准方式）
   * 如果服务器不支持或发送失败，会回退到 stderr 输出
   *
   * 同时使用 MCP 日志通知和 stderr 输出，确保在 Cursor 中能看到日志
   */
  private sendLoggingMessage(
    level: LoggingMessageNotification["params"]["level"],
    message: string,
    data?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const logPrefix = `[${timestamp}] [MCP Log]`;

    // 优先使用 MCP 日志通知（异步，不阻塞）
    if (this.server) {
      this.server
        .sendLoggingMessage({
          level,
          logger: "forge-test",
          data: {
            message,
            timestamp: new Date().toISOString(),
            ...data,
          },
        })
        .catch((error) => {
          // 如果发送失败，记录错误但不中断执行
          console.error(`[MCP] Failed to send logging message: ${error}`);
        });
    }

    // 同时输出到 stderr（确保在 Cursor 中能看到，即使 MCP 日志通知失败）
    // 根据日志级别使用不同的前缀
    const levelPrefix =
      level === "error" ? "❌" : level === "warning" ? "⚠️" : "ℹ️";
    const stderrMessage = `${logPrefix} ${levelPrefix} ${message}\n`;
    process.stderr.write(stderrMessage, () => {
      // 强制刷新，确保实时显示
      process.stderr.write("", () => {});
    });
  }

  /**
   * 将依赖格式转换为统一格式（数组）
   * 支持数组格式和对象格式
   *
   * @param deps - 依赖项，可以是数组或对象
   * @param fieldName - 字段名称（用于错误提示）
   * @returns 统一格式的依赖数组
   */
  private normalizeDependencies(
    deps: string[] | Record<string, string> | undefined,
    fieldName: string
  ): string[] {
    if (!deps) {
      return [];
    }

    // 数组格式：直接返回
    if (Array.isArray(deps)) {
      if (!deps.every((dep) => typeof dep === "string")) {
        throw new Error(`'${fieldName}' field must be an array of strings`);
      }
      return deps;
    }

    // 对象格式：转换为 package@version 格式
    if (typeof deps === "object" && deps !== null) {
      const result: string[] = [];
      for (const [packageName, version] of Object.entries(deps)) {
        if (typeof packageName !== "string" || typeof version !== "string") {
          throw new Error(
            `'${fieldName}' field must be an object with string keys and string values`
          );
        }
        // 将对象格式转换为 package@version 格式
        result.push(`${packageName}@${version}`);
      }
      return result;
    }

    throw new Error(
      `'${fieldName}' field must be an array of strings or an object with string values`
    );
  }

  /**
   * 读取依赖清单文件
   * 支持数组格式（不带版本号）和对象格式（带版本号）
   */
  private readDependenciesManifest(
    projectRoot: string,
    manifestPath: string
  ): { forge: string[]; npm: string[]; yarn: string[] } {
    const fullPath = resolve(projectRoot, manifestPath);

    if (!existsSync(fullPath)) {
      throw new Error(`Dependencies manifest file not found: ${fullPath}`);
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;

      // 仅支持对象格式（顶层必须是对象）
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          "Dependencies manifest must be a JSON object with 'forge', 'npm', and/or 'yarn' fields. " +
            'Example: { "forge": ["foundry-rs/forge-std"], "npm": {"@openzeppelin/contracts": "^5.0.2"} }'
        );
      }

      const manifest = parsed as DependenciesManifest;

      // 将依赖转换为统一格式
      const forge = this.normalizeDependencies(manifest.forge, "forge");
      const npm = this.normalizeDependencies(manifest.npm, "npm");
      const yarn = this.normalizeDependencies(manifest.yarn, "yarn");

      // 至少需要提供一个字段
      if (forge.length === 0 && npm.length === 0 && yarn.length === 0) {
        throw new Error(
          "Dependencies manifest must contain at least one 'forge', 'npm', or 'yarn' field with dependencies"
        );
      }

      return { forge, npm, yarn };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Invalid JSON in dependencies manifest: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * 运行 forge test 命令
   * 每次测试时创建新容器，测试完成后删除，确保全新环境
   */
  async runTest(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    // 立即发送开始日志，确保 Cursor 能看到工具已开始执行
    const startMessage = "🔧 开始执行 forge test 工具...";
    this.sendLoggingMessage("info", startMessage, {
      action: "tool_start",
      timestamp: new Date().toISOString(),
    });
    console.error("═══════════════════════════════════════════════════════");
    console.error(startMessage);
    console.error("═══════════════════════════════════════════════════════");

    // 验证参数
    const validatedArgs = ForgeTestArgsSchema.parse(args);
    this.sendLoggingMessage("info", "✅ 参数验证通过", {
      action: "validate_args",
    });

    // 验证项目根路径
    const projectRoot = resolve(validatedArgs.projectRoot);
    if (!existsSync(projectRoot)) {
      const errorMsg = `❌ 项目根目录不存在: ${projectRoot}`;
      this.sendLoggingMessage("error", errorMsg, {
        action: "validate_project_root",
        projectRoot,
      });
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: Project root directory not found: ${projectRoot}`,
          },
        ],
      };
    }
    this.sendLoggingMessage("info", `📁 项目根目录: ${projectRoot}`, {
      action: "project_root_validated",
      projectRoot,
    });

    // 读取依赖清单
    let dependencies: { forge: string[]; npm: string[]; yarn: string[] };
    try {
      dependencies = this.readDependenciesManifest(
        projectRoot,
        validatedArgs.dependenciesManifestPath
      );
      const totalCount =
        dependencies.forge.length +
        dependencies.npm.length +
        dependencies.yarn.length;
      this.sendLoggingMessage(
        "info",
        `📦 读取到 ${dependencies.forge.length} 个 forge 依赖，${dependencies.npm.length} 个 npm 依赖，${dependencies.yarn.length} 个 yarn 依赖（共 ${totalCount} 个）`,
        {
          action: "read_dependencies",
          forgeCount: dependencies.forge.length,
          npmCount: dependencies.npm.length,
          yarnCount: dependencies.yarn.length,
          totalCount,
        }
      );
    } catch (error) {
      const errorMsg = `❌ 读取依赖清单失败: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.sendLoggingMessage("error", errorMsg, {
        action: "read_dependencies_failed",
        error: error instanceof Error ? error.message : String(error),
      });
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

    // 验证测试文件夹路径
    const testFolderFullPath = join(projectRoot, validatedArgs.testFolderPath);
    if (!existsSync(testFolderFullPath)) {
      const errorMsg = `❌ 测试文件夹不存在: ${testFolderFullPath}`;
      this.sendLoggingMessage("error", errorMsg, {
        action: "validate_test_folder",
        testFolderPath: testFolderFullPath,
      });
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: Test folder not found: ${testFolderFullPath}`,
          },
        ],
      };
    }
    this.sendLoggingMessage(
      "info",
      `📝 测试路径: ${validatedArgs.testFolderPath}`,
      {
        action: "test_folder_validated",
        testFolderPath: validatedArgs.testFolderPath,
      }
    );

    // 为每次测试创建新的 DockerManager（会创建新容器）
    const dockerManager = new DockerManager(projectRoot);

    // 收集所有进度日志，以便在最终响应中返回
    const progressLogs: string[] = [];

    try {
      // 步骤 1: 创建并启动容器
      const step1Start = "🚀 步骤 1/4: 正在创建 Docker 容器...";
      progressLogs.push(step1Start);
      this.sendLoggingMessage("info", step1Start, {
        step: 1,
        total: 4,
        action: "create_container",
      });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step1Start);
      console.error("═══════════════════════════════════════════════════════");
      await dockerManager.createAndStartContainer();
      const step1Complete = "✅ 步骤 1/4: Docker 容器创建成功";
      progressLogs.push(step1Complete);
      this.sendLoggingMessage("info", step1Complete, {
        step: 1,
        total: 4,
        completed: true,
      });
      console.error(step1Complete);
      console.error("");

      // 步骤 2: 安装依赖（forge + npm + yarn）
      const totalDeps =
        dependencies.forge.length +
        dependencies.npm.length +
        dependencies.yarn.length;
      const step2Start = `📦 步骤 2/4: 正在安装依赖（${dependencies.forge.length} 个 forge 依赖，${dependencies.npm.length} 个 npm 依赖，${dependencies.yarn.length} 个 yarn 依赖，共 ${totalDeps} 个）...`;
      progressLogs.push(step2Start);
      this.sendLoggingMessage("info", step2Start, {
        step: 2,
        total: 4,
        action: "install_dependencies",
        forgeCount: dependencies.forge.length,
        npmCount: dependencies.npm.length,
        yarnCount: dependencies.yarn.length,
        totalCount: totalDeps,
      });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step2Start);
      console.error("═══════════════════════════════════════════════════════");
      await dockerManager.installDependenciesFromManifest(
        dependencies.forge,
        dependencies.npm,
        dependencies.yarn
      );
      const step2Complete = "✅ 步骤 2/4: 依赖处理完成";
      progressLogs.push(step2Complete);
      this.sendLoggingMessage("info", step2Complete, {
        step: 2,
        total: 4,
        completed: true,
      });
      console.error(step2Complete);
      console.error("");

      // 步骤 3: 构建测试命令
      const cmdArgs: string[] = ["test"];

      // 使用 --match-path 指定测试文件夹
      // 支持通配符匹配，例如 "test/**/*.t.sol" 或 "test/*.t.sol"
      const matchPattern = validatedArgs.testFolderPath.endsWith(".sol")
        ? validatedArgs.testFolderPath
        : `${validatedArgs.testFolderPath}/**/*.t.sol`;
      cmdArgs.push("--match-path", matchPattern);

      // 添加额外参数
      if (validatedArgs.extraArgs) {
        cmdArgs.push(...validatedArgs.extraArgs);
      }

      // 步骤 3: 执行测试命令
      const step3Start = `🧪 步骤 3/4: 正在执行测试 (匹配路径: ${matchPattern})...`;
      progressLogs.push(step3Start);
      this.sendLoggingMessage("info", step3Start, {
        step: 3,
        total: 4,
        action: "run_tests",
        matchPattern,
      });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step3Start);
      console.error("═══════════════════════════════════════════════════════");
      console.error("📋 测试输出:");
      console.error("───────────────────────────────────────────────────────");
      let result = await dockerManager.execCommand("forge", cmdArgs);
      console.error("───────────────────────────────────────────────────────");
      const step3Complete = "✅ 步骤 3/4: 测试执行完成";
      progressLogs.push(step3Complete);
      this.sendLoggingMessage("info", step3Complete, {
        step: 3,
        total: 4,
        completed: true,
        exitCode: result.exitCode,
      });
      console.error(step3Complete);
      console.error("");

      // 步骤 4: 清理容器和 Docker 缓存
      const step4Start = "🧹 步骤 4/4: 正在清理 Docker 容器和系统缓存...";
      progressLogs.push(step4Start);
      this.sendLoggingMessage("info", step4Start, {
        step: 4,
        total: 4,
        action: "cleanup",
      });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step4Start);
      console.error("═══════════════════════════════════════════════════════");

      // 清理容器
      await dockerManager.removeContainer();
      this.sendLoggingMessage("info", "✓ Docker 容器已清理", {
        action: "container_removed",
      });
      console.error("✓ Docker 容器已清理");

      // 清理 Docker system 缓存
      await dockerManager.cleanupDockerSystemCache();

      const step4Complete = "✅ 步骤 4/4: Docker 容器和系统缓存清理完成";
      progressLogs.push(step4Complete);
      this.sendLoggingMessage("info", step4Complete, {
        step: 4,
        total: 4,
        completed: true,
      });
      console.error(step4Complete);
      console.error("");

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

      // 构建进度摘要
      const progressSummary =
        progressLogs.length > 0
          ? "\n\n📋 执行进度:\n" +
            progressLogs.map((log, idx) => `  ${idx + 1}. ${log}`).join("\n")
          : "";

      // 构建返回文本，确保日志在响应中清晰显示
      // 将日志放在最前面，让 Agent 更容易看到执行过程
      const resultText = `═══════════════════════════════════════════════════════
📊 执行日志和进度信息
═══════════════════════════════════════════════════════${progressSummary}${logs}

═══════════════════════════════════════════════════════
${status === "PASS" ? "✅" : "❌"} 测试结果: ${status}${
        reason ? `\n原因: ${reason}` : ""
      }
═══════════════════════════════════════════════════════

📋 测试输出:
───────────────────────────────────────────────────────
${formattedOutput}
───────────────────────────────────────────────────────`;

      // 发送完成日志
      const completeMessage = `🎉 工具执行完成: ${status}`;
      this.sendLoggingMessage("info", completeMessage, {
        action: "tool_complete",
        status,
        exitCode: result.exitCode,
        timestamp: new Date().toISOString(),
      });
      console.error(completeMessage);

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      // 发送错误日志
      const errorMsg = `❌ 工具执行失败: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.sendLoggingMessage("error", errorMsg, {
        action: "tool_error",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      console.error("═══════════════════════════════════════════════════════");
      console.error(errorMsg);
      console.error("═══════════════════════════════════════════════════════");

      // 即使出错，也尝试清理容器
      try {
        await dockerManager.removeContainer();
        this.sendLoggingMessage("info", "🧹 已清理 Docker 容器", {
          action: "cleanup_after_error",
        });
      } catch (cleanupError) {
        // 忽略清理错误
        const cleanupErrorMsg = `Warning: Failed to cleanup container after error: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`;
        this.sendLoggingMessage("warning", cleanupErrorMsg, {
          action: "cleanup_failed",
        });
        console.error(cleanupErrorMsg);
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
