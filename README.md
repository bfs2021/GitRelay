# Worktree Agent Sync

多个 coding agent 在同一项目的不同 Git worktree 中并行开发时，将主分支变更自动送给也在修改相关文件的 agent。

保留 npm 包名 `pi-git-worktree` 和原有 pi `/worktree` 命令，但 Git 检测核心不依赖 pi，也可由 Claude Code、Codex、Cursor、OpenCode 和其他宿主复用。无运行时依赖，需要 Node.js 22.19+ 和 Git。

## 工作方式

```text
A 合入 main
  → 任意接收端发现共享 Git ref 更新
  → 发布到用户目录中的仓库共享事件存储
  → B/C 独立检查文件交集，生成相关 diff
  → 各平台适配器向 agent 会话注入上下文或 follow-up
  → B/C 分别记录回执，互不消费对方的消息
```

不是给人弹提示后等人转述，也不会自动覆盖文件、merge 或 rebase。默认无需常驻进程，也可启用可选 daemon 集中监控与清理；各平台共用用户级消息层，既能分享上游变更，也能主动发布跨 agent 协调消息。

首次运行建立主分支基线；之后只投递相关更新。普通 merge、fast-forward、squash、直接提交均可感知。逐个检查 first-parent 更新，不遗漏两次轮询之间先修改后还原的文件。

## 平台支持

| 平台 | 入口 | 投递时机 |
| --- | --- | --- |
| pi | `src/adapters/pi/` | 每 5 秒；忙时排队，空闲时自动触发 agent |
| Claude Code | `src/adapters/claude-code/hooks.json` | lifecycle hooks 注入；Stop 可请求继续 |
| Codex | `src/adapters/codex/hooks.json` | 支持 hooks 的版本中注入；Stop 可请求继续 |
| Cursor | `src/adapters/cursor/hooks.json` | 工具结束后注入；completed stop 可跟进 |
| OpenCode | `src/adapters/opencode/` | 已登记会话每 5 秒检查，idle 后 prompt |
| 通用宿主 | `worktree-sync check/watch` | JSON / NDJSON，由宿主负责会话路由 |

**Hooks 不能唤醒已经空闲的会话。** pi/OpenCode 原生适配器才包含轮询及主动触发。各平台的接口版本、安装步骤和完整边界见 [接入指南](docs/integrations.md)。

## 安装与使用

### pi

```sh
pi install /absolute/path/to/pi-git-worktree
# 重启或 /reload；每个 worktree 都加载本扩展。
```

默认监控本地 `refs/heads/main`，仅在 TUI/RPC 模式自动运行：

```sh
pi --worktree-main-ref refs/heads/develop
pi --worktree-watch=false
```

### 其他 agent 与 CLI

```sh
npm install -g /absolute/path/to/pi-git-worktree
worktree-sync --help

# 首次调用建立基线；相同会话复用同一 ID。
worktree-sync check --cwd /path/to/worktree --session my-agent-session
worktree-sync watch --cwd /path/to/worktree --session my-agent-session
```

按 [接入指南](docs/integrations.md) 合并相应 hooks，或加载 OpenCode 插件。默认不会自动 fetch；监控 `refs/remotes/origin/main` 时需由外部负责更新远端跟踪引用。

### 跨 coding agent 共享消息

默认状态目录：`~/.local/state/worktree-agent-sync/repos/<repo-id>/`，支持 `XDG_STATE_HOME` 和绝对路径覆盖 `WORKTREE_SYNC_STATE_DIR`。同一仓库的 worktree 共享事件，不同 clone 按 Git common directory 的真实路径隔离。

```sh
# 接收方先通过原生插件/hooks 或 check 登记会话。
worktree-sync check --cwd /project/worktree-B --agent codex --session codex-B

# Claude Code 的 agent 在自己的 worktree 发布消息。
worktree-sync send --cwd /project/worktree-A --agent claude-code --session claude-A \
  --file src/config.ts --message '接口约定有变化，请评估是否需要适配。'

worktree-sync sessions --cwd /project/worktree-A
```

`--file` 可重复；省略时广播给其他已登记会话，提供时只投递给当前有同路径修改的工作区。新会话不补收加入前的广播。完整目录结构、回执语义和迁移说明见 [共享消息指南](docs/shared-messages.md)。

### 会话退出、清理和可选 daemon

