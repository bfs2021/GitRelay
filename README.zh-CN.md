# GitRelay

[English](README.md) | [简体中文](README.zh-CN.md)

[贡献指南（英文）](CONTRIBUTING.md) | [MIT 许可证](LICENSE)

面向 Git 分支与工作树的多 coding agent 协作工具：投递相关上游变更、共享协作消息、监控本地与 GitHub 分支状态，自动分支同步暂不可用。pi 还提供交互式工作树管理。

npm 包名为 `git-relay`，提供同名 CLI，并保留 `worktree-relay`、`worktree-sync` 和 pi `/worktree` 命令兼容已有配置。Git 检测核心不依赖 pi，也可由 Claude Code、Codex、Cursor、OpenCode v2 和其他宿主复用。无运行时依赖，需要 Node.js 22.19+ 和 Git。

原 `worktree-relay` / `pi-git-worktree` 用户需将安装源改为新包或新目录；状态根目录、`WORKTREE_SYNC_*` 环境变量和会话身份保持不变，旧消息不会被清空。旧版按路径保存的仓库状态需要明确选择迁移或从空状态开始，操作前请核对数据归属。下面示例统一使用 `git-relay`，旧命令别名仍可使用。

## 按需求选择入口

| 需求 | 入口 | 是否修改本地分支 |
| --- | --- | --- |
| 接收相关上游 diff 和 agent 消息 | `check` / `watch`、原生适配器或 hooks | 否 |
| 查看本地与 GitHub 实时分支状态 | `status --github` | 否 |
| 持续观察状态变化 | `status --github --watch` | 否 |
| 自动分支同步 | 暂不可用；`--auto-sync` 返回 blocked | 否 |
| 在 pi 中管理工作树 | `/worktree` | 显式创建；自动移除暂不可用 |
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

相关变更直接投递到 agent 会话；接收通知本身不修改代码。自动同步因并发切换分支可能错更新而暂不可用。默认无需常驻进程，也可启用可选 daemon 集中监控与清理；各平台共用用户级消息层，既能分享上游变更，也能主动发布跨 agent 协调消息。

首次运行建立主分支基线；之后只投递相关更新。普通 merge、fast-forward、squash、直接提交均可感知。常规 first-parent 前进逐个检查，不遗漏两次轮询之间先修改后还原的文件；旧位置不在当前 first-parent 链上时只比较前后快照，不重放已有变更。

## 平台支持

| 平台 | 入口 | 投递时机 |
| --- | --- | --- |
| pi | `src/adapters/pi/` | 每 5 秒检查；忙时保留事件，空闲时自动触发 agent |
| Claude Code | `src/adapters/claude-code/hooks.json` | lifecycle hooks 注入；Stop 可请求继续 |
| Codex | `src/adapters/codex/hooks.json` | 支持 hooks 的版本中注入；Stop 可请求继续 |
| Cursor | `src/adapters/cursor/hooks.json` | 工具结束后注入；completed stop 可跟进 |
| OpenCode v2 | `src/adapters/opencode/` | 每 5 秒检查；宿主持久队列，忙时排队、空闲时唤醒 |
| 通用宿主 | `git-relay check/watch` | JSON / NDJSON，由宿主负责会话路由 |

**Hooks 不能唤醒已经空闲的会话。** pi/OpenCode 原生适配器才包含轮询及主动触发。各平台的接口版本、安装步骤和完整边界见 [接入指南](docs/integrations.md)。

## 安装与使用

### 自动配置

