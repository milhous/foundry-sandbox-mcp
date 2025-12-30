# Foundry Sandbox MCP Server - 流程分析

## 项目概述

Foundry Sandbox MCP Server 是一个基于 Docker 的 MCP (Model Context Protocol) 服务器，提供在隔离的 Docker 容器中运行 Foundry 测试命令的能力。每次测试都会创建全新的容器环境，测试完成后自动清理，确保测试环境的干净和一致性。

## 架构组件

### 核心模块

1. **`src/index.ts`** - MCP Server 主入口

   - 初始化 MCP Server
   - 注册工具处理器
   - 处理 JSON-RPC 2.0 协议通信

2. **`src/tools/forge-tool.ts`** - Forge 工具实现

   - 处理 `forge_test` 工具调用
   - 参数验证和命令构建
   - 结果格式化和错误处理

3. **`src/docker-manager.ts`** - Docker 容器管理器
   - 容器生命周期管理（创建、启动、删除）
   - 命令执行和输出捕获
   - 自动依赖安装

## 完整流程：从输入到输出

### 阶段 1: MCP Server 启动

```
1. 进程启动
   └─> 执行 `src/index.ts`
       └─> 创建 FoundrySandboxServer 实例
           ├─> 初始化 MCP Server (name: "foundry-sandbox", version: "1.0.0")
           ├─> 创建 ForgeTool 实例
           ├─> 注册请求处理器 (setupHandlers)
           │   ├─> ListToolsRequestSchema: 返回可用工具列表
           │   └─> CallToolRequestSchema: 处理工具调用
           └─> 设置错误处理 (setupErrorHandling)
               └─> 连接 StdioServerTransport
                   └─> Server 就绪，等待客户端请求
```

**关键代码位置**:

```12:44:src/index.ts
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
```

### 阶段 2: 客户端查询可用工具

```
2. 客户端发送 tools/list 请求
   └─> MCP Server 接收 ListToolsRequestSchema
       └─> 返回工具列表
           └─> {
                 tools: [{
                   name: "forge_test",
                   description: "...",
                   inputSchema: {
                     type: "object",
                     properties: {
                       projectPath: { type: "string", required: true },
                       testPath: { type: "string", optional: true },
                       matchPath: { type: "string", optional: true },
                       extraArgs: { type: "array", optional: true }
                     }
                   }
                 }]
               }
```

**关键代码位置**:

```51:87:src/index.ts
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "forge_test",
            description:
              "在 Docker 容器中运行 forge test 命令。每次测试时创建新容器，测试完成后自动清理，确保全新环境。支持匹配特定测试路径。",
            inputSchema: {
              type: "object",
              properties: {
                projectPath: {
                  type: "string",
                  description:
                    "Foundry 项目根路径（包含 foundry.toml 的目录），必须是绝对路径",
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
              required: ["projectPath"],
            },
          },
        ],
      };
    });
```

### 阶段 3: 客户端调用工具

```
3. 客户端发送 tools/call 请求
   └─> {
         name: "forge_test",
         arguments: {
           projectPath: "/absolute/path/to/foundry-project",
           testPath: "test/MyTest.t.sol",  // 可选
           extraArgs: ["--verbose"]        // 可选
         }
       }
   └─> MCP Server 接收 CallToolRequestSchema
       └─> 路由到 ForgeTool.runTest()
```

**关键代码位置**:

```90:114:src/index.ts
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
```

### 阶段 4: 参数验证和命令构建

```
4. ForgeTool.runTest() 处理
   ├─> 使用 Zod Schema 验证参数
   │   └─> ForgeTestArgsSchema.parse(args)
   │       ├─> projectPath: string (required)
   │       ├─> testPath: string (optional)
   │       ├─> matchPath: string (optional)
   │       └─> extraArgs: string[] (optional)
   │
   ├─> 创建新的 DockerManager 实例
   │   └─> new DockerManager(validatedArgs.projectPath)
   │       └─> 解析项目路径为绝对路径
   │
   └─> 构建 forge test 命令参数
       └─> ["test", "--match-path", "test/MyTest.t.sol", "--verbose"]
```

**关键代码位置**:

```33:55:src/tools/forge-tool.ts
  async runTest(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const validatedArgs = ForgeTestArgsSchema.parse(args);

    // 为每次测试创建新的 DockerManager（会创建新容器）
    const dockerManager = new DockerManager(validatedArgs.projectPath);

    // 构建命令参数
    const cmdArgs: string[] = ["test"];

    // 处理测试路径匹配
    if (validatedArgs.matchPath) {
      cmdArgs.push("--match-path", validatedArgs.matchPath);
    } else if (validatedArgs.testPath) {
      // 如果提供了 testPath，使用 --match-path
      cmdArgs.push("--match-path", validatedArgs.testPath);
    }

    // 添加额外参数
    if (validatedArgs.extraArgs) {
      cmdArgs.push(...validatedArgs.extraArgs);
    }
```

