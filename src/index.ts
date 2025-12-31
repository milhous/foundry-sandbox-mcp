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
          logging: {}, // 声明支持日志通知功能
        },
      }
    );

    // ForgeTool 不再需要预初始化 DockerManager，会在调用时动态创建
    // 传递 server 实例以便发送日志通知
    this.forgeTool = new ForgeTool(this.server);

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
              "在 Docker 容器中运行 forge test 命令。每次测试时创建新容器，测试完成后自动清理，确保全新环境。运行测试前会根据依赖清单文件自动安装依赖。",
            inputSchema: {
              type: "object",
              properties: {
                projectRoot: {
                  type: "string",
                  description:
                    "项目根路径（绝对路径），用于 Docker 挂载。例如 '/path/to/project'",
                },
                testFolderPath: {
                  type: "string",
                  description:
                    "测试合约文件夹路径（相对项目根路径）。例如 'test' 或 'test/unit'。如果路径以 .sol 结尾，则直接使用该路径；否则会自动匹配该文件夹下的所有 .t.sol 文件。",
                },
                dependenciesManifestPath: {
                  type: "string",
                  description:
                    "依赖项清单文件路径（相对项目根路径）。文件格式为 JSON 数组，例如 'dependencies.json'。内容示例：[\"foundry-rs/forge-std\", \"OpenZeppelin/openzeppelin-contracts\"]",
                },
                extraArgs: {
                  type: "array",
                  items: { type: "string" },
                  description: "额外的 forge test 参数",
                },
              },
              required: ["projectRoot", "testFolderPath", "dependenciesManifestPath"],
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
