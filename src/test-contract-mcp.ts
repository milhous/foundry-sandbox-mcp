#!/usr/bin/env node

/**
 * 测试合约 MCP 功能
 * 通过 MCP 工具编译和测试 Counter 合约
 */

import { DockerManager } from "./docker-manager.js";
import { ForgeExecutor } from "./forge-executor.js";
import * as fs from "fs";
import * as path from "path";

const TEST_CONTRACT_DIR = path.join(process.cwd(), "test-contract");

async function testContractWithMCP() {
  console.log("📝 Testing Contract with MCP Tools\n");

  const dockerManager = new DockerManager();
  const forgeExecutor = new ForgeExecutor(dockerManager);

  try {
    // 检查 Docker
    console.log("1. Checking Docker...");
    const dockerAvailable = await dockerManager.checkDockerAvailable();
    if (!dockerAvailable) {
      console.error("❌ Docker is not available");
      process.exit(1);
    }
    console.log("   ✅ Docker is available\n");

    // 检查测试合约目录是否存在
    console.log("2. Checking test contract directory...");
    if (!fs.existsSync(TEST_CONTRACT_DIR)) {
      console.error(
        `❌ Test contract directory not found: ${TEST_CONTRACT_DIR}`
      );
      process.exit(1);
    }
    console.log("   ✅ Test contract directory found\n");

    // 使用 volume 挂载测试合约目录
    console.log("3. Setting up container with volume mount...");
    // 确保没有旧容器
    await dockerManager.removeContainer("foundry-mcp-test-contract");
    const containerWithVolume = await dockerManager.getOrCreateContainer({
      name: "foundry-mcp-test-contract",
      image: "ghcr.io/foundry-rs/foundry:latest",
      workingDir: "/app",
      volumes: {
        [TEST_CONTRACT_DIR]: "/app",
      },
    });
    console.log("   ✅ Container with volume mount ready\n");

    // 初始化 Foundry 项目（如果需要）
    console.log("4. Initializing Foundry project...");
    try {
      await dockerManager.execCommand(
        containerWithVolume,
        "forge",
        ["init", "--force", "."],
        "/app"
      );
      console.log("   ✅ Foundry project initialized\n");
    } catch (error) {
      // 如果已经初始化，忽略错误
      console.log("   ℹ️  Project may already be initialized\n");
    }

    // 确保合约文件在正确位置
    console.log("5. Setting up contract files...");
    await dockerManager.execCommand(
      containerWithVolume,
      "mkdir",
      ["-p", "src"],
      "/app"
    );
    await dockerManager.execCommand(
      containerWithVolume,
      "cp",
      ["Counter.sol", "Counter.t.sol", "src/"],
      "/app"
    );
    console.log("   ✅ Contract files copied to src/\n");

    // 测试 1: 编译合约
    console.log("6. Testing forge build...");
    const buildResult = await forgeExecutor.execute(
      {
        command: "build",
        args: [],
        workingDir: "/app",
      },
      "foundry-mcp-test-contract"
    );

    console.log(`   Command: ${buildResult.command}`);
    console.log(`   Success: ${buildResult.success}`);
    console.log(`   Exit code: ${buildResult.exitCode}`);
    if (buildResult.stdout) {
      const outputLines = buildResult.stdout
        .split("\n")
        .filter((l) => l.trim());
      if (outputLines.length > 0) {
        console.log(`   Output: ${outputLines[0]}`);
      }
    }
    if (!buildResult.success && buildResult.stderr) {
      console.log(`   Error: ${buildResult.stderr.split("\n")[0]}`);
    }
    console.log();

    // 测试 2: 运行测试
    console.log("7. Testing forge test...");
    const testResult = await forgeExecutor.execute(
      {
        command: "test",
        args: ["-vvv"],
        workingDir: "/app",
      },
      "foundry-mcp-test-contract"
    );

    console.log(`   Command: ${testResult.command}`);
    console.log(`   Success: ${testResult.success}`);
    console.log(`   Exit code: ${testResult.exitCode}`);

    // 显示测试结果摘要
    if (testResult.stdout) {
      const lines = testResult.stdout.split("\n");
      const testSummary = lines.find(
        (l) => l.includes("Test result:") || l.includes("PASS")
      );
      if (testSummary) {
        console.log(`   ${testSummary}`);
      }

      // 显示通过的测试
      const passedTests = lines.filter((l) => l.includes("[PASS]"));
      if (passedTests.length > 0) {
        console.log(`   Passed tests: ${passedTests.length}`);
        passedTests.slice(0, 3).forEach((test) => {
          const match = test.match(/\[PASS\]\s+(.+)/);
          if (match) {
            console.log(`     ✅ ${match[1]}`);
          }
        });
      }
    }
    if (!testResult.success && testResult.stderr) {
      const errorLines = testResult.stderr.split("\n").filter((l) => l.trim());
      if (errorLines.length > 0) {
        console.log(`   Error: ${errorLines[0]}`);
      }
    }
    console.log();

    // 测试 3: 查看测试覆盖率（如果可用）
    console.log("8. Testing forge coverage...");
    try {
      const coverageResult = await forgeExecutor.execute(
        {
          command: "coverage",
          args: ["--report", "summary"],
          workingDir: "/app",
        },
        "foundry-mcp-test-contract"
      );

      if (coverageResult.success && coverageResult.stdout) {
        const coverageMatch = coverageResult.stdout.match(/(\d+\.\d+)%/);
        if (coverageMatch) {
          console.log(`   ✅ Coverage: ${coverageMatch[1]}%`);
        }
      }
    } catch (error) {
      console.log("   ℹ️  Coverage command not available or failed");
    }
    console.log();

    // 总结
    console.log("=".repeat(60));
    console.log("📊 Test Summary");
    console.log("=".repeat(60));
    console.log(`Build: ${buildResult.success ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Tests: ${testResult.success ? "✅ PASS" : "❌ FAIL"}`);
    console.log("=".repeat(60));

    if (buildResult.success && testResult.success) {
      console.log("\n🎉 All contract tests passed via MCP!");
    } else {
      console.log("\n⚠️  Some tests had issues");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    // 清理容器
    await dockerManager.removeContainer("foundry-mcp-test-contract");
  }
}

testContractWithMCP().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