构建并安装 CLI 后，先运行 `git-relay install --dry-run` 查看客户端检测结果，再用 `git-relay install` 配置受支持的客户端。可重复传入 `--platform NAME` 选择平台，或使用 `--skip NAME` 跳过平台。`git-relay uninstall --platform NAME` 只处理安装器拥有的配置，配合 `--dry-run` 可预览。Codex 自动配置仅在用户级 hooks 文件不存在时安装，仍需在 `/hooks` 中单独信任。Claude 启动器可在 skills 不变且原安装时的 Node 可执行文件仍兼容时升级运行时；旧版安装及 skills 变更需手动迁移。配置冲突、未验证版本、升级限制和保留文件见 [接入指南](docs/integrations.md#automatic-setup)。

即使使用 `--dry-run`，pi 检测也会运行 `pi --version`；安装 pi 适配时还会启动客户端验证。pi 自身可能读取设置或清理其托管安装的暂存目录。可使用 `--skip pi` 排除这些操作，详情见[接入指南](docs/integrations.md#automatic-setup)。

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

工作区是否有改动遵循 Git status 及其子模块忽略设置；显示干净时，被忽略的子模块内仍可能有修改。

`--watch` 首次输出快照，此后只输出状态变化；默认本地每 5 秒、GitHub 每 30 秒检查（云端最短 5 秒），每轮结束后等待。加 `--session` 才会将基线之后的变化广播到现有消息层，宿主仍需接收；重启重新建立基线，不补发停机期间的状态变化。未指定 `--session` 时仅输出。

状态快照超过消息层 64 KiB 序列化上限时仍会在本地显示，但不会广播。广播失败可能已经完成，监控不会自动重试相同快照；手动重试前请检查消息状态。诊断尽力写入 stderr，输出流不可用时可能丢失。详见 [监控限制](docs/integrations.md#local-and-github-branch-monitoring)。

云端查询失败时保留本地结果并输出 `github.error`，单次查询退出码为 1，持续监控会重试。不存在的分支提交为 `null`，不把权限/网络故障当成分支删除。ahead/behind 基于本机上游缓存，可能过时；云端不同提交只表示不一致，不推断谁领先。查询保持只读；自动同步暂不可用，不替代原有的相关 diff 投递。详见 [接入指南](docs/integrations.md#local-and-github-branch-monitoring)。

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

本项目附带 `.codex/environments/environment.toml`，预置「Branch status」「Monitor branches (read-only)」「Auto-sync (fast-forward)」三个本地操作，命令在 App 集成终端运行。状态操作还会刷新 `.codex/git-relay-status.md`，可在 App 文件面板打开。自动同步操作目前返回 blocked；升级不会停止已运行的旧版本同步进程，需停止对应终端，启动只读监控不会关闭它。

Codex hook 模板已启用 `--branch-status`：SessionStart/UserPromptSubmit 提供本地状态与 UI `systemMessage`，收到协作消息也显示摘要。hooks 不访问 GitHub、不启动后台监控、不自动同步；云端查询使用上述显式操作；自动同步暂不可用。插件内 hooks 使用安装包的 CLI，无需全局安装；重开聊天后用 `/hooks` 确认发现和信任状态。

状态页是单次查询快照；实时变化看「Monitor branches (read-only)」终端。App 对配置的发现、信任与 UI 呈现需在当前版本确认，生成配置不代表已加载。

### 自动分支同步暂不可用

并发切换分支可能使旧版同步更新错误分支。`status --auto-sync` 现返回 `sync.state: "blocked"`，不会 fetch 或更改工作树；单次执行退出码为 1，`--watch` 继续只读监控，`--no-auto-sync` 保持可用。升级不会停止已运行的旧版同步进程，请在各自终端停止；启动新的只读监控或停止 daemon 不能停止旧进程。

手动替代方案及并发限制见[迁移说明](docs/migration.md#monitoring-and-automatic-synchronization)：先停止该工作树中的并发 Git 操作、确认分支和上游，再由用户决定是否 fetch 和快进合并。手动 Git 也有并发竞态，不能将其视为自动恢复保证。

### 跨 coding agent 共享消息

默认状态目录：`~/.local/state/worktree-agent-sync/repos/<repo-id>/`，支持 `XDG_STATE_HOME` 和绝对路径覆盖 `WORKTREE_SYNC_STATE_DIR`。同一仓库的 worktree 共享事件；仓库身份由 Git common directory 的规范路径和持久标识共同决定。只读 common directory 可配置外部标识。旧版按路径保存的状态需要明确选择迁移或从空状态开始，详见[迁移说明](docs/migration.md#repository-identity-and-existing-state)。

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
| `/worktree remove` | 查看所选工作树并获取手动移除说明；自动移除暂不可用 |
| `/worktree leave` | 显式停止当前会话订阅，保留未读消息 |
| `/worktree join` | 显式重新加入并启动接收器 |

路径在对话框填写，支持空格、中文和绝对路径；相对路径以当前 pi 目录为基准，不展开 `~` 或环境变量。创建后在新目录另启 agent，不改变当前 pi 会话目录。起点存在同名分支和标签时拒绝猜测，请使用 `refs/heads/...` 或 `refs/tags/...` 完整引用。

自动移除暂时停用：Git 无法原子地将删除绑定到所选工作树；并发 Git 操作可能在同一路径替换工作树，使原删除操作误删替代目录。导出的 `removeWorktree` API 也会拒绝删除。如需手动操作，请先停止所有可能在该仓库添加、移动或删除工作树的进程，用 `git worktree list --porcelain` 核对目标与身份，**备份被 Git 忽略的文件**，再手动运行 `git worktree remove --`，将已核实路径作为按当前 shell 正确引用的单独参数，不使用 `--force`。pi 显示的 JSON 路径是数据而非 shell 引号，不能直接粘贴为参数。Git 本身没有原子身份校验；若仍有并发操作，相同竞态仍可能发生。详见[迁移说明](docs/migration.md#temporary-worktree-removal-change)。

## 项目结构

```text
src/
├── core/
│   ├── git.ts             # Git/worktree 操作
│   ├── branch-status.ts   # 本地/上游状态与可选 GitHub CLI 查询
│   ├── branch-sync.ts     # 自动同步暂时阻止
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

测试使用临时仓库和隔离状态目录，覆盖多 worktree 合并、文件交集、路径规范化、first-parent 非连续历史、改后还原、重命名、大 diff、历史改写、跨 agent 广播、独立回执、旧状态迁移、并发重试、pi 排队去重、OpenCode v2 持久队列与取消、各 hook 协议及独立 CLI 进程间通信。已在本机记录的源码快照上，以 pi `1.4.0`、Codex CLI `0.164.0`、Claude Code `2.1.310`、OpenCode `2.1.2` 验证真实模型收件与去重。之后在较早的源码快照上完成了有限的 pi 真实模型消息使用及重启检查；当前源码的完整验收仍未完成。测试版本与范围详见 [验收记录](docs/acceptance.md)。这不代表其他版本或 Cursor 已通过真实验收。

提供文件级变更感知，不提供语义冲突检测；自动同步暂不可用。无事件不代表没有跨文件影响；事件送达也不代表 agent 已完成适配。正常运行去重，崩溃边界允许重发；CLI/hooks 输出成功后确认投递，宿主是否实际接收需要宿主确认。只清理所有接收者已确认、超过保留期的事件；未读消息和关闭标记保留。daemon 不会突破宿主的空闲唤醒限制。更多限制与恢复步骤见 [接入指南](docs/integrations.md#state-recovery-and-limitations)。
