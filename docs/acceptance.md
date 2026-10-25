# 本机验收记录

## 范围与环境

本次验收覆盖显式会话退出/重入、安全事件清理，以及可选 daemon 的实际进程生命周期。使用隔离状态目录和临时 Git worktree，不清理用户现有事件，不安装系统服务，不调用收费模型。

本机环境：macOS，Node.js `v22.23.2`，Git `2.54.0 (Apple Git-157)`。

## 执行结果

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 全量测试 | 53/53 通过 | `npm test` |
| daemon / CLI 核心验收重复执行 | 7/7 连续三轮通过 | 构建后运行 `tests/cli/maintenance.test.ts` 与 `tests/core/daemon.test.ts` |
| 构建后 JS 语法检查 | 通过 | `node --check` 检查 `dist/` 下所有 JS |
| npm tarball 离线安装 | 通过 | 临时 prefix，`--offline --ignore-scripts --omit=optional` |
| 安装后的 CLI 闭环 | 通过 | 登记 → 跨 agent 发送/接收 → leave → 确认事件 GC |
| 安装后的 daemon | 通过 | 启动真实进程 → status 为 true → SIGTERM → status 为 false，锁和心跳清除 |
| 安装后的 pi 扩展加载 | 通过 | 当前 pi 的真实 extension loader 成功注册 `/worktree` |

手动直接运行测试文件前应先 `npm run build`，因为 CLI 验收执行的是发布用 `dist/cli/main.js`，不是 TypeScript 源文件。

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
npm test
npm run build
node --experimental-strip-types --test tests/cli/maintenance.test.ts tests/core/daemon.test.ts
find dist -name '*.js' -exec node --check {} \;
npm pack --dry-run
```

完整运行与安全边界见 [维护指南](maintenance.md)。

## 不包含的验收

- 未登录并逐一执行五个真实 agent 客户端的模型交互；pi/OpenCode 接收调用及 hook 协议使用受控适配器测试，只有 pi 扩展加载器进行了真实加载验收。
- 未在 Linux/Windows 做系统级运行验收，未安装 launchd/systemd/Windows 服务。
- 未做大规模性能基准；daemon 是显式可选功能，不因本次测试自动启用。
- 未声称恰好一次处理、强杀后自动抢锁、离线会话 TTL 淘汰或自动丢弃未读消息。已送达不等于模型已完成任务。
