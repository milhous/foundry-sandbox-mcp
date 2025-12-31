/**
 * Forge 工具实现
 *
 * 提供 forge test 命令的执行
 * 每次测试时创建新容器，测试完成后删除，确保全新环境
 * 
 * 依赖管理：
 * - 容器创建后，根据依赖清单文件自动使用 forge install 安装所有依赖
 * - forge install 会自动处理已存在的依赖（跳过或更新），无需手动检查
 * - 依赖清单文件格式为 JSON 数组，例如：["foundry-rs/forge-std", "OpenZeppelin/openzeppelin-contracts"]
 */

import { DockerManager } from "../docker-manager.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

/**
 * Forge 测试参数验证 Schema
 */
const ForgeTestArgsSchema = z.object({
  projectRoot: z
    .string()
    .describe("项目根路径（绝对路径），用于 Docker 挂载"),
  testFolderPath: z
    .string()
    .describe("测试合约文件夹路径（相对项目根路径），例如 'test' 或 'test/unit'"),
  dependenciesManifestPath: z
    .string()
    .describe("依赖项清单文件路径（相对项目根路径），JSON 数组格式，例如 'dependencies.json'"),
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
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
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
    const levelPrefix = level === "error" ? "❌" : level === "warning" ? "⚠️" : "ℹ️";
    const stderrMessage = `${logPrefix} ${levelPrefix} ${message}\n`;
    process.stderr.write(stderrMessage, () => {
      // 强制刷新，确保实时显示
      process.stderr.write('', () => {});
    });
  }

  /**
   * 读取依赖清单文件
   */
  private readDependenciesManifest(projectRoot: string, manifestPath: string): string[] {
    const fullPath = resolve(projectRoot, manifestPath);
    
    if (!existsSync(fullPath)) {
      throw new Error(`Dependencies manifest file not found: ${fullPath}`);
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const dependencies = JSON.parse(content) as unknown;
      
      if (!Array.isArray(dependencies)) {
        throw new Error("Dependencies manifest must be a JSON array");
      }

      if (!dependencies.every((dep) => typeof dep === "string")) {
        throw new Error("All dependencies in manifest must be strings");
      }

      return dependencies as string[];
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in dependencies manifest: ${error.message}`);
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
    this.sendLoggingMessage("info", startMessage, { action: "tool_start", timestamp: new Date().toISOString() });
    console.error("═══════════════════════════════════════════════════════");
    console.error(startMessage);
    console.error("═══════════════════════════════════════════════════════");

    // 验证参数
    const validatedArgs = ForgeTestArgsSchema.parse(args);
    this.sendLoggingMessage("info", "✅ 参数验证通过", { action: "validate_args" });

    // 验证项目根路径
    const projectRoot = resolve(validatedArgs.projectRoot);
    if (!existsSync(projectRoot)) {
      const errorMsg = `❌ 项目根目录不存在: ${projectRoot}`;
      this.sendLoggingMessage("error", errorMsg, { action: "validate_project_root", projectRoot });
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: Project root directory not found: ${projectRoot}`,
          },
        ],
      };
    }
    this.sendLoggingMessage("info", `📁 项目根目录: ${projectRoot}`, { action: "project_root_validated", projectRoot });

    // 读取依赖清单
    let dependencies: string[];
    try {
      dependencies = this.readDependenciesManifest(projectRoot, validatedArgs.dependenciesManifestPath);
      this.sendLoggingMessage("info", `📦 读取到 ${dependencies.length} 个依赖项`, { 
        action: "read_dependencies", 
        dependencyCount: dependencies.length 
      });
    } catch (error) {
      const errorMsg = `❌ 读取依赖清单失败: ${error instanceof Error ? error.message : String(error)}`;
      this.sendLoggingMessage("error", errorMsg, { action: "read_dependencies_failed", error: error instanceof Error ? error.message : String(error) });
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }

    // 验证测试文件夹路径
    const testFolderFullPath = join(projectRoot, validatedArgs.testFolderPath);
    if (!existsSync(testFolderFullPath)) {
      const errorMsg = `❌ 测试文件夹不存在: ${testFolderFullPath}`;
      this.sendLoggingMessage("error", errorMsg, { action: "validate_test_folder", testFolderPath: testFolderFullPath });
      return {
        content: [
          {
            type: "text",
            text: `FAIL. Error: Test folder not found: ${testFolderFullPath}`,
          },
        ],
      };
    }
    this.sendLoggingMessage("info", `📝 测试路径: ${validatedArgs.testFolderPath}`, { 
      action: "test_folder_validated", 
      testFolderPath: validatedArgs.testFolderPath 
    });

    // 为每次测试创建新的 DockerManager（会创建新容器）
    const dockerManager = new DockerManager(projectRoot);

    // 收集所有进度日志，以便在最终响应中返回
    const progressLogs: string[] = [];

    try {
      // 步骤 1: 创建并启动容器
      const step1Start = "🚀 步骤 1/4: 正在创建 Docker 容器...";
      progressLogs.push(step1Start);
      this.sendLoggingMessage("info", step1Start, { step: 1, total: 4, action: "create_container" });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step1Start);
      console.error("═══════════════════════════════════════════════════════");
      await dockerManager.createAndStartContainer();
      const step1Complete = "✅ 步骤 1/4: Docker 容器创建成功";
      progressLogs.push(step1Complete);
      this.sendLoggingMessage("info", step1Complete, { step: 1, total: 4, completed: true });
      console.error(step1Complete);
      console.error("");

      // 步骤 2: 安装依赖
      const step2Start = `📦 步骤 2/4: 正在使用 forge install 安装 ${dependencies.length} 个依赖项...`;
      progressLogs.push(step2Start);
      this.sendLoggingMessage("info", step2Start, { step: 2, total: 4, action: "install_dependencies", dependencyCount: dependencies.length });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step2Start);
      console.error("═══════════════════════════════════════════════════════");
      await dockerManager.installDependenciesFromManifest(dependencies);
      const step2Complete = "✅ 步骤 2/4: 依赖处理完成";
      progressLogs.push(step2Complete);
      this.sendLoggingMessage("info", step2Complete, { step: 2, total: 4, completed: true });
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
      this.sendLoggingMessage("info", step3Start, { step: 3, total: 4, action: "run_tests", matchPattern });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step3Start);
      console.error("═══════════════════════════════════════════════════════");
      console.error("📋 测试输出:");
      console.error("───────────────────────────────────────────────────────");
      let result = await dockerManager.execCommand("forge", cmdArgs);
      console.error("───────────────────────────────────────────────────────");
      const step3Complete = "✅ 步骤 3/4: 测试执行完成";
      progressLogs.push(step3Complete);
      this.sendLoggingMessage("info", step3Complete, { step: 3, total: 4, completed: true, exitCode: result.exitCode });
      console.error(step3Complete);
      console.error("");

      // 步骤 4: 清理容器
      const step4Start = "🧹 步骤 4/4: 正在清理 Docker 容器...";
      progressLogs.push(step4Start);
      this.sendLoggingMessage("info", step4Start, { step: 4, total: 4, action: "cleanup" });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step4Start);
      console.error("═══════════════════════════════════════════════════════");
      
      // 清理容器
      await dockerManager.removeContainer();
      const step4Complete = "✅ 步骤 4/4: Docker 容器清理完成";
      progressLogs.push(step4Complete);
      this.sendLoggingMessage("info", step4Complete, { step: 4, total: 4, completed: true });
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
      const progressSummary = progressLogs.length > 0
        ? "\n\n📋 执行进度:\n" + progressLogs.map((log, idx) => `  ${idx + 1}. ${log}`).join("\n")
        : "";

      // 构建返回文本，确保日志在响应中清晰显示
      // 将日志放在最前面，让 Agent 更容易看到执行过程
      const resultText = `═══════════════════════════════════════════════════════
📊 执行日志和进度信息
═══════════════════════════════════════════════════════${progressSummary}${logs}

═══════════════════════════════════════════════════════
${status === "PASS" ? "✅" : "❌"} 测试结果: ${status}${reason ? `\n原因: ${reason}` : ""}
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
        timestamp: new Date().toISOString()
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
      const errorMsg = `❌ 工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
      this.sendLoggingMessage("error", errorMsg, { 
        action: "tool_error", 
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      console.error("═══════════════════════════════════════════════════════");
      console.error(errorMsg);
      console.error("═══════════════════════════════════════════════════════");

      // 即使出错，也尝试清理容器
      try {
        await dockerManager.removeContainer();
        this.sendLoggingMessage("info", "🧹 已清理 Docker 容器", { action: "cleanup_after_error" });
      } catch (cleanupError) {
        // 忽略清理错误
        const cleanupErrorMsg = `Warning: Failed to cleanup container after error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
        this.sendLoggingMessage("warning", cleanupErrorMsg, { action: "cleanup_failed" });
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
