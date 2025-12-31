# MCP 实时进度日志方案分析

## 问题描述

当前 Agent 调用 MCP 工具时，无法实时看到执行进度和日志信息。虽然我们通过 `stderr` 输出了日志，但 MCP 客户端可能不会实时转发这些日志给 Agent。

## 方案评估

### 方案 1: MCP 日志通知 (Logging Notifications) ⭐ **推荐**

#### 原理
MCP 协议支持通过 `notifications/logging` 发送结构化的日志消息。这是 MCP 协议的标准功能，专门用于服务器向客户端发送日志信息。

#### 实现方式

1. **声明日志能力**
```typescript
this.server = new Server(
  {
    name: "foundry-sandbox",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      logging: {}, // 声明支持日志功能
    },
  }
);
```

2. **发送日志通知**
```typescript
// 在工具执行过程中发送日志
this.server.sendLoggingMessage({
  level: "info", // "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"
  logger: "forge-test",
  data: {
    message: "正在创建 Docker 容器...",
    step: "1/4",
  },
});
```

#### 优点
- ✅ **协议标准支持**：MCP 协议原生支持，不依赖传输方式
- ✅ **结构化日志**：支持日志级别、logger 名称、结构化数据
- ✅ **客户端支持**：大多数 MCP 客户端都支持日志通知
- ✅ **实时性**：日志通知是异步的，不阻塞工具执行
- ✅ **兼容性好**：在 stdio、SSE、WebSocket 等传输方式下都可用

#### 缺点
- ⚠️ **需要客户端支持**：客户端必须实现日志通知处理
- ⚠️ **需要声明能力**：服务器必须声明 `logging` 能力

#### 实现复杂度
- **低**：只需添加能力声明和调用 `sendLoggingMessage` 方法

#### 推荐指数
⭐⭐⭐⭐⭐ (5/5)

---

### 方案 2: 进度通知 (Progress Notifications)

#### 原理
MCP 协议支持通过 `notifications/progress` 发送进度更新。客户端可以在请求中提供 `progressToken`，服务器使用该 token 发送进度通知。

#### 实现方式

1. **客户端请求时提供 progressToken**
```typescript
// 客户端在调用工具时提供 progressToken
{
  method: "tools/call",
  params: {
    name: "forge_test",
    arguments: {...},
    _meta: {
      progressToken: "unique-token-123"
    }
  }
}
```

2. **服务器发送进度通知**
```typescript
// 服务器使用 progressToken 发送进度通知
this.server.sendNotification({
  method: "notifications/progress",
  params: {
    progressToken: "unique-token-123",
    progress: 0.5, // 0-1 之间的进度值
    total?: 100,
  },
});
```

#### 优点
- ✅ **协议标准支持**：MCP 协议原生支持
- ✅ **进度量化**：可以发送具体的进度百分比
- ✅ **实时性**：异步通知，不阻塞执行

#### 缺点
- ⚠️ **需要客户端配合**：客户端必须在请求中提供 `progressToken`
- ⚠️ **功能有限**：主要用于进度百分比，不适合详细的日志信息
- ⚠️ **实现复杂**：需要管理 progressToken 和进度状态

#### 实现复杂度
- **中**：需要客户端配合，需要管理进度状态

#### 推荐指数
⭐⭐⭐ (3/5) - 适合需要进度条的场景，但不适合详细日志

---

### 方案 3: SSE (Server-Sent Events) 传输

#### 原理
使用 SSE 传输方式替代 stdio，可以实现真正的实时推送。SSE 支持服务器主动向客户端推送数据。

#### 实现方式

1. **切换到 SSE 传输**
```typescript
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// 创建 HTTP 服务器
const app = express();
const transport = new SSEServerTransport("/mcp", app);

await this.server.connect(transport);
```

2. **通过 SSE 推送日志**
```typescript
// SSE 传输方式下，可以通过额外的端点推送日志
app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // 推送日志
  res.write(`data: ${JSON.stringify({ message: "正在创建容器..." })}\n\n`);
});
```

#### 优点
- ✅ **真正的实时推送**：服务器可以主动推送数据
- ✅ **HTTP 标准**：基于 HTTP，易于部署和调试
- ✅ **浏览器支持**：浏览器原生支持 SSE

#### 缺点
- ❌ **需要 HTTP 服务器**：不能使用 stdio，需要运行 HTTP 服务器
- ❌ **配置复杂**：需要配置端口、路由等
- ❌ **部署复杂**：需要额外的网络配置
- ❌ **不适合当前场景**：当前使用 stdio 传输，切换到 SSE 需要大幅改动

#### 实现复杂度
- **高**：需要重构传输层，配置 HTTP 服务器

#### 推荐指数
⭐⭐ (2/5) - 适合需要 HTTP 访问的场景，但不适合当前 stdio 场景

---

