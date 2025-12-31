# MCP 功能能力分析报告

## 概述

本报告分析当前 Foundry Sandbox MCP Server 项目对以下两个功能的支持情况：

1. **日志转发**：MCP 服务器向客户端/Agent 实时转发日志的能力
2. **调用 Agent**：MCP 服务器调用其他 Agent 或 MCP 服务器的能力

---

## 1. 日志转发能力评估

### 1.1 当前实现状态

#### ✅ **已实现 - MCP 日志通知（Logging Notifications）**

**实现位置**：

- `src/index.ts` (第 35 行)：声明了 `logging: {}` 能力
- `src/tools/forge-tool.ts` (第 49-75 行)：实现了 `sendLoggingMessage` 方法

**实现细节**：

```35:35:src/index.ts
          logging: {}, // 声明支持日志通知功能
```

```49:75:src/tools/forge-tool.ts
  /**
   * 发送日志通知（MCP 协议标准方式）
   * 如果服务器不支持或发送失败，会回退到 stderr 输出
   */
  private sendLoggingMessage(
    level: LoggingMessageNotification["params"]["level"],
    message: string,
    data?: Record<string, unknown>
  ): void {
    // 优先使用 MCP 日志通知
    if (this.server) {
      this.server
        .sendLoggingMessage({
          level,
          logger: "forge-test",
          data: {
            message,
            timestamp: new Date().toISOString(),
            ...data,
          },
        })
        .catch((error) => {
          // 如果发送失败，回退到 stderr
          console.error(`[MCP] Failed to send logging message: ${error}`);
          console.error(`[${new Date().toLocaleTimeString()}] [Progress] ${message}`);
        });
    } else {
      // 如果没有 server 实例，直接使用 stderr
      console.error(`[${new Date().toLocaleTimeString()}] [Progress] ${message}`);
    }
  }
```

**使用场景**：

- 在 `runTest` 方法中，每个执行步骤都会发送日志通知
- 支持结构化数据（步骤、进度、操作类型等）
- 支持多种日志级别（info, warning, error 等）

**示例使用**：

```169:176:src/tools/forge-tool.ts
      this.sendLoggingMessage("info", step1Start, { step: 1, total: 4, action: "create_container" });
      console.error("═══════════════════════════════════════════════════════");
      console.error(step1Start);
      console.error("═══════════════════════════════════════════════════════");
      await dockerManager.createAndStartContainer();
      const step1Complete = "✅ 步骤 1/4: Docker 容器创建成功";
      progressLogs.push(step1Complete);
      this.sendLoggingMessage("info", step1Complete, { step: 1, total: 4, completed: true });
```

#### ✅ **已实现 - stderr 输出（后备方案）**

**实现位置**：

- `src/docker-manager.ts`：多处使用 `process.stderr.write` 实时输出日志
- `src/tools/forge-tool.ts`：在发送日志通知失败时回退到 stderr

**实现细节**：

```55:64:src/docker-manager.ts
  private logProgress(message: string, flush: boolean = true): void {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logMessage = `[${timestamp}] [Progress] ${message}\n`;
    // 直接写入 stderr，确保实时输出
    process.stderr.write(logMessage);
    // 强制刷新 stderr 缓冲区
    if (flush) {
      process.stderr.write('', () => {});
    }
  }
```

**优势**：

- 兼容性好：所有传输方式（stdio、SSE、WebSocket）都支持
- 实时性：通过强制刷新确保日志立即输出
- 后备保障：当 MCP 日志通知失败时自动回退

### 1.2 功能评估

| 评估项           | 状态      | 说明                              |
| ---------------- | --------- | --------------------------------- |
| **MCP 日志通知** | ✅ 已实现 | 符合 MCP 协议标准，支持结构化日志 |
| **stderr 后备**  | ✅ 已实现 | 提供兼容性保障                    |
| **实时性**       | ✅ 已实现 | 通过异步通知和强制刷新确保实时    |
| **结构化数据**   | ✅ 已实现 | 支持步骤、进度、操作类型等元数据  |
| **日志级别**     | ✅ 已实现 | 支持 info、warning、error 等      |
| **错误处理**     | ✅ 已实现 | 发送失败时自动回退到 stderr       |

