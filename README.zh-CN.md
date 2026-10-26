# GitRelay

[English](README.md) | [简体中文](README.zh-CN.md)

面向 Git 分支与工作树的多 coding agent 协作工具：投递相关上游变更、共享协作消息、监控本地与 GitHub 分支状态，并支持显式开启的快进同步。pi 还提供交互式工作树管理。

npm 包名为 `git-relay`，提供同名 CLI，并保留 `worktree-relay`、`worktree-sync` 和 pi `/worktree` 命令兼容已有配置。Git 检测核心不依赖 pi，也可由 Claude Code、Codex、Cursor、OpenCode v2 和其他宿主复用。无运行时依赖，需要 Node.js 22.19+ 和 Git。

原 `worktree-relay` / `pi-git-worktree` 用户需将安装源改为新包或新目录；状态目录、`WORKTREE_SYNC_*` 环境变量和会话身份保持不变，不迁移或清空既有消息。下面示例统一使用 `git-relay`，旧命令别名仍可使用。

## 按需求选择入口

| 需求 | 入口 | 是否修改本地分支 |
| --- | --- | --- |
| 接收相关上游 diff 和 agent 消息 | `check` / `watch`、原生适配器或 hooks | 否 |
| 查看本地与 GitHub 实时分支状态 | `status --github` | 否 |
| 持续观察状态变化 | `status --github --watch` | 否 |
| fetch 并快进更新当前检出分支 | `status --auto-sync`，可加 `--watch` | 是，需显式开启 |
| 在 pi 中管理工作树 | `/worktree` | 显式创建或删除 |
| 出现在 Codex 插件列表 | 构建、注册并安装 Codex 插件 | 安装不会开启同步 |

`watch` 接收消息事件，`status --watch` 观察分支状态快照，两者用途不同。改名兼容、旧插件迁移和更新步骤见 [迁移指南](docs/migration.md)。

## 工作方式

```text
A 合入 main
  → 任意接收端发现共享 Git ref 更新
  → 发布到用户目录中的仓库共享事件存储
  → B/C 独立检查文件交集，生成相关 diff
  → 各平台适配器向 agent 会话注入上下文或 follow-up
  → B/C 分别记录回执，互不消费对方的消息
```

相关变更直接投递到 agent 会话；接收通知本身不修改代码。自动同步默认关闭，仅在显式开启后 fetch 并尝试快进更新。默认无需常驻进程，也可启用可选 daemon 集中监控与清理；各平台共用用户级消息层，既能分享上游变更，也能主动发布跨 agent 协调消息。

首次运行建立主分支基线；之后只投递相关更新。普通 merge、fast-forward、squash、直接提交均可感知。常规 first-parent 前进逐个检查，不遗漏两次轮询之间先修改后还原的文件；旧位置不在当前 first-parent 链上时只比较前后快照，不重放已有变更。

## 平台支持

| 平台 | 入口 | 投递时机 |
| --- | --- | --- |
| pi | `src/adapters/pi/` | 每 5 秒；忙时排队，空闲时自动触发 agent |
| Claude Code | `src/adapters/claude-code/hooks.json` | lifecycle hooks 注入；Stop 可请求继续 |
| Codex | `src/adapters/codex/hooks.json` | 支持 hooks 的版本中注入；Stop 可请求继续 |
| Cursor | `src/adapters/cursor/hooks.json` | 工具结束后注入；completed stop 可跟进 |
| OpenCode v2 | `src/adapters/opencode/` | 每 5 秒检查；宿主持久队列，忙时排队、空闲时唤醒 |
| 通用宿主 | `git-relay check/watch` | JSON / NDJSON，由宿主负责会话路由 |

**Hooks 不能唤醒已经空闲的会话。** pi/OpenCode 原生适配器才包含轮询及主动触发。各平台的接口版本、安装步骤和完整边界见 [接入指南](docs/integrations.md)。

## 安装与使用

### pi

```sh
pi install /absolute/path/to/GitRelay
# 重启或 /reload；每个 worktree 都加载本扩展。
```

默认监控本地 `refs/heads/main`，仅在 TUI/RPC 模式自动运行：

