# Worktree Relay 本机验收记录

## 真实客户端验收（2026-10-25 UTC）

四个客户端均使用真实已安装程序和真实模型，不以模拟客户端代替。每个客户端在独立临时仓库/状态目录中运行，接收 worktree 保留本地修改，发送方随后提交随机 `UPSTREAM_*` 标记，并用 `--file ./shared.txt` 发送随机 `RELAY_*` 消息。初始用户提示不含这两个随机值。

通过标准：原会话模型准确回读两个标记；两条事件都有独立 `delivered` 回执；下一轮检查不重复投递/不改写回执；本地文件内容未被覆盖。记录摘要和被测构建哈希见 [`acceptance-results.json`](acceptance-results.json)。

| 客户端 | 版本 | 模型 | 实际入口 | 结果 |
| --- | --- | --- | --- | --- |
| pi | `1.4.0` | `openai/gpt-6.1-sol` | `pi --mode rpc` 加载原生扩展；同一进程空闲后自动触发 | 通过 |
| Codex CLI | `0.164.0` | `gpt-6.1-sol` | 隔离 `CODEX_HOME/hooks.json`；`exec` 建立会话，`exec resume` 同一 ID | 通过 |
| OpenCode | `2.1.2` | `amr/deepseek-v4.1-flash` | 真实 v2 `opencode serve` 加载 Promise 插件；同一会话空闲后自动触发 | 通过 |
| Claude Code | `2.1.310` | `deepseek-v4.1-flash` | `--settings` 加载 hooks；`--session-id` 后 `--resume` 同一 ID | 通过 |

本机原始证据位于 `$TMPDIR` 下（临时目录可能被系统清理，不是项目运行依赖）：

- `worktree-relay-pi-nSYj1w/`：RPC 事件流、会话 JSONL、状态与结果。
- `worktree-relay-codex-8129TM/`：三次真实 CLI 调用的 JSONL、隔离 hooks、状态与结果。
- `worktree-relay-opencode-VtZ8Ob/`：v2 会话上下文、服务日志、状态与结果。
- `worktree-relay-claude-code-NkMoYb/`：三次真实 CLI 调用结果、状态与结果。

安全与配置边界：

- 不修改用户全局设置，不停止既有客户端服务，不在真实项目上合并或清理。使用已有登录；Codex 在 `0700` 临时目录借用认证副本，运行后删除副本。
- Codex 仅对已审阅的本包 hooks 使用单次 `--dangerously-bypass-hook-trust`；模型工具仍使用只读沙箱。正常安装必须由用户审阅 `/hooks`。临时 worktree 的项目级 hooks 发现未成功，用户级 hooks 通过，不能混称两者都已验收。
- OpenCode 服务仅绑定 `127.0.0.1`，使用临时 Basic 认证；使用 v2 的 `id/setup`、prompt hook、持久队列与事件订阅。无旧接口兼容分支。
- 模型只被要求回读事件数据，不执行工具或 Git 操作。pi/OpenCode 验证了空闲自动唤醒；Claude Code/Codex 依靠下一次 hook，未声称能自行唤醒空闲会话。
- 真实测试覆盖正常收件与去重，不覆盖所有 TUI 对话框、工具完成/Stop continuation、忙时并发、强杀窗口或全部宿主版本；这些边界仍由针对性自动化测试与后续验收补充。

复验流程：

1. `npm ci --ignore-scripts && npm run typecheck && npm test`，再构建本包。
2. 为每个客户端创建临时仓库、接收 worktree 与独立 `WORKTREE_SYNC_STATE_DIR`；加载本包对应扩展/插件/hooks，并让原会话先回答基线提示。
3. 基线登记成功后，在主分支写入随机标记并提交，再通过 CLI 发送另一随机标记。不要把标记直接放进后续用户提示。
4. pi/OpenCode 保持原进程与原会话运行，等待轮询；Claude Code/Codex 用相同原生 session ID 恢复并触发下一次 hook。
5. 核对模型回复、原会话历史、事件 ID、两个回执及本地文件；额外等待一个轮询或恢复一轮，确认不重复。最后停止本次子进程、显式退出本次订阅，保留证据。

## 范围与环境

自动化维护验收覆盖显式会话退出/重入、安全事件清理，以及可选 daemon 的实际进程生命周期。使用隔离状态目录和临时 Git worktree，不清理用户现有事件，不安装系统服务；这部分测试不调用模型。上节真实客户端验收另行使用了已有模型服务。

本机环境：macOS，Node.js `v22.23.2`，Git `2.54.0 (Apple Git-157)`。

## 执行结果

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 全量测试 | 74/74 通过 | `npm test`；含路径规范化、非 first-parent 快进及下述审查回归 |
| 静态类型检查 | 通过 | `npm run typecheck`；核心、适配器与测试 |
| 依赖审计 | 0 个已知漏洞 | `npm audit`，含开发依赖 |
| 新包名与命令兼容 | 通过 | `worktree-relay` tarball 离线安装；`worktree-relay --help` / `worktree-sync --help` |
| 规模基准 | 通过所有自校验 | `npm run benchmark`；详见 [性能记录](performance.md) |
| daemon / CLI 核心验收重复执行 | 9/9 连续三轮通过 | 构建后运行 `tests/cli/maintenance.test.ts` 与 `tests/core/daemon.test.ts` |
| 构建后 JS 语法检查 | 通过 | `node --check` 检查 `dist/` 下所有 JS |
| npm tarball 离线安装 | 通过 | 临时 prefix，`--offline --ignore-scripts --omit=optional` |
| 安装后的 CLI 闭环 | 通过 | 登记 → 跨 agent 发送/接收 → leave → 确认事件 GC |
| 安装后的 daemon | 通过 | 启动真实进程 → status 为 true → SIGTERM → status 为 false，锁和心跳清除 |
| 安装后的 pi 扩展加载 | 通过 | 当前 pi 的真实 extension loader 成功注册 `/worktree` |