### 阶段 5: Docker 容器创建和初始化

```
5. DockerManager.execCommand() 执行
   ├─> 检查容器是否存在
   │   └─> 如果不存在，调用 createAndStartContainer()
   │       │
   │       ├─> ensureDockerAvailable()
   │       │   └─> docker.ping() 检查 Docker 守护进程
   │       │
   │       ├─> ensureImageExists()
   │       │   └─> 检查 "foundry-sandbox:latest" 镜像是否存在
   │       │
   │       ├─> 生成唯一容器名称
   │       │   └─> `foundry-sandbox-${timestamp}-${randomSuffix}`
   │       │
   │       ├─> 创建容器配置
   │       │   ├─> Image: "foundry-sandbox:latest"
   │       │   ├─> Cmd: ["tail", "-f", "/dev/null"] (保持运行)
   │       │   ├─> WorkingDir: "/workspace"
   │       │   ├─> Binds: ["${projectPath}:/workspace"] (挂载项目目录)
   │       │   └─> Env: ["FOUNDRY_PROFILE=default"]
   │       │
   │       ├─> docker.createContainer() 创建容器
   │       ├─> container.start() 启动容器
   │       │
   │       └─> ensureDependenciesInstalled() 自动安装依赖
   │           ├─> 检查 lib 目录是否存在且不为空
   │           └─> 如果不存在，自动安装 OpenZeppelin 依赖
   │               ├─> forge install OpenZeppelin/openzeppelin-contracts --no-git
   │               ├─> forge install OpenZeppelin/openzeppelin-contracts-upgradeable --no-git
   │               ├─> forge install openzeppelin-contracts-v4=OpenZeppelin/openzeppelin-contracts@v4.9.0 --no-git
   │               └─> forge install openzeppelin-contracts-upgradeable-v4=OpenZeppelin/openzeppelin-contracts-upgradeable@v4.9.0 --no-git
```

**关键代码位置**:

```70:113:src/docker-manager.ts
  async createAndStartContainer(): Promise<void> {
    await this.ensureDockerAvailable();
    await this.ensureImageExists();

    // 生成唯一容器名称（基于时间戳）
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const containerName = `foundry-sandbox-${timestamp}-${randomSuffix}`;

    try {
      // 创建容器
      const container = await this.docker.createContainer({
        Image: "foundry-sandbox:latest",
        name: containerName,
        Cmd: ["tail", "-f", "/dev/null"], // 保持容器运行
        WorkingDir: "/workspace",
        HostConfig: {
          Binds: [
            `${this.projectPath}:/workspace`, // 挂载项目目录
          ],
          AutoRemove: false, // 手动删除，以便在测试完成后清理
        },
        Env: ["FOUNDRY_PROFILE=default"],
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        OpenStdin: true,
      });

      // 启动容器
      await container.start();
```

### 阶段 6: 命令执行和输出捕获

```
6. 在容器中执行 forge test 命令
   ├─> container.exec() 创建 exec 实例
   │   └─> {
   │         Cmd: ["forge", "test", "--match-path", "test/MyTest.t.sol"],
   │         AttachStdout: true,
   │         AttachStderr: true,
   │         WorkingDir: "/workspace"
   │       }
   │
   ├─> exec.start() 启动命令执行
   │   └─> 返回流对象 (NodeJS.ReadableStream)
   │
   ├─> 创建 PassThrough 流分离 stdout/stderr
   │   ├─> stdoutStream: PassThrough
   │   └─> stderrStream: PassThrough
   │
   ├─> container.modem.demuxStream() 分离输出
   │   └─> 将 Docker 流分离到 stdoutStream 和 stderrStream
   │
   ├─> 监听流事件收集输出
   │   ├─> stdoutStream.on("data") -> 收集到 stdoutChunks[]
   │   └─> stderrStream.on("data") -> 收集到 stderrChunks[]
   │
   ├─> 等待流结束 (stream.on("end"))
   │   └─> 等待 stdoutStream 和 stderrStream 都结束
   │
   └─> exec.inspect() 获取退出码
       └─> 返回 { stdout, stderr, exitCode }
```

**关键代码位置**:

```356:457:src/docker-manager.ts
  async execCommand(
    command: string,
    args: string[] = [],
    timeout: number = 300000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // 如果容器不存在，创建并启动（会自动安装依赖）
    if (!this.containerId) {
      await this.createAndStartContainer();
    }

    const container = this.docker.getContainer(this.containerId!);
    const fullCommand = [command, ...args];

    // 创建执行选项
    const execOptions = {
      Cmd: fullCommand,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
    };

    // 创建 exec 实例
    const exec = await container.exec(execOptions);

    // 执行命令并获取输出
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // 启动 exec（返回 Promise）
    const stream = await exec.start({ hijack: true, stdin: false });

    // 创建 PassThrough 流用于分离 stdout 和 stderr
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    // 收集 stdout 数据
    stdoutStream.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    // 收集 stderr 数据
    stderrStream.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // 使用 demuxStream 分离 stdout 和 stderr
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    // 返回 Promise，等待命令执行完成
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command execution timeout after ${timeout}ms`));
      }, timeout);

      stream.on("end", async () => {
        clearTimeout(timeoutId);

        // 等待流结束
        await new Promise<void>((resolveStream) => {
          let ended = 0;
          const checkEnd = () => {
            ended++;
            if (ended === 2) resolveStream();
          };
          stdoutStream.on("end", checkEnd);
          stderrStream.on("end", checkEnd);
        });

        try {
          const inspect = await exec.inspect();
          const exitCode = inspect.ExitCode ?? -1;

          // 合并所有输出
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");

          resolve({ stdout, stderr, exitCode });
        } catch (error) {
          reject(
            new Error(
              `Failed to inspect exec: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          );
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Stream error: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      });
    });
  }
```

### 阶段 7: 结果格式化和响应

```
7. ForgeTool 处理执行结果
   ├─> 接收 { stdout, stderr, exitCode }
   │
   ├─> 判断测试结果
   │   ├─> isSuccess = (exitCode === 0)
   │   └─> status = isSuccess ? "PASS" : "FAIL"
   │
   ├─> 提取失败原因（如果失败）
   │   └─> 从输出中匹配错误模式
   │       └─> /(Error|Failed|Revert|ReentrancyGuard|AssertionError)[^\n]*/
   │
   ├─> 格式化输出文本
   │   └─> `${status}. Reason: ${reason}\n\n${output}`
   │
   └─> 返回 MCP 响应格式
       └─> {
             content: [{
               type: "text",
               text: "PASS\n\n[测试输出内容]"
             }]
           }
```

**关键代码位置**:

```57:99:src/tools/forge-tool.ts
    try {
      // 执行测试命令（会自动创建容器）
      const result = await dockerManager.execCommand("forge", cmdArgs);

      // 格式化输出
      let output = result.stdout;
      if (result.stderr) {
        output += `\n\nSTDERR:\n${result.stderr}`;
      }

      // 判断测试结果
      const isSuccess = result.exitCode === 0;
      const status = isSuccess ? "PASS" : "FAIL";

      // 提取失败原因（如果存在）
      let reason = "";
      if (!isSuccess) {
        // 尝试从输出中提取错误信息
        const errorMatch = output.match(
          /(Error|Failed|Revert|ReentrancyGuard|AssertionError)[^\n]*/
        );
        if (errorMatch) {
          reason = errorMatch[0];
        } else {
          reason = "Test execution failed";
        }
      }

      const resultText = reason
        ? `${status}. Reason: ${reason}\n\n${output}`
        : `${status}\n\n${output}`;

      // 测试完成后，清理容器（确保每次都是全新环境）
      await dockerManager.removeContainer();

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
```

### 阶段 8: 容器清理

```
8. 测试完成后清理容器
   ├─> dockerManager.removeContainer()
   │   ├─> 检查容器状态 (container.inspect())
   │   ├─> 如果容器正在运行，先停止 (container.stop())
   │   └─> 删除容器 (container.remove({ force: true }))
   │
   └─> 容器 ID 置为 null
       └─> 确保下次测试创建新容器
```

**关键代码位置**:

```307:346:src/docker-manager.ts
  async removeContainer(): Promise<void> {
    if (!this.containerId) {
      return;
    }

    try {
      const container = this.docker.getContainer(this.containerId);

      // 检查容器状态
      const info = await container.inspect();

      // 如果容器正在运行，先停止
      if (info.State.Running) {
        await container.stop({ t: 10 }); // 10秒超时
      }

      // 删除容器
      await container.remove({ force: true });
      console.error(`Container '${this.containerId}' removed`);
      this.containerId = null;
    } catch (error: unknown) {
      // 如果容器不存在，忽略错误
      if (
        error instanceof Error &&
        (error.message.includes("No such container") ||
          (error as { statusCode?: number }).statusCode === 404)
      ) {
        console.error(`Container '${this.containerId}' already removed`);
        this.containerId = null;
        return;
      }
      // 其他错误记录但不抛出，确保清理流程继续
      console.error(
        `Warning: Failed to remove container: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.containerId = null;
    }
  }
```

### 阶段 9: 错误处理

```
9. 错误处理（如果发生）
   ├─> 参数验证失败
   │   └─> Zod 抛出验证错误
   │       └─> 返回 MCP 错误响应
   │
   ├─> Docker 不可用
   │   └─> ensureDockerAvailable() 抛出错误
   │       └─> 返回错误信息给客户端
   │
   ├─> 容器创建失败
   │   └─> createAndStartContainer() 抛出错误
   │       └─> 返回错误信息给客户端
   │
   ├─> 命令执行失败
   │   ├─> 超时错误 (timeout)
   │   ├─> 流错误 (stream error)
   │   └─> 执行错误 (exec error)
   │       └─> 即使出错，也尝试清理容器
   │
   └─> 容器清理失败
       └─> 记录警告但不抛出错误
           └─> 确保流程继续
```

## 数据流图

```
┌─────────────┐
│ MCP Client  │
└──────┬──────┘
       │ JSON-RPC 2.0 (stdio)
       │
       ▼
┌─────────────────────────────────────┐
│  FoundrySandboxServer (index.ts)    │
│  ┌───────────────────────────────┐  │
│  │ ListToolsRequestSchema        │  │
│  │ └─> 返回工具列表              │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ CallToolRequestSchema         │  │
│  │ └─> 路由到 ForgeTool          │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  ForgeTool (forge-tool.ts)          │
│  ┌───────────────────────────────┐  │
│  │ 1. 参数验证 (Zod)             │  │
│  │ 2. 创建 DockerManager         │  │
│  │ 3. 构建命令参数               │  │
│  │ 4. 调用 execCommand()         │  │
│  │ 5. 格式化结果                 │  │
│  │ 6. 清理容器                   │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  DockerManager (docker-manager.ts)   │
│  ┌───────────────────────────────┐  │
│  │ 1. createAndStartContainer()  │  │
│  │    ├─> 检查 Docker 可用性     │  │
│  │    ├─> 检查镜像存在            │  │
│  │    ├─> 创建容器                │  │
│  │    ├─> 启动容器                │  │
│  │    └─> 安装依赖                │  │
│  │                                │  │
│  │ 2. execCommand()               │  │
│  │    ├─> container.exec()        │  │
│  │    ├─> exec.start()            │  │
│  │    ├─> demuxStream()           │  │
│  │    ├─> 收集输出                │  │
│  │    └─> exec.inspect()          │  │
│  │                                │  │
│  │ 3. removeContainer()          │  │
│  │    ├─> container.stop()       │  │
│  │    └─> container.remove()      │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ Docker API (dockerode)
               │
               ▼
┌─────────────────────────────────────┐
│  Docker Daemon                       │
│  ┌───────────────────────────────┐  │
│  │ Container: foundry-sandbox-*  │  │
│  │ ├─> Volume: /workspace        │  │
│  │ └─> Command: forge test       │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## 关键特性

### 1. 每次测试创建新容器

- **目的**: 确保测试环境的干净和一致性
- **实现**: 每次 `forge_test` 调用都创建新的 `DockerManager` 实例，生成唯一的容器名称
- **清理**: 测试完成后自动删除容器

### 2. 自动依赖安装

- **触发时机**: 容器创建后，首次执行命令前
- **检查逻辑**: 检查 `lib` 目录是否存在且不为空
- **安装内容**: OpenZeppelin 相关依赖（包括 v4 版本）
- **失败处理**: 依赖安装失败不会阻止测试执行，仅记录警告

### 3. 动态项目路径

- **优势**: 支持多项目，无需在 MCP 配置中绑定项目路径
- **传递方式**: 通过工具调用的 `projectPath` 参数传入
- **验证**: 使用 Zod Schema 验证参数格式

### 4. 流式输出处理

- **技术**: 使用 `PassThrough` 流和 `demuxStream` 分离 stdout/stderr
- **超时机制**: 默认 5 分钟超时，可配置
- **错误处理**: 完整的错误捕获和清理机制

## 性能考虑

1. **容器创建开销**: 每次测试创建新容器，但确保了环境隔离
2. **依赖安装**: 仅在首次检测到缺失时安装，后续测试可复用
3. **超时保护**: 防止长时间运行的测试阻塞系统
4. **资源清理**: 及时清理容器，避免资源泄漏

## 安全性

1. **Docker 隔离**: 所有命令在容器中执行，不影响宿主机
2. **卷挂载**: 只读挂载项目目录，保护宿主机文件
3. **错误隔离**: 容器内的错误不会影响 MCP Server
4. **自动清理**: 测试完成后立即清理，不留残留

## 总结

Foundry Sandbox MCP Server 实现了一个完整的从客户端请求到测试结果返回的流程：

1. **输入**: MCP 客户端通过 JSON-RPC 2.0 协议发送工具调用请求
2. **处理**: Server 路由请求到 ForgeTool，创建 Docker 容器，执行测试命令
3. **输出**: 格式化测试结果，返回给客户端，清理容器

整个流程设计注重**隔离性**、**一致性**和**可维护性**，确保每次测试都在干净的环境中运行，结果可靠且可重现。
