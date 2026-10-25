# 会话退出、安全清理与可选 daemon

这三个能力共用现有的用户级消息存储。不启动 daemon 也能继续使用插件、hooks 和手动清理。

## 1. 明确退出，而不是猜测会话死亡

```sh
worktree-sync leave --cwd /project/worktree-B --agent codex --session native-session-B
worktree-sync join  --cwd /project/worktree-B --agent codex --session native-session-B
worktree-sync sessions --cwd /project/worktree-B
```

pi 也提供 `/worktree leave` 和 `/worktree join`。退出时先停止当前 pi 接收器，再关闭订阅。

- `leave` 保存 `closedAt`，未来广播和主分支事件不再把该会话作为接收者。
- 已有未读事件、回执、基线全部保留。**退出不等于已读，也不使未读事件变得可清理。**
- 普通 `check`、hook 或重新启动接收器不会隐式打开关闭的会话；必须显式 `join`。
- 重新加入保留旧收件箱和去重信息，但不补收关闭期间未发给该会话的广播。
- 未登记的会话执行 `leave` 不会生成新登记。
- 正常关闭终端、重载扩展、暂时离线并不等于永久退出；本项目不把这些生命周期自动映射为 `leave`，也不按 `lastSeen` 自动淘汰会话。
- 已经进入宿主队列的消息不能保证撤回；退出与正在进行的接收冲突时，操作返回 busy，请稍后重试，不强行覆盖锁。

命令按 worktree、ref、agent 类型和原生 session ID 精确定位；非默认主分支需传对应 `--ref`。删除 worktree 前应先处理收件箱并显式退出；删除目录本身不会确认其消息。

`closedAt` 记录作为小型 tombstone 保留，不自动删除，以免后续轮询把已退出的同一 ID 当作新会话重新加入。其他平台的 agent 可以按用户要求通过 CLI 执行退出；不自动改写宿主的结束 hooks。

## 2. 只清理已确认事件

```sh
# 默认预览，不删除。默认保留期为 7 天。
worktree-sync gc --cwd /project/worktree-A
worktree-sync gc --cwd /project/worktree-A --dry-run

# 确认预览后再应用。
worktree-sync gc --cwd /project/worktree-A --apply

# 显式要求立即清理已确认事件（仍不会删除未读消息）。
worktree-sync gc --cwd /project/worktree-A --apply --retention-days 0
```

清理一个事件必须同时满足：

1. 发布时的每个接收者都有合法的 `delivered` 或 `irrelevant` 回执。
2. 事件创建时间和所有确认时间中的**最晚时间**已超过保留期。刚被离线会话读取的旧事件不会立即因“事件很老”而被删除。
3. 接收者的旧状态迁移已经完成，防止被清理的历史事件再次导入。
4. 所有接收者消费锁均可获取，避免在某个进程仍缓存事件时删除回执，引起重复投递。

报告字段：

- `dryRun`：是否只是预览。
- `eligible`：本轮可清理的事件 ID。
- `removed`：实际清理成功的事件 ID。
- `kept`：保留项及原因：`unconfirmed`、`retention`、`migration`、`busy`。

关闭、长期离线、worktree 被删除，都不能替代收件确认。缺失回执就保留；损坏的事件或回执会报错，不能默认为已确认。没有任何接收者的事件在超过保留期后可清理。

### 并发与中断恢复

清理与发布共用仓库级 `publish.lock`，并在处理每个事件时获取其接收会话的锁。仓库锁冲突会返回 busy，可稍后重试；事件的接收锁冲突则跳过该事件并在报告中标为 busy。不等待可能造成锁顺序死锁的消费者，也不抢占锁。

实际删除前，将已批准事件从 `events/` 原子移动到 `trash/`，再删除对应回执和 journal 文件。这个移动是删除提交点：

- 移动前出错，原事件和回执保留。
- 移动后中断，只有已批准清理的事件进入 `trash/`；下一次 `gc --apply` 会完成剩余删除。
- `gc` 预览也会列出待完成的 journal，但不执行删除。
- 已经提交删除的 journal 不会因后来增加保留期而撤销。

不会删除分支监控位置、会话登记、关闭标记或旧迁移源文件。请勿手动把未读事件移入 `trash/`，也不要在清理时手动修改事件或回执。

## 3. 可选 daemon

```sh
# 单个用户状态根目录只有一个实例；前台运行，便于交给 supervisor。
worktree-sync daemon

# 默认每 5000 ms 检查，默认已确认事件保留 7 天。
worktree-sync daemon --interval-ms 5000 --retention-days 7

worktree-sync daemon status
```

`daemon` 不受当前 `--cwd` 限制：它发现状态目录中已登记的所有仓库，按尚未关闭的会话订阅，集中监控各仓库的 ref。

- 同仓库、同 ref 每轮只同步一次；不创建虚假的接收会话。
- 已有客户端检测到匹配的 daemon 锁、进程和新鲜心跳，以及新鲜的 ref 检查记录后，使用缓存的 ref 位置，不再自行同步该 ref。
- 新会话或缺失/过时的 ref 缓存仍会自行同步，以正确建立加入时的基线。普通接收检查遇到锁竞争会跳过本轮，由下一次轮询/hook 重试；空 stdout 不保证已经登记成功，手动接入可用 `join` 和 `sessions` 确认登记。
- daemon 不可用、心跳过期或某个 ref 长期同步失败时，客户端自动回退到原来的自行检查方式。
- 单个坏仓库或失效订阅不会阻止其他仓库/ref 的更新。
- 启动时以及之后**每小时**执行一次确认事件清理，使用相同的保留期和安全规则。忙的事件/仓库可能留到下次维护或手动 `gc`。
- daemon 不执行 fetch，不处理业务回复，也不调用模型。每个宿主的接收适配器仍然负责本地文件相关性检查、消息注入和回执。

### 后台运行与退出

macOS/Linux 可以交给已有的服务管理器，或者显式使用 shell 启动：

```sh
umask 077
nohup worktree-sync daemon > "$HOME/worktree-sync-daemon.log" 2>&1 &
daemon_pid=$!
# 使用当前启动器持有的进程句柄退出，不盲信旧 PID 文件。
kill -TERM "$daemon_pid"
```

Ctrl-C / SIGTERM 会停止轮询、取消正在执行的 Git 检查，清除本实例的心跳和进程锁。输出管道失败也会走资源清理。一个后启动的冲突实例不能删除正在运行实例的锁或心跳。

本版不安装 launchd/systemd/Windows 服务，不自动 detached，也不提供按磁盘 PID 盲目 kill 的 stop 命令。Windows 可在前台运行或使用自己的服务管理器。daemon 不会自动启动；正常使用无需常驻进程。

### 文件与恢复

用户状态根目录新增：

```text
<state-root>/daemon.lock     # 单实例锁，含 PID 与实例 token
<state-root>/daemon.json     # 心跳、实例 token、轮询间隔
<repo-store>/trash/          # 已批准删除的恢复 journal
```

心跳新鲜窗口为 `max(15 秒, 3 × interval-ms)`；还要验证该 ref 最近同步成功，防止活着的 daemon 掩盖坏订阅。`daemon status` 是本地活性提示，不是进程身份认证或宿主会话在线保证。

被 SIGKILL 或断电中断仍可能留下锁；确认原进程已退出后只移除对应 `.lock`。不会自动抢锁。所有参与的 CLI/插件需要升级并重载到支持新状态字段的版本。

## 验收

自动化用例与本机执行结果见 [验收记录](acceptance.md)。这些验收使用临时 Git 仓库、隔离状态目录和真实 CLI 子进程，不修改用户现有消息或安装后台服务。
