#!/usr/bin/env node

/**
 * Foundry MCP Server
 * 通过 MCP 协议运行 Foundry 沙盒环境
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { DockerManager } from "./docker-manager.js";
import { ForgeExecutor } from "./forge-executor.js";
import { z } from "zod";

// 初始化 Docker 管理器和 Forge 执行器
const dockerManager = new DockerManager();
const forgeExecutor = new ForgeExecutor(dockerManager);

// 创建 MCP Server
const server = new Server(
  {
    name: "foundry-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 工具定义
const tools = [
  {
    name: "forge_execute",
    description:
      "执行 forge 命令。支持所有 forge 子命令，如 build, test, script, install 等。",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "forge 子命令，如 'build', 'test', 'script', 'install', 'update' 等",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "命令参数列表",
        },
        workingDir: {
          type: "string",
          description: "工作目录（容器内路径，默认为 /app）",
        },
        containerName: {
          type: "string",
          description: "容器名称（可选，默认为 foundry-mcp-sandbox）",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "forge_build",
    description: "构建 Foundry 项目（forge build）",
    inputSchema: {
      type: "object",
      properties: {
        workingDir: {
          type: "string",
          description: "工作目录（容器内路径，默认为 /app）",
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "额外的构建参数",
        },
      },
    },
  },
  {
    name: "forge_test",
    description: "运行 Foundry 测试（forge test）",
    inputSchema: {
      type: "object",
      properties: {
        testPattern: {
          type: "string",
          description: "测试模式（可选，用于过滤测试）",
        },
        workingDir: {
          type: "string",
          description: "工作目录（容器内路径，默认为 /app）",
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "额外的测试参数",
        },
      },
    },
  },
  {
    name: "forge_script",
    description: "运行 Foundry 脚本（forge script）",
    inputSchema: {
      type: "object",
      properties: {
        scriptPath: {
          type: "string",
          description: "脚本路径（相对于工作目录）",
        },
        functionName: {
          type: "string",
          description: "要执行的函数名（可选）",
        },
        rpcUrl: {
          type: "string",
          description: "RPC URL（可选，用于部署）",
        },
        workingDir: {
          type: "string",
          description: "工作目录（容器内路径，默认为 /app）",
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "额外的脚本参数",
        },
      },
      required: ["scriptPath"],
    },
  },
  {
    name: "docker_execute",
    description: "在容器内执行任意命令（非 forge 命令）",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的命令",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "命令参数列表",
        },
        workingDir: {
          type: "string",
          description: "工作目录（容器内路径，默认为 /app）",
        },
        containerName: {
          type: "string",
          description: "容器名称（可选，默认为 foundry-mcp-sandbox）",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "docker_list_containers",
    description: "列出所有 Foundry MCP 管理的容器",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "docker_check",
    description: "检查 Docker 是否可用",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// 注册工具列表处理器
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "forge_execute": {
        const schema = z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          workingDir: z.string().optional(),
          containerName: z.string().optional(),
        });
        const params = schema.parse(args);

        const result = await forgeExecutor.execute(
          {
            command: params.command,
            args: params.args,
            workingDir: params.workingDir,
          },
          params.containerName
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  command: result.command,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "forge_build": {
        const schema = z.object({
          workingDir: z.string().optional(),
          extraArgs: z.array(z.string()).optional(),
        });
        const params = schema.parse(args);

        const result = await forgeExecutor.execute({
          command: "build",
          args: params.extraArgs,
          workingDir: params.workingDir,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  command: result.command,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "forge_test": {
        const schema = z.object({
          testPattern: z.string().optional(),
          workingDir: z.string().optional(),
          extraArgs: z.array(z.string()).optional(),
        });
        const params = schema.parse(args);

        const testArgs = params.extraArgs || [];
        if (params.testPattern) {
          testArgs.push("--match-path", params.testPattern);
        }

        const result = await forgeExecutor.execute({
          command: "test",
          args: testArgs,
          workingDir: params.workingDir,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  command: result.command,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "forge_script": {
        const schema = z.object({
          scriptPath: z.string(),
          functionName: z.string().optional(),
          rpcUrl: z.string().optional(),
          workingDir: z.string().optional(),
          extraArgs: z.array(z.string()).optional(),
        });
        const params = schema.parse(args);

        const scriptArgs = [params.scriptPath];
        if (params.functionName) {
          scriptArgs.push(params.functionName);
        }
        if (params.rpcUrl) {
          scriptArgs.push("--rpc-url", params.rpcUrl);
        }
        if (params.extraArgs) {
          scriptArgs.push(...params.extraArgs);
        }

        const result = await forgeExecutor.execute({
          command: "script",
          args: scriptArgs,
          workingDir: params.workingDir,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  command: result.command,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "docker_execute": {
        const schema = z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          workingDir: z.string().optional(),
          containerName: z.string().optional(),
        });
        const params = schema.parse(args);

        const result = await forgeExecutor.executeCustom(
          params.command,
          params.args,
          params.workingDir,
          params.containerName
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  command: result.command,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "docker_list_containers": {
        const containers = await dockerManager.listContainers();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(containers, null, 2),
            },
          ],
        };
      }

      case "docker_check": {
        const available = await dockerManager.checkDockerAvailable();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  available,
                  message: available
                    ? "Docker is available"
                    : "Docker is not available. Please ensure Docker is running.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

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

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${errorMessage}`
    );
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Foundry MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

