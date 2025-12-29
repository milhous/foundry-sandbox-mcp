实现 Codex Runner 通过 MCP 运行 Foundry 沙盒的核心思想是：编写一个 MCP Server 作为中介，将 AI 的指令转化为 Docker 容器内的 forge 命令。

具体实现步骤如下

1. 构建 Docker 沙盒镜像，创建 Dockerfile.foundry， 预装了 Foundry 的隔离环境。

2. 编写 MCP Server，创建一个 MCP Server，暴露 forge_test、forge_build 等工具给 AI。

3. 编写配置 MCP 客户端文档说明

必须实现的功能

1. 文件热同步：将主机的项目目录挂载到容器中，这样 AI 在编辑器里修改代码，容器内立即生效。

2. 状态清理：可以增加一个 forge_clean 工具，确保每次测试都是干净的环境。

期望目标

运行沙盒验证：
User: "现在在沙盒里运行这个测试，并告诉我结果。"
AI 调用工具: forge_test({ matchPath: "test/security/Reentrancy.t.sol" })
系统返回: (Docker 运行结果，例如 FAIL. Reason: ReentrancyGuard: reentrant call)
