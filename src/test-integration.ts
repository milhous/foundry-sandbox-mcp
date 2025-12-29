#!/usr/bin/env node

/**
 * MCP Server 集成测试
 * 测试所有可用工具
 */

import { DockerManager } from "./docker-manager.js";
import { ForgeExecutor } from "./forge-executor.js";

async function testAllTools() {
  console.log("🔧 Testing All MCP Tools\n");

  const dockerManager = new DockerManager();
  const forgeExecutor = new ForgeExecutor(dockerManager);

  const results: { tool: string; status: string; details?: string }[] = [];

  try {
    // 1. docker_check
    console.log("1️⃣  Testing docker_check...");
    try {
      const available = await dockerManager.checkDockerAvailable();
      results.push({
        tool: "docker_check",
        status: available ? "✅ PASS" : "❌ FAIL",
        details: available ? "Docker is available" : "Docker is not available",
      });
      console.log(`   ${available ? "✅" : "❌"} Docker available: ${available}\n`);
    } catch (error) {
      results.push({
        tool: "docker_check",
        status: "❌ FAIL",
        details: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 2. docker_list_containers
    console.log("2️⃣  Testing docker_list_containers...");
    try {
      const containers = await dockerManager.listContainers();
      results.push({
        tool: "docker_list_containers",
        status: "✅ PASS",
        details: `Found ${containers.length} container(s)`,
      });
      console.log(`   ✅ Found ${containers.length} container(s)\n`);
    } catch (error) {
      results.push({
        tool: "docker_list_containers",
        status: "❌ FAIL",
        details: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 3. forge_execute --version
    console.log("3️⃣  Testing forge_execute (--version)...");
    try {
      const result = await forgeExecutor.execute({
        command: "--version",
      });
      results.push({
        tool: "forge_execute --version",
        status: result.success ? "✅ PASS" : "❌ FAIL",
        details: `Exit code: ${result.exitCode}`,
      });
      console.log(`   ${result.success ? "✅" : "❌"} Exit code: ${result.exitCode}`);
      if (result.stdout) {
        const version = result.stdout.split("\n")[0];
        console.log(`   Version: ${version}\n`);
      }
    } catch (error) {
      results.push({
        tool: "forge_execute --version",
        status: "❌ FAIL",
        details: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 4. forge_execute build
    console.log("4️⃣  Testing forge_execute (build)...");
    try {
      const result = await forgeExecutor.execute({
        command: "build",
        args: ["--force"],
      });
      results.push({
        tool: "forge_execute build",
        status: result.success ? "✅ PASS" : "⚠️  WARN",
        details: `Exit code: ${result.exitCode}`,
      });
      console.log(`   ${result.success ? "✅" : "⚠️"} Exit code: ${result.exitCode}\n`);
    } catch (error) {
      results.push({
        tool: "forge_execute build",
        status: "❌ FAIL",
        details: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 5. forge_execute test
    console.log("5️⃣  Testing forge_execute (test)...");
    try {
      const result = await forgeExecutor.execute({
        command: "test",
        args: ["--no-match-test", "NonExistentTest"],
      });
      results.push({
        tool: "forge_execute test",
        status: result.exitCode === 0 ? "✅ PASS" : "⚠️  WARN",
        details: `Exit code: ${result.exitCode}`,
      });
      console.log(`   ${result.exitCode === 0 ? "✅" : "⚠️"} Exit code: ${result.exitCode}\n`);
    } catch (error) {
      results.push({
        tool: "forge_execute test",
        status: "❌ FAIL",
        details: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 6. docker_execute (custom command)
    console.log("6️⃣  Testing docker_execute (custom command)...");
    try {
      const result = await forgeExecutor.executeCustom("echo", ["Hello", "MCP"]);
      results.push({
        tool: "docker_execute",
        status: result.success ? "✅ PASS" : "❌ FAIL",
        details: `Output: ${result.stdout.trim()}`,
      });
      console.log(`   ${result.success ? "✅" : "❌"} Output: ${result.stdout.trim()}\n`);
    } catch (error) {
      results.push({
        tool: "docker_execute",
        status: "❌ FAIL",
        details: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 打印测试总结
    console.log("=".repeat(60));
    console.log("📊 Test Summary");
    console.log("=".repeat(60));
    results.forEach((r) => {
      console.log(`${r.status} ${r.tool}`);
      if (r.details) {
        console.log(`   ${r.details}`);
      }
    });
    console.log("=".repeat(60));

    const passed = results.filter((r) => r.status.includes("✅")).length;
    const total = results.length;
    console.log(`\n✅ Passed: ${passed}/${total}`);

    if (passed === total) {
      console.log("🎉 All tests passed!");
    } else {
      console.log("⚠️  Some tests had warnings or failures");
    }
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await dockerManager.cleanup();
  }
}

testAllTools().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

