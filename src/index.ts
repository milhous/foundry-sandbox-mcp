#!/usr/bin/env node

/**
 * Foundry Sandbox MCP Server
 *
 * 提供在 Docker 容器中运行 Foundry 命令的 MCP 工具
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ForgeTool } from "./tools/forge-tool.js";

/**
 * MCP Server 主类
 */
class FoundrySandboxServer {
  private server: Server;
  private forgeTool: ForgeTool;

  constructor() {
    this.server = new Server(
      {
        name: "foundry-sandbox",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // ForgeTool 不再需要预初始化 DockerManager，会在调用时动态创建
    this.forgeTool = new ForgeTool();

    this.setupHandlers();
    this.setupErrorHandling();
  }

  /**
   * 设置请求处理器
   */
  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "forge_test",
            description:
              "在 Docker 容器中运行 forge test 命令。支持匹配特定测试路径。",
            inputSchema: {
              type: "object",
              properties: {
                projectPath: {
                  type: "string",
                  description:
                    "Foundry 项目根路径（包含 foundry.toml 的目录），必须是绝对路径",
                },
                testPath: {
                  type: "string",
                  description:
                    "可选的测试路径匹配模式，例如 'test/MyTest.t.sol' 或 'test/**/*.t.sol'",
                },
                matchPath: {
                  type: "string",
                  description:
                    "使用 --match-path 参数匹配测试文件路径（与 testPath 互斥）",
                },
                extraArgs: {
                  type: "array",
                  items: { type: "string" },
                  description: "额外的 forge test 参数",
                },
              },
              required: ["projectPath"],
            },
          },
          {
            name: "forge_build",
            description: "在 Docker 容器中运行 forge build 命令",
            inputSchema: {
              type: "object",
              properties: {
                projectPath: {
                  type: "string",
                  description:
                    "Foundry 项目根路径（包含 foundry.toml 的目录），必须是绝对路径",
                },
                extraArgs: {
                  type: "array",
                  items: { type: "string" },
                  description: "额外的 forge build 参数",
                },
              },
              required: ["projectPath"],
            },
          },
          {
            name: "forge_clean",
            description: "在 Docker 容器中运行 forge clean 命令，清理构建缓存",
            inputSchema: {
              type: "object",
              properties: {
                projectPath: {
                  type: "string",
                  description:
                    "Foundry 项目根路径（包含 foundry.toml 的目录），必须是绝对路径",
                },
              },
              required: ["projectPath"],
            },
          },
        ],
      };
    });

    // 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "forge_test":
            return await this.forgeTool.runTest(args);
          case "forge_build":
            return await this.forgeTool.runBuild(args);
          case "forge_clean":
            return await this.forgeTool.runClean(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    // 可以在这里添加清理逻辑，例如停止容器等
    // 但通常我们保持容器运行以便下次使用
  }

  /**
   * 启动服务器
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error("Foundry Sandbox MCP Server started");
    console.error(
      "Note: Project path should be provided in tool calls via 'projectPath' parameter"
    );
  }
}

// 启动服务器
const server = new FoundrySandboxServer();
server.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