```sh
pi --worktree-main-ref refs/heads/develop
pi --worktree-watch=false
```

### 其他 agent 与 CLI

```sh
npm install -g /absolute/path/to/GitRelay
git-relay --help

# 首次调用建立基线；相同会话复用同一 ID。
git-relay check --cwd /path/to/worktree --session my-agent-session
git-relay watch --cwd /path/to/worktree --session my-agent-session
```

按 [接入指南](docs/integrations.md) 合并相应 hooks，或加载 OpenCode 插件。默认不会自动 fetch；监控 `refs/remotes/origin/main` 时需由外部负责更新远端跟踪引用。

### 本地与 GitHub 云端分支状态

```sh
# 本地状态，无需 gh；默认选择当前分支，也可指定任意分支名。
git-relay status --branch main

# 先安装 GitHub CLI 并运行 gh auth login；直接查询云端，不依赖本机 fetch。
git-relay status --branch main --github
git-relay status --branch main --github --watch --interval-ms 30000

# 多远端/fork 时显式选择目标仓库；变化广播给本仓库已登记的其他 agent。
git-relay status --branch main --github --repo owner/repo --watch \
  --agent cli --session branch-monitor
```

输出 NDJSON：当前工作区分支、提交、是否有未提交/未跟踪文件，目标本地分支提交、相对本机上游引用的 ahead/behind，以及 GitHub 同名分支的实时提交和是否与本地一致。默认仓库由 `gh` 解析，支持 `--repo [HOST/]OWNER/REPO`。`--branch` 是分支名，不是完整 ref；省略时跟随当前分支，detached HEAD 必须显式指定。

`--watch` 首次输出快照，此后只输出状态变化；默认本地每 5 秒、GitHub 每 30 秒检查（云端最短 5 秒），每轮结束后等待。加 `--session` 才会将基线之后的变化广播到现有消息层，宿主仍需接收；重启重新建立基线，不补发停机期间的状态变化。未指定 `--session` 时仅输出。