### 方案 4: WebSocket 传输

#### 原理
使用 WebSocket 传输方式，支持双向实时通信。

#### 实现方式

```typescript
import { WebSocketServerTransport } from "@modelcontextprotocol/sdk/server/websocket.js";

const transport = new WebSocketServerTransport(wsServer);
await this.server.connect(transport);
```

#### 优点
- ✅ **双向实时通信**：支持服务器和客户端双向通信
- ✅ **低延迟**：WebSocket 连接延迟低

#### 缺点
- ❌ **需要 WebSocket 服务器**：不能使用 stdio
- ❌ **配置复杂**：需要配置 WebSocket 服务器
- ❌ **部署复杂**：需要额外的网络配置
- ❌ **不适合当前场景**：当前使用 stdio 传输

#### 实现复杂度
- **高**：需要重构传输层，配置 WebSocket 服务器

#### 推荐指数
⭐⭐ (2/5) - 适合需要双向通信的场景，但不适合当前 stdio 场景

---

### 方案 5: 改进 stderr 输出（当前方案）

#### 原理
继续使用 stderr 输出日志，但优化输出格式和刷新机制。

#### 实现方式

```typescript
// 直接写入 stderr，确保实时输出
process.stderr.write(logMessage, () => {
  process.stderr.write('', () => {});
});
```

#### 优点
- ✅ **简单**：无需修改协议或传输方式
- ✅ **兼容性好**：所有传输方式都支持 stderr

#### 缺点
- ❌ **依赖客户端**：客户端可能不转发 stderr
- ❌ **非结构化**：stderr 是文本流，不是结构化数据
- ❌ **不可靠**：某些客户端可能缓冲或忽略 stderr

#### 实现复杂度
- **低**：已经实现，只需优化

#### 推荐指数
⭐⭐ (2/5) - 作为补充方案，但不能作为主要方案

---

## 综合评估

### 推荐方案：方案 1 (MCP 日志通知) + 方案 5 (stderr 输出)

#### 理由

1. **MCP 日志通知是标准方案**
   - 符合 MCP 协议规范
   - 大多数客户端都支持
   - 结构化、可过滤、可控制日志级别

2. **stderr 作为补充**
   - 对于不支持日志通知的客户端，stderr 仍然可用
   - 提供双重保障

3. **实现简单**
   - 只需添加能力声明和调用 `sendLoggingMessage`
   - 不需要修改传输方式或架构

### 实施建议

#### 阶段 1: 实现 MCP 日志通知（优先）

1. 在服务器初始化时声明 `logging` 能力
2. 在工具执行过程中，使用 `sendLoggingMessage` 发送日志
3. 根据日志类型选择合适的日志级别

#### 阶段 2: 保留 stderr 输出（兼容性）

1. 继续使用 stderr 输出日志
2. 作为不支持日志通知的客户端的后备方案

#### 阶段 3: 优化日志格式

1. 统一日志格式
2. 添加结构化数据（步骤、进度等）
3. 使用合适的日志级别

## 实现示例

### 完整的实现代码

```typescript
// src/index.ts
constructor() {
  this.server = new Server(
    {
      name: "foundry-sandbox",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        logging: {}, // 声明支持日志功能
      },
    }
  );
}

// src/tools/forge-tool.ts
async runTest(args: unknown): Promise<{...}> {
  // 发送日志通知
  this.sendProgressLog("info", "🚀 步骤 1/4: 正在创建 Docker 容器...", {
    step: 1,
    total: 4,
  });
  
  await dockerManager.createAndStartContainer();
  
  this.sendProgressLog("info", "✅ 步骤 1/4: Docker 容器创建成功", {
    step: 1,
    total: 4,
    completed: true,
  });
  
  // ... 其他步骤
}

private sendProgressLog(
  level: "info" | "warning" | "error",
  message: string,
  data?: Record<string, unknown>
): void {
  // 发送 MCP 日志通知
  this.server.sendLoggingMessage({
    level,
    logger: "forge-test",
    data: {
      message,
      timestamp: new Date().toISOString(),
      ...data,
    },
  }).catch((error) => {
    // 如果发送失败，记录但不中断执行
    console.error("[MCP] Failed to send logging message:", error);
  });
  
  // 同时输出到 stderr（作为后备）
  console.error(`[${new Date().toLocaleTimeString()}] [Progress] ${message}`);
}
```

## 总结

| 方案 | 实时性 | 可靠性 | 实现复杂度 | 推荐指数 |
|------|--------|--------|------------|----------|
| MCP 日志通知 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 进度通知 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| SSE 传输 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| WebSocket 传输 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| stderr 输出 | ⭐⭐ | ⭐⭐ | ⭐ | ⭐⭐ |

**最终推荐：使用 MCP 日志通知（方案 1）作为主要方案，stderr 输出（方案 5）作为补充方案。**

