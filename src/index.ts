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
              "在 Docker 容器中运行 forge test 命令。每次测试时创建新容器，测试完成后自动清理，确保全新环境。支持匹配特定测试路径。需要传入 foundry.toml 文件的绝对路径。MCP 会自动检查并创建 libs 目录，当 forge 需要安装依赖时，会安装到 foundry.toml 中配置的 libs 路径中。",
            inputSchema: {
              type: "object",
              properties: {
                foundryTomlPath: {
                  type: "string",
                  description:
                    "foundry.toml 文件的绝对路径。MCP 会根据此文件解析配置信息（src、out、cache_path、libs 等），并使用 foundry.toml 所在目录作为项目根目录。",
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
              required: ["foundryTomlPath"],
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
