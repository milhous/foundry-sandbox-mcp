#!/usr/bin/env node

/**
 * 简单的 Docker 连接测试脚本
 */

import { DockerManager } from "./docker-manager.js";

async function testDocker() {
  console.log("Testing Docker connection...\n");

  const dockerManager = new DockerManager();

  try {
    // 测试 Docker 是否可用
    console.log("1. Checking Docker availability...");
    const available = await dockerManager.checkDockerAvailable();
    console.log(`   Docker available: ${available ? "✅ Yes" : "❌ No"}\n`);

    if (!available) {
      console.log("⚠️  Docker is not available. Please ensure Docker is running.");
      process.exit(1);
    }

    // 测试容器列表
    console.log("2. Listing containers...");
    const containers = await dockerManager.listContainers();
    console.log(`   Found ${containers.length} container(s):`);
    containers.forEach((container) => {
      console.log(`   - ${container.name} (${container.status})`);
    });
    console.log();

    // 测试创建/获取容器
    console.log("3. Getting or creating Foundry container...");
    const container = await dockerManager.getOrCreateContainer({
      name: "foundry-mcp-test",
      image: "ghcr.io/foundry-rs/foundry:latest",
    });
    console.log("   ✅ Container ready\n");

    // 测试执行简单命令
    console.log("4. Testing command execution...");
    const result = await dockerManager.execCommand(container, "forge", ["--version"]);
    console.log(`   Command: forge --version`);
    console.log(`   Exit code: ${result.exitCode}`);
    console.log(`   Output:\n${result.stdout}`);
    if (result.stderr) {
      console.log(`   Errors:\n${result.stderr}`);
    }
    console.log();

    // 清理测试容器
    console.log("5. Cleaning up test container...");
    await dockerManager.removeContainer("foundry-mcp-test");
    console.log("   ✅ Cleanup complete\n");

    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testDocker();