手动直接运行测试文件前应先 `npm run build`，因为 CLI 验收执行的是发布用 `dist/cli/main.js`，不是 TypeScript 源文件。

### 审查回归验证

- `tests/core/regressions.test.ts`：历史目录样式事件可读取/确认/GC；发送端拒绝现存目录；损坏 daemon 状态不阻止本地回退；send-first 迁移基线不重复覆盖普通上游事件；发布重试合并新接收者且保留旧回执；orphan/无关 HEAD 给出可操作错误并保留未读事件；prunable worktree 可安全移除登记。
- `tests/adapters/pi-watch.test.ts`、`tests/adapters/pi.test.ts`：按宿主真实约定模拟 custom follow-up 不计入 `hasPendingMessages()`；Esc 丢队列后原 watcher 重试；重复 join 和 leave/join 不重复入队，落盘前不确认。
- `tests/adapters/opencode.test.ts`：prompt 注册查询拒绝只产生 warning；查询期间的删除事件不会生成幽灵登记或继续轮询。
- `tests/core/daemon.test.ts`、`tests/cli/maintenance.test.ts`：阻塞的输出回调在发布锁外；真实 OS 管道填满且无人读取时，SIGTERM 仍退出并清理状态。CLI/core 共 9 项连续三轮通过。
- `tests/cli/main.test.ts`：进程 cwd 被删除后，帮助、显式 cwd 检查、daemon status 和携带有效 cwd 的 hook 仍成功。
- 额外执行 `733c860` 的真实旧生产者 → 当前读者：`src/`、`.`、`./`、`./C:/x`、`src/.` 五种历史路径均能读取及 GC；实际 EACCES 游标写失败后 daemon 重试也补齐新收件人且只投递一次。
- 原始 daemon 背压复现脚本再次运行：stdout 未读取时不再永久占住发布锁；SIGTERM 后进程退出码 0，`daemon.lock`、`daemon.json`、`publish.lock` 均不存在。

以上新增适配器回归使用受控宿主，不是新一轮真实模型交互；不会扩大前述客户端/版本验收范围。

## 功能验收矩阵

### 会话退出

- `leave` 停止未来收件，普通轮询不能隐式重新加入。
- 未读消息在 leave 后仍保留，不能被 GC 当作已读删除。
- `join` 只恢复已有收件箱及未来订阅，不补收关闭期间的广播。
- 未登记会话执行 leave 不产生幽灵登记；重复 leave 幂等。
- 长期不更新的 `lastSeen` 不会自动关闭会话。
- 正在接收的会话锁不会被 leave 抢占。
- pi `/worktree join` 与 `/worktree leave` 操作已验证。

用例：`tests/core/sessions.test.ts`、`tests/adapters/pi.test.ts`、`tests/cli/maintenance.test.ts`。

### 安全清理

- 默认只有预览，显式 `--apply` 才删除。
- 任意接收者缺少回执时保留事件；关闭或离线不代替确认。
- 保留期按事件创建及所有确认时间中的最晚时间计算，默认七天。
- 事件/回执被清理，会话登记、关闭标记、ref 位置与事件链头保留。
- 消费锁冲突时跳过，不与持锁消费者死锁，不删除其缓存依赖。
- `trash/` 提交 journal 可恢复部分完成的删除。
- 损坏回执、非法保留期、预先取消均不会导致未确认事件被删除。
- 旧状态迁移完成后不再重复导入；已清理的迁移事件不会复活。

用例：`tests/core/cleanup.test.ts`、`tests/core/sessions.test.ts`、`tests/cli/maintenance.test.ts`。

### 可选 daemon

- 同一用户状态根目录单实例，第二个实例不能破坏第一个实例的锁/心跳。
- 发现多个已登记仓库，按未关闭的订阅对同一 ref 集中发布。
- 坏订阅不会阻止其他仓库或 ref。
- 客户端仅信任匹配且新鲜的 daemon/ref 状态；心跳过期或单个 ref 缓存过期会回退。
- 启动清理不会删除未读事件；在一小时维护周期后，新确认事件也会被安全清理。周期用受控时钟推进验证，不真实等待一小时。
- 真实 CLI 子进程发布主分支事件后，Codex/OpenCode 标识的独立接收进程收到同一个事件 ID。
- SIGTERM 正常退出、输出管道故障退出都清除锁/心跳。
- daemon 停止后，客户端仍能自行发现下一次主分支更新。

用例：`tests/core/daemon.test.ts`、`tests/cli/maintenance.test.ts`。

## 复验命令

```sh
npm run typecheck
npm test
npm run build
node --experimental-strip-types --test tests/cli/maintenance.test.ts tests/core/daemon.test.ts
find dist -name '*.js' -exec node --check {} \;
npm pack --dry-run
```

完整运行与安全边界见 [维护指南](maintenance.md)。

## 不包含的验收

- Cursor 尚未进行真实模型交互；未验证上表之外的客户端版本。Codex 项目级 hooks 发现不属于已通过范围。
- 未在 Linux/Windows 做本机系统级运行验收，未安装 launchd/systemd/Windows 服务。macOS/Linux 的 CI 矩阵已配置，但本次未在远端 runner 执行。
- 已测 100/1,000/10,000 个保留广播事件，不覆盖百万事件、巨大仓库或长提交历史；daemon 是显式可选功能，不因本次测试自动启用。
- 未声称恰好一次处理、强杀后自动抢锁、离线会话 TTL 淘汰或自动丢弃未读消息。已送达不等于模型已完成任务。