### 1.3 客户端支持情况

**MCP 日志通知的客户端支持**：

- ✅ **Claude Desktop**：支持日志通知（需要验证）
- ✅ **Cursor**：支持日志通知（需要验证）
- ⚠️ **其他客户端**：取决于客户端实现

**stderr 输出的客户端支持**：

- ✅ **所有客户端**：stdio 传输方式下都支持 stderr 输出

### 1.4 结论

**日志转发能力：✅ 完全支持**

- 项目已经实现了完整的日志转发功能
- 使用 MCP 协议标准的日志通知作为主要方案
- 使用 stderr 输出作为后备方案
- 支持实时、结构化、多级别的日志转发

---

## 2. 调用 Agent 能力评估

### 2.1 MCP 协议支持情况

#### ❌ **MCP 协议本身不支持直接调用 Agent**

根据 MCP 协议规范，MCP 服务器**不能直接调用其他 Agent 或 MCP 服务器**。MCP 协议的设计是：

- **客户端 ↔ 服务器**：客户端可以调用服务器的工具、资源和提示
- **服务器 → 客户端**：服务器可以向客户端发送通知（日志、进度等）
- **服务器 ↔ 服务器**：❌ **不支持**

#### ✅ **MCP 协议支持 Prompts（提示）**

MCP 协议支持 `prompts` 功能，允许服务器定义可重用的提示模板。客户端可以调用这些提示，但这**不是服务器调用 Agent**，而是客户端调用服务器的提示。

**MCP 协议的核心能力**：

1. **Tools**：服务器提供工具，客户端调用
2. **Resources**：服务器提供资源，客户端访问
3. **Prompts**：服务器提供提示模板，客户端使用
4. **Sampling**：服务器可以请求客户端进行 LLM 补全（需要客户端支持）

### 2.2 当前项目实现状态

#### ❌ **未实现 - 调用 Agent 功能**

**原因**：

- MCP 协议本身不支持服务器之间的直接调用
- 当前项目专注于提供 Foundry 工具，没有实现调用其他 Agent 的功能

**代码检查**：

- `src/index.ts`：只实现了工具调用处理，没有调用其他 Agent 的代码
- `src/tools/forge-tool.ts`：只实现了 forge 命令执行，没有调用其他 Agent 的代码

### 2.3 可能的替代方案

#### 方案 1: 通过客户端间接调用（推荐）

**原理**：

- MCP 服务器不能直接调用其他 Agent
- 但可以通过返回**提示信息**，引导客户端调用其他 Agent
- 客户端（如 Claude Desktop、Cursor）可以同时连接多个 MCP 服务器

**实现方式**：

```typescript
// 在工具返回结果中，包含调用其他 Agent 的建议
return {
  content: [
    {
      type: "text",
      text: `测试完成。建议调用 security-audit MCP 服务器进行安全审计。`,
    },
  ],
};
```

**优点**：

- ✅ 符合 MCP 协议设计
- ✅ 不需要修改协议或架构
- ✅ 客户端可以管理多个 MCP 服务器

**缺点**：

- ⚠️ 需要客户端配合
- ⚠️ 不是真正的"调用"，而是"建议"

#### 方案 2: 实现 MCP 客户端功能

**原理**：

- 在 MCP 服务器中嵌入 MCP 客户端功能
- 作为客户端连接到其他 MCP 服务器
- 在工具执行时调用其他服务器的工具

**实现方式**：

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

class FoundrySandboxServer {
  private otherServerClient: Client | null = null;

