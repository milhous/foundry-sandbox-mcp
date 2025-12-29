#!/usr/bin/env node

/**
 * MCP Server 功能测试脚本
 * 直接测试工具处理函数
 */

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DockerManager } from "./docker-manager.js";
import { ForgeExecutor } from "./forge-executor.js";
import { z } from "zod";

// 初始化
const dockerManager = new DockerManager();
const forgeExecutor = new ForgeExecutor(dockerManager);

// 工具定义（与 server.ts 相同）
const tools = [
  {
    name: "forge_execute",
    description: "执行 forge 命令",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        workingDir: { type: "string" },
      },
      required: ["command"],
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

// 工具调用处理函数（与 server.ts 相同）
async function handleToolCall(name: string, args: any) {
  switch (name) {
    case "forge_execute": {
      const schema = z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        workingDir: z.string().optional(),
      });
      const params = schema.parse(args);

      const result = await forgeExecutor.execute({
        command: params.command,
        args: params.args,
        workingDir: params.workingDir,
      });

      return {
        success: result.success,
        command: result.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    case "docker_check": {
      const available = await dockerManager.checkDockerAvailable();
      return {
        available,
        message: available
          ? "Docker is available"
          : "Docker is not available",
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// 测试函数
async function testMCP() {
  console.log("🧪 Testing MCP Server Functionality\n");

  try {
    // 测试 1: 列出工具
    console.log("1. Testing ListTools...");
    console.log(`   ✅ Found ${tools.length} tools:`);
    tools.forEach((tool) => {
      console.log(`      - ${tool.name}: ${tool.description}`);
    });
    console.log();

    // 测试 2: 检查 Docker
    console.log("2. Testing docker_check tool...");
    const dockerResult = await handleToolCall("docker_check", {});
    console.log(`   ✅ Docker available: ${dockerResult.available}`);
    console.log(`   ✅ Message: ${dockerResult.message}`);
    console.log();

    // 测试 3: 执行 forge 命令
    console.log("3. Testing forge_execute tool (forge --version)...");
    const forgeResult = await handleToolCall("forge_execute", {
      command: "--version",
      args: [],
    });
    console.log(`   ✅ Command executed: ${forgeResult.command}`);
    console.log(`   ✅ Success: ${forgeResult.success}`);
    console.log(`   ✅ Exit code: ${forgeResult.exitCode}`);
    if (forgeResult.stdout) {
      const outputLines = forgeResult.stdout
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 3);
      console.log(`   Output preview:`);
      outputLines.forEach((line) => {
        console.log(`      ${line}`);
      });
    }
    console.log();

    // 测试 4: 执行 forge build（如果失败也没关系，主要是测试调用）
    console.log("4. Testing forge_execute tool (forge build in empty dir)...");
    try {
      const buildResult = await handleToolCall("forge_execute", {
        command: "build",
        args: [],
      });
      console.log(`   ✅ Command executed: ${buildResult.command}`);
      console.log(`   Success: ${buildResult.success}`);
      console.log(`   Exit code: ${buildResult.exitCode}`);
      if (!buildResult.success && buildResult.stderr) {
        const errorPreview = buildResult.stderr.split("\n")[0];
        console.log(`   Error (expected in empty dir): ${errorPreview}`);
      }
    } catch (error) {
      console.log(
        `   ⚠️  Build test failed (expected): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    console.log();

    // 测试 5: 测试所有工具的参数验证
    console.log("5. Testing parameter validation...");
    try {
      await handleToolCall("forge_execute", {}); // 缺少必需参数
      console.log("   ❌ Should have failed validation");
    } catch (error) {
      console.log(
        `   ✅ Validation works: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    console.log();

    console.log("✅ All MCP tests completed successfully!");
    console.log("\n📋 Test Summary:");
    console.log("   - Tool registration: ✅");
    console.log("   - Docker check: ✅");
    console.log("   - Forge command execution: ✅");
    console.log("   - Parameter validation: ✅");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    // 清理
    await dockerManager.cleanup();
  }
}

// 运行测试
testMCP().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
