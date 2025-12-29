作为 AI 审计沙盒（MCP 集成版）：让 AI 自动运行这些命令，你的 MCP Server 只需执行如下 shell 命令，并返回结果

```
// MCP 逻辑中的命令拼接示例
const cmd = `docker exec foundry-sandbox forge test --match-path ${testPath}`;
```

要求：

1. 创建 Dockerfile.foundry 使用 Foundry 官方提供的镜像作为基础。

2. 创建 docker-compose.yml，使用 Docker Compose 可以更方便地挂载本地目录和映射端口（尤其是运行 Anvil 本地节点时）。

3. 编写 MCP Server，创建一个 MCP Server，暴露 forge_test、forge_build 等工具给 AI。

4. 编写配置 MCP 客户端文档说明

必须实现的功能

1. 文件热同步，将主机的项目目录挂载到容器中，容器可以读取项目文件。

2. 使用 Foundry 前，确保 docker 环境可以使用。

3. 使用 Foundry 时，Foundry 所需的配置从项目目录的 foundry.toml 文件读取

4. 状态清理，确保每次测试都是干净的环境。

5. 环境一致性：无论你在 Mac、Windows 还是 Linux 上，forge 的版本和行为完全一致。

6. 安全性：Foundry 支持 ffi 功能（允许执行任意 shell 脚本），在 Docker 中开启 ffi 比在宿主机上安全得多。

7. 零污染：所有的依赖库、编译缓存（out/ 和 cache/）都可以留在容器内或通过 .gitignore 排除，保持宿主机干净。

8. 即时节点：anvil 作为一个独立服务常驻后台，你可以随时重启它以重置区块链状态。

期望目标

运行沙盒验证，User: "现在在沙盒里运行这个测试，并告诉我结果。"，Agent 调用工具，系统返回: (Docker 运行结果，例如 FAIL. Reason: ReentrancyGuard: reentrant call)

优化 MPC，仅提供 forge_test 方法。

1. 调用 forge_test 时，传入项目根路径。

2. 检查 docker 容器是否存在，如果 docker 容器不存在，启动 docker，创建 docker 容器，将传入的项目目录挂载到 docker 容器中，使 docker 容器可以读取项目文件

3. 所有的测试行为均在 docker 容器中自动运行

4. 得到测试的结果返回并输入到主机

5. 清理卸载 docker 容器，保证每次都是全新的测试环境