云端查询失败时保留本地结果并输出 `github.error`，单次查询退出码为 1，持续监控会重试。不存在的分支提交为 `null`，不把权限/网络故障当成分支删除。ahead/behind 基于本机上游缓存，可能过时；云端不同提交只表示不一致，不推断谁领先。默认只读；启用下述自动同步后才会 fetch 和快进更新本地分支，不合并 PR，也不替代原有的相关 diff 投递。详见 [接入指南](docs/integrations.md#local-and-github-branch-monitoring)。

### 安装到 Codex 插件列表

hooks 和 App 本地操作本身不会生成插件卡片；插件列表需要插件清单、marketplace 注册和安装。本项目现在包含 `.codex-plugin/plugin.json` 和 `.agents/plugins/marketplace.json`。

```sh
npm ci --ignore-scripts
npm run build:codex-plugin
codex plugin marketplace add /absolute/path/to/GitRelay
codex plugin add git-relay@git-relay-local
codex plugin list --marketplace git-relay-local --json
```

打开 App 的「插件 → 个人」，刷新后在 **GitRelay** 来源下查看同名插件；如果 App 尚未重载配置，重启后查看。本地安装包包含 CLI、skills 和 hooks，无需全局 npm 安装，也不携带 node_modules。源码变化后重新构建并再次运行安装命令更新缓存。安装/启用不等于信任 hooks：在 Codex 的 `/hooks` 中检查并确认；不绕过宿主信任流程。安装不会开启自动同步。

插件详情页包含 GitRelay 图标、三个快捷提示，以及 **GitRelay**、**GitRelay Sync**、**GitRelay Help**、**GitRelay Coordination** 四个技能。插件文案、技能、运行提示和 App 操作名称统一为英文，本文件保留中文。页面布局和来源标记由 Codex 控制；本地安装不等于已发布 Git 来源的 marketplace。

插件安装后不要重复配置同一套项目级或用户级 hooks。本项目已移除旧的 `.codex/hooks.json`，统一由插件提供；未安装插件的用户仍可手动使用 `src/adapters/codex/hooks.json` 模板。

### Codex App

本项目附带 `.codex/environments/environment.toml`，预置「Branch status」「Monitor branches (read-only)」「Auto-sync (fast-forward)」三个本地操作，命令在 App 集成终端运行。状态操作还会刷新 `.codex/git-relay-status.md`，可在 App 文件面板打开。自动同步操作只有被主动运行时才开启；停止对应终端进程即停止，启动只读监控不会关闭另一个仍在运行的同步进程。

Codex hook 模板已启用 `--branch-status`：SessionStart/UserPromptSubmit 提供本地状态与 UI `systemMessage`，收到协作消息也显示摘要。hooks 不访问 GitHub、不启动后台监控、不自动同步；云端查询与同步使用上述显式操作。插件内 hooks 使用安装包的 CLI，无需全局安装；重开聊天后用 `/hooks` 确认发现和信任状态。

状态页是单次查询快照；实时变化看「Monitor branches (read-only)」终端。App 对配置的发现、信任与 UI 呈现需在当前版本确认，生成配置不代表已加载。

### 自动同步开关（默认关闭）

```sh
# 先为当前分支配置好远端 upstream，再开启自动 fetch + 快进更新。
git-relay status --github --watch --auto-sync

# 关闭：重启监控时省略 --auto-sync，或显式指定。
git-relay status --github --watch --no-auto-sync
```

单次 `status --auto-sync` 也可执行一次同步。仅更新 `--cwd` 中当前检出的目标分支，默认目标固定为启动时的分支；不会切换分支或修改其他 worktree。来源始终是 Git 配置的远端 upstream，可与本地分支不同名；`--repo` 不可与自动同步同时使用。GitHub 查询只是附加观察，不决定同步来源。Git fetch 使用 Git 自身的认证配置，必要时先运行 `gh auth setup-git`。

每轮先刷新该 upstream 的远端跟踪引用，再仅以 fast-forward 更新干净的本地分支。未提交/未跟踪修改、分支分叉、正在进行的 merge/rebase 等会阻止更新；被忽略文件也不会被覆盖。不 stash、reset、rebase、push 或创建 merge commit。本地领先时保留本地提交。输出 `sync.state` 为 `updated`、`up-to-date`、`ahead`、`blocked` 或 `error`，附带 remote/reason；单次阻止或失败退出码为 1，持续监控后续重试。网络模式默认间隔 30 秒，最短 5 秒。

开关仅对当前命令生效，不持久保存。开启后会实际修改本地文件，请勿同时在同一 worktree 手动切换分支或运行其他 Git 写操作；关闭正在运行的监控后，再以关闭开关的命令启动。

### 跨 coding agent 共享消息

默认状态目录：`~/.local/state/worktree-agent-sync/repos/<repo-id>/`，支持 `XDG_STATE_HOME` 和绝对路径覆盖 `WORKTREE_SYNC_STATE_DIR`。同一仓库的 worktree 共享事件，不同 clone 按 Git common directory 的真实路径隔离。

```sh
# 接收方先通过原生插件/hooks 或 check 登记会话。
git-relay check --cwd /project/worktree-B --agent codex --session codex-B

# Claude Code 的 agent 在自己的 worktree 发布消息。
git-relay send --cwd /project/worktree-A --agent claude-code --session claude-A \
  --file src/config.ts --message '接口约定有变化，请评估是否需要适配。'

git-relay sessions --cwd /project/worktree-A
```

`send` 只发送，不建立接收订阅；发送方需要收件时应先通过插件/hooks、`check` 或 `join` 登记。`--file` 可重复；省略时广播给其他已登记会话，提供时只投递给当前有同路径修改的工作区。新会话不补收加入前的广播。完整目录结构、回执语义和迁移说明见 [共享消息指南](docs/shared-messages.md)。

### 会话退出、清理和可选 daemon

```sh
git-relay leave --agent codex --session codex-B --cwd /project/worktree-B
git-relay join  --agent codex --session codex-B --cwd /project/worktree-B

git-relay gc --cwd /project/worktree-A          # 默认预览，保留期 7 天
git-relay gc --cwd /project/worktree-A --apply  # 只删除所有接收者已确认的过期事件

git-relay daemon        # 可选，集中监控已登记仓库；启动时及每小时安全清理
git-relay daemon status
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

路径在对话框填写，支持空格、中文和绝对路径；相对路径以当前 pi 目录为基准，不展开 `~` 或环境变量。创建后在新目录另启 agent，不改变当前 pi 会话目录。起点存在同名分支和标签时拒绝猜测，请使用 `refs/heads/...` 或 `refs/tags/...` 完整引用。

删除不使用 `--force`，拒绝删除主工作区、锁定工作区及当前 pi 所在 worktree（含子目录/符号链接入口）。修改、暂存或未跟踪文件由 Git 阻止删除；**被 Git 忽略的文件仍可能被一起删除，请自行备份**。其他 agent 进程所在目录不在此删除保护范围内。

## 项目结构

```text
src/
├── core/
│   ├── git.ts             # Git/worktree 操作
│   ├── branch-status.ts   # 本地/上游状态与可选 GitHub CLI 查询
│   ├── branch-sync.ts     # 显式 fetch 与受保护的快进同步
│   ├── status-format.ts   # Markdown 状态快照
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
│   ├── opencode/          # v2 Promise 插件、会话登记与持久队列投递
│   └── hooks.ts           # hook 输入校验和协议转换
└── cli/main.ts            # 通用 CLI / hook runner
scripts/build.mjs            # 用 Node 内置类型擦除生成可发布 JS
scripts/build-codex-plugin.mjs # 独立 Codex 插件打包
scripts/benchmark.mjs        # 隔离事件存储的规模基准
.codex-plugin/plugin.json    # 插件身份及显示信息
.agents/plugins/marketplace.json # 本地插件目录
.codex/environments/environment.toml # App 终端操作
.github/workflows/check.yml  # macOS/Linux、Node 22.19/24 验证
dist/                        # 构建产物（不提交）
skills/worktree-coordination/
docs/{integrations,migration,maintenance,acceptance}.md
tests/{core,adapters,cli}/
index.ts                    # 旧 pi 加载路径兼容入口
```

默认运行仅依赖 Node 标准库和本机 Git；GitHub 实时查询额外需要已认证的 `gh` 可执行程序。添加平台适配器不需要更改 Git 检测逻辑；不为未来扩展引入 monorepo 或发布多个包。

## 测试与边界

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run
npm run benchmark
```

类型检查覆盖核心、适配器和测试，构建方式不变。TypeScript、Node 与宿主类型只属于开发依赖；pi 的开发依赖中固定覆盖已修复的 `undici`，不新增运行时依赖。CI 在 macOS/Linux 的 Node `22.19.0` 和 `24` 上运行类型检查、测试、打包预检。

性能基准使用 3 个会话、100/1,000/10,000 个保留广播事件，对比有无 daemon 的空轮询与 32 条离线消息恢复；不读取用户消息、不调用模型。结果和限制见 [性能记录](docs/performance.md)。

测试使用临时仓库和隔离状态目录，覆盖多 worktree 合并、文件交集、路径规范化、first-parent 非连续历史、改后还原、重命名、大 diff、历史改写、跨 agent 广播、独立回执、旧状态迁移、并发重试、pi 排队去重、OpenCode v2 持久队列与取消、各 hook 协议及独立 CLI 进程间通信。已在本机 pi `1.4.0`、Codex CLI `0.164.0`、Claude Code `2.1.310`、OpenCode `2.1.2` 验证真实模型收件与去重，详见 [验收记录](docs/acceptance.md)。这不代表其他版本或 Cursor 已通过真实验收。

提供文件级变更感知和可选快进同步，不提供语义冲突检测。无事件不代表没有跨文件影响；事件送达也不代表 agent 已完成适配。正常运行去重，崩溃边界允许重发；CLI/hooks 输出成功后确认投递，宿主是否实际接收需要宿主确认。只清理所有接收者已确认、超过保留期的事件；未读消息和关闭标记保留。daemon 不会突破宿主的空闲唤醒限制。更多限制与恢复步骤见 [接入指南](docs/integrations.md#state-recovery-and-limitations)。