```sh
worktree-sync leave --agent codex --session codex-B --cwd /project/worktree-B
worktree-sync join  --agent codex --session codex-B --cwd /project/worktree-B

worktree-sync gc --cwd /project/worktree-A          # 默认预览，保留期 7 天
worktree-sync gc --cwd /project/worktree-A --apply  # 只删除所有接收者已确认的过期事件

worktree-sync daemon        # 可选，集中监控已登记仓库；启动时及每小时安全清理
worktree-sync daemon status
```

退出不会确认未读消息，普通关闭/重载仍视为离线；清理保留未读事件、会话和监控位置。daemon 停止或失效时，接收端自动回退自行监控。详情见 [维护指南](docs/maintenance.md)，验收范围见 [验收记录](docs/acceptance.md)。

### Skills

[`skills/worktree-coordination/SKILL.md`](skills/worktree-coordination/SKILL.md) 指导 agent 重读本地状态、检查完整 diff、判断影响、保护未完成修改和验证适配结果。pi 安装时自动加载；其他平台可安装到各自 skills 目录。

## pi worktree 管理

| 命令 | 功能 |
| --- | --- |
| `/worktree` | 操作菜单 |
| `/worktree list` | 路径、分支、提交和状态 |
| `/worktree add` | 新建分支或使用已有本地分支，可指定新分支起点 |
| `/worktree remove` | 二次确认后删除工作区，保留分支 |
| `/worktree leave` | 显式停止当前会话订阅，保留未读消息 |
| `/worktree join` | 显式重新加入并启动接收器 |

路径在对话框填写，支持空格、中文和绝对路径；相对路径以当前 pi 目录为基准，不展开 `~` 或环境变量。创建后在新目录另启 agent，不改变当前 pi 会话目录。

删除不使用 `--force`，拒绝删除主工作区、锁定工作区及当前 pi 所在 worktree（含子目录/符号链接入口）。修改、暂存或未跟踪文件由 Git 阻止删除；**被 Git 忽略的文件仍可能被一起删除，请自行备份**。其他 agent 进程所在目录不在此删除保护范围内。

## 项目结构

```text
src/
├── core/
│   ├── git.ts             # Git/worktree 操作
│   ├── changes.ts         # 文件交集、提交范围、diff、事件格式
│   ├── store.ts           # 用户状态目录、仓库身份、原子写入和锁
│   ├── mailbox.ts         # 会话登记、广播事件和消息格式
│   ├── publisher.ts       # 共享 ref 同步与事件链
│   ├── sessions.ts        # 显式加入/退出订阅
│   ├── cleanup.ts         # 确认事件清理与中断恢复
│   ├── daemon-state.ts    # 单实例心跳与回退判断
│   ├── daemon.ts          # 可选多仓库监控及定期清理
│   └── consumer.ts        # 相关性筛选、独立回执与 daemon 委托
├── adapters/
│   ├── pi/                # 原生命令、生命周期、follow-up
│   ├── claude-code/       # lifecycle hook 配置
│   ├── codex/             # lifecycle hook 配置
│   ├── cursor/            # hook 配置
│   ├── opencode/          # 原生插件、会话登记与 idle 投递
│   └── hooks.ts           # hook 输入校验和协议转换
└── cli/main.ts            # 通用 CLI / hook runner
scripts/build.mjs            # 用 Node 内置类型擦除生成可发布 JS
dist/                        # 构建产物（不提交）
skills/worktree-coordination/
docs/integrations.md
tests/{core,adapters,cli}/
index.ts                    # 旧 pi 加载路径兼容入口
```

核心只依赖 Node 标准库和本机 Git。添加平台适配器不需要更改 Git 检测逻辑；不为未来扩展引入 monorepo 或发布多个包。

## 测试与边界

```sh
npm run build
npm test
npm pack --dry-run
```

测试使用临时仓库和隔离状态目录，覆盖多 worktree 合并、文件交集、改后还原、重命名、大 diff、历史改写、跨 agent 广播、独立回执、旧状态迁移、并发重试、pi 排队去重、OpenCode idle 投递、各 hook 协议及独立 CLI 进程间通信。真实客户端端到端验证仍需在对应版本上执行。

这是文件级变更感知，不是语义冲突检测或同步引擎。无事件不代表没有跨文件影响；事件送达也不代表 agent 已完成适配。正常运行去重，崩溃边界允许重发；CLI/hooks 输出成功后确认投递，宿主是否实际接收需要宿主确认。只清理所有接收者已确认、超过保留期的事件；未读消息和关闭标记保留。daemon 不会突破宿主的空闲唤醒限制。更多限制与恢复步骤见 [接入指南](docs/integrations.md#状态恢复和限制)。
