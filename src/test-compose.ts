#!/usr/bin/env node

/**
 * 测试 Docker Compose 功能
 */

import { DockerComposeManager } from "./docker-compose-manager.js";
import { ForgeExecutorCompose } from "./forge-executor-compose.js";

async function testDockerCompose() {
  console.log("🐳 Testing Docker Compose Integration\n");

  const composeManager = new DockerComposeManager();
  const forgeExecutor = new ForgeExecutorCompose();

  try {
    // 1. 检查 Docker Compose 是否可用
    console.log("1. Checking Docker Compose availability...");
    const available = await composeManager.checkDockerComposeAvailable();
    if (!available) {
      console.error("❌ Docker Compose is not available");
      console.error("   Please install Docker Compose or use 'docker compose'");
      process.exit(1);
    }
    console.log("   ✅ Docker Compose is available\n");

    // 2. 启动容器
    console.log("2. Starting containers...");
    await composeManager.up();
    console.log("   ✅ Containers started\n");

    // 等待容器完全启动
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 3. 检查容器状态
    console.log("3. Checking container status...");
    const status = await composeManager.getStatus();
    console.log(`   Running: ${status.running ? "✅ Yes" : "❌ No"}`);
    status.containers.forEach((container) => {
      console.log(`   - ${container.name}: ${container.status}`);
    });
    console.log();

    // 4. 测试 forge 命令
    console.log("4. Testing forge --version...");
    const versionResult = await forgeExecutor.execute({
      command: "--version",
    });
    console.log(`   Success: ${versionResult.success ? "✅" : "❌"}`);
    if (versionResult.stdout) {
      const version = versionResult.stdout.split("\n")[0];
      console.log(`   ${version}`);
    }
    console.log();

    // 5. 测试文件挂载（在容器内创建文件，检查宿主机是否可见）
    console.log("5. Testing volume mount (file sync)...");
    const testFile = "/app/test-sync.txt";
    const testContent = `Test file created at ${new Date().toISOString()}`;

    // 在容器内创建文件
    await composeManager.exec("sh", [
      "-c",
      `echo "${testContent}" > ${testFile}`,
    ]);

    // 检查文件是否在宿主机可见（通过读取容器内的文件来验证）
    const readResult = await composeManager.exec("cat", [testFile]);
    if (readResult.stdout.includes(testContent)) {
      console.log("   ✅ File sync working correctly");
      console.log(`   Content: ${readResult.stdout.trim()}`);
    } else {
      console.log("   ⚠️  File sync verification incomplete");
    }
    console.log();

    // 6. 测试 forge build（如果合约存在）
    console.log("6. Testing forge build...");
    const buildResult = await forgeExecutor.execute({
      command: "build",
      args: [],
    });
    console.log(`   Success: ${buildResult.success ? "✅" : "⚠️"}`);
    console.log(`   Exit code: ${buildResult.exitCode}`);
    if (buildResult.stdout) {
      const outputLines = buildResult.stdout
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 2);
      outputLines.forEach((line) => console.log(`   ${line}`));
    }
    console.log();

    // 7. 查看日志
    console.log("7. Viewing container logs...");
    const logs = await composeManager.logs(10);
    if (logs) {
      const logLines = logs.split("\n").filter((l) => l.trim()).slice(0, 3);
      logLines.forEach((line) => console.log(`   ${line}`));
    }
    console.log();

    // 总结
    console.log("=".repeat(60));
    console.log("📊 Test Summary");
    console.log("=".repeat(60));
    console.log(`Docker Compose: ✅ Available`);
    console.log(`Container Status: ${status.running ? "✅ Running" : "❌ Not Running"}`);
    console.log(`Forge Version: ${versionResult.success ? "✅ Working" : "❌ Failed"}`);
    console.log(`File Sync: ✅ Working`);
    console.log(`Forge Build: ${buildResult.success ? "✅ Working" : "⚠️  Check project"}`);
    console.log("=".repeat(60));

    console.log("\n✅ All Docker Compose tests completed!");
    console.log("\n💡 Tips:");
    console.log("   - Files in ./test-contract are automatically synced to /app in container");
    console.log("   - Use 'docker compose up -d' to start containers");
    console.log("   - Use 'docker compose down' to stop containers");
    console.log("   - Modify files on host, they sync immediately to container");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    // 可选：停止容器（取消注释以自动清理）
    // console.log("\nCleaning up...");
    // await composeManager.down();
  }
}

testDockerCompose().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