  async callOtherAgent(toolName: string, args: unknown) {
    if (!this.otherServerClient) {
      // 连接到其他 MCP 服务器
      this.otherServerClient = new Client(...);
    }
    // 调用其他服务器的工具
    return await this.otherServerClient.callTool(toolName, args);
  }
}
```

**优点**：

- ✅ 可以实现真正的"调用"
- ✅ 服务器可以主动调用其他服务器

**缺点**：

- ❌ 架构复杂：服务器同时作为服务器和客户端
- ❌ 需要管理多个连接
- ❌ 可能违反 MCP 协议的设计原则
- ❌ 需要额外的配置和依赖管理

#### 方案 3: 使用 Prompts 功能

**原理**：

- 实现 MCP 协议的 `prompts` 功能
- 定义提示模板，引导客户端调用其他 Agent

**实现方式**：

```typescript
// 在服务器初始化时定义提示
this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "suggest-security-audit",
        description: "建议进行安全审计",
        arguments: [
          {
            name: "testResults",
            description: "测试结果",
            required: true,
          },
        ],
      },
    ],
  };
});
```

**优点**：

- ✅ 符合 MCP 协议标准
- ✅ 不需要修改架构

**缺点**：

- ⚠️ 仍然是"建议"而非"调用"
- ⚠️ 需要客户端支持 prompts 功能

### 2.4 功能评估

| 评估项           | 状态      | 说明                               |
| ---------------- | --------- | ---------------------------------- |
| **MCP 协议支持** | ❌ 不支持 | MCP 协议不支持服务器之间的直接调用 |
| **当前实现**     | ❌ 未实现 | 项目没有实现调用其他 Agent 的功能  |
| **替代方案 1**   | ⚠️ 可行   | 通过客户端间接调用（推荐）         |
| **替代方案 2**   | ⚠️ 复杂   | 实现 MCP 客户端功能（不推荐）      |
| **替代方案 3**   | ⚠️ 可行   | 使用 Prompts 功能（可行）          |

### 2.5 结论

**调用 Agent 能力：❌ 不支持（协议限制）**

- MCP 协议本身不支持服务器之间的直接调用
- 当前项目没有实现调用其他 Agent 的功能
- 可以通过替代方案实现间接调用，但需要客户端配合

**建议**：

- 如果需要调用其他 Agent，推荐使用**方案 1**（通过客户端间接调用）
- 或者实现**方案 3**（使用 Prompts 功能）

---

## 3. 总结

### 3.1 日志转发

| 功能             | 状态      | 实现方式     | 推荐度     |
| ---------------- | --------- | ------------ | ---------- |
| **MCP 日志通知** | ✅ 已实现 | 协议标准方式 | ⭐⭐⭐⭐⭐ |
| **stderr 后备**  | ✅ 已实现 | 兼容性保障   | ⭐⭐⭐⭐   |

**结论**：✅ **完全支持日志转发**

### 3.2 调用 Agent

| 功能                   | 状态      | 实现方式   | 推荐度   |
| ---------------------- | --------- | ---------- | -------- |
| **直接调用**           | ❌ 不支持 | 协议限制   | N/A      |
| **间接调用（客户端）** | ⚠️ 可行   | 通过客户端 | ⭐⭐⭐⭐ |
| **Prompts 功能**       | ⚠️ 可行   | 协议标准   | ⭐⭐⭐   |

**结论**：❌ **不支持直接调用 Agent（协议限制）**

### 3.3 建议

1. **日志转发**：

   - ✅ 当前实现已经完善，无需修改
   - ✅ 建议测试不同客户端的日志通知支持情况

2. **调用 Agent**：
   - ⚠️ 如果需要调用其他 Agent，建议实现 **Prompts 功能**
   - ⚠️ 或者通过工具返回结果中的建议，引导客户端调用其他 Agent
   - ❌ 不推荐实现 MCP 客户端功能（架构复杂）

---

## 4. 参考资料

- [MCP 协议规范](https://modelcontextprotocol.io)
- [MCP SDK 文档](https://github.com/modelcontextprotocol/typescript-sdk)
- [REALTIME_PROGRESS_ANALYSIS.md](./REALTIME_PROGRESS_ANALYSIS.md) - 实时进度日志方案分析
- [MCP Agent SDK](https://github.com/lastmile-ai/mcp-agent) - MCP Agent 扩展（非标准协议）

---

**报告生成时间**：2024-12-19
**项目版本**：1.0.0
**MCP SDK 版本**：^1.0.0
