# Agent 接入与消息投递

## 先区分能力

| 平台 | 接入形式 | 运行中的 agent | 已经空闲的 agent |
| --- | --- | --- | --- |
| pi | 原生扩展 | 队列 follow-up，当前 run 完成后处理 | 自动触发新一轮 |
| OpenCode | 原生插件，v1 client API | 等待 idle 后发送 prompt | 已登记会话每 5 秒检查并触发 |
| Claude Code | 同步 lifecycle hooks | 工具完成后注入；Stop 时可继续一轮 | 不会主动唤醒，等下一次 hook |
| Codex | 同步 lifecycle hooks | 工具完成后注入；Stop 时可继续一轮 | 不会主动唤醒，等下一次 hook |
| Cursor | 同步 hooks | 工具完成后注入；completed stop 时可跟进一轮 | 不会主动唤醒，等下一次 hook |
| 其他客户端 | CLI JSON / NDJSON | 由宿主将事件送入当前会话 | 是否唤醒由宿主实现 |

**不同平台通过用户级共享消息层协作，不需要相互调用。** 例如 A 用 Claude Code 合入 main，任意接收端发布共享事件，B 用 pi、C 用 OpenCode，各自读取事件并投递给自己的 agent。也可以通过 `worktree-sync send` 主动发送协调消息。目录、身份、广播和回执见 [共享消息指南](shared-messages.md)。

本项目不通过终端按键模拟、修改 transcript 文件或启动另一个独立 agent 来冒充向原会话发送消息。

## pi

```sh
pi install /absolute/path/to/pi-git-worktree
```

重启或 `/reload`；扩展与 skill 都会被加载。每个 worktree 的 pi 都要加载扩展。默认在 TUI/RPC 模式监控 `refs/heads/main`：

```sh
pi --worktree-main-ref refs/heads/develop
pi --worktree-watch=false
```

`/worktree leave` 显式关闭当前消息订阅，保留未读事件；`/worktree join` 重新加入。普通退出、重载不自动关闭订阅，以便离线恢复。跨平台的 CLI 退出方式、安全 GC 和可选 daemon 见 [维护指南](maintenance.md)。

print/JSON 模式不启动自动监控，避免后台轮询干扰一次性执行。`/worktree` 管理命令保留；根目录 `index.ts` 保留为旧加载路径的兼容入口。

pi 现在使用与其他平台相同的用户级共享存储，以原生 session ID 区分消费回执。仅排入 follow-up 队列时不确认；实际进入会话历史后再确认。旧 custom entries/messages 中的游标可导入补检。首次登记在当前主分支建立基线，不补发加入前的历史。

## 通用 CLI 与 hooks 安装

在本包目录安装 CLI：

```sh
npm install -g /absolute/path/to/pi-git-worktree
worktree-sync --help
```

需要 Node.js 22.19+。hooks 运行环境的 PATH 必须能找到 `worktree-sync`；也可以把配置中的命令改成实际的 Node 和脚本绝对路径，并正确引用有空格的路径。不要假设 GUI 应用继承了交互式 shell 的 PATH。

不要覆盖已有设置文件。将下面示例中的 `hooks` 项合并到宿主自己的配置中，然后按宿主要求信任/启用 hooks。

### Claude Code

将 [`src/adapters/claude-code/hooks.json`](../src/adapters/claude-code/hooks.json) 的 `hooks` 合并到 `.claude/settings.json` 或个人设置。

- `SessionStart` 建立或恢复会话基线。
- `UserPromptSubmit` / `PostToolUse` 返回 `hookSpecificOutput.additionalContext`，内容进入模型上下文。
- `Stop` 有新事件时返回 `decision: block` 和变更内容，请求继续处理；`stop_hook_active` 时不再次要求继续。

### Codex

需要具有 lifecycle hooks 支持的 Codex 版本。将 [`src/adapters/codex/hooks.json`](../src/adapters/codex/hooks.json) 的内容合并到项目或个人的 `.codex/hooks.json`，按版本支持情况启用并信任。

使用与 Claude Code 同名事件和对应的 `additionalContext` / Stop continuation 协议。旧版本若只支持向外的 `notify`，不能靠它向原会话注入消息：应升级、使用通用 CLI 在任务检查点读取，或由自有 App Server 宿主消费 NDJSON 并调用 `turn/start` / `turn/steer`。本项目未实现 App Server 连接管理。

### Cursor

将 [`src/adapters/cursor/hooks.json`](../src/adapters/cursor/hooks.json) 合并到 `.cursor/hooks.json` 或个人配置，保留 `version: 1`。

- `postToolUse` 返回 `additional_context`。
- `stop` 仅在 `status: completed` 且 `loop_count < 1` 时返回 `followup_message`。
- 第一次支持的 hook 建立基线；之后每次工具完成或停止时检查。不会唤醒已经停下来的会话。
- 多根 workspace 必须由 hook 输入提供明确 `cwd`；没有 `cwd` 且有多个 root 时拒绝猜测目标仓库。

## OpenCode

本适配器按官方插件接口和 **v1 client 的 `{ path, body }` SDK 调用形式**实现；不宣称兼容所有未来大版本的客户端接口。

在项目 `.opencode/plugins/worktree-sync.ts` 或全局插件目录放置一个薄入口，指向本包的绝对路径：

```ts
export { default } from "/absolute/path/to/pi-git-worktree/dist/adapters/opencode/index.js";
```

从源码使用前先执行 `npm run build`（npm 打包时会自动构建）。重启 OpenCode。插件在会话收到用户消息时登记该会话并建立/恢复基线；每 5 秒检查已登记会话，在 idle 后调用 `client.session.prompt()`，并等待调用成功再写入该会话的独立回执。不枚举或唤醒用户未参与的历史会话，不主动注册子 agent。删除会话、服务实例销毁时清理轮询。

同一个插件实例使用 OpenCode 提供的 `directory` 作为 worktree。请在每个 worktree 独立启动对应的 OpenCode 实例；本版不把同一个实例内任意跨目录会话自动映射到其他 worktree。

## 配套 skill

共享 skill 位于 [`skills/worktree-coordination/SKILL.md`](../skills/worktree-coordination/SKILL.md)。它说明事件处理流程、完整 diff 查看、本地状态重读、权限边界及集成前检查。

- pi：由 package manifest 自动发现。
- Claude Code：将 `skills/worktree-coordination/` 复制或链接到 `.claude/skills/`。
- Codex：复制或链接到 `.agents/skills/`。
- OpenCode：复制或链接到 `.opencode/skills/`。
- Cursor：在支持 skills 的版本中复制或链接到 `.cursor/skills/`；否则将关键处理规则加入已有的项目规则。

Skill 是行为指导，不是跨进程投递通道；仍需安装扩展或 hooks。

## 自有 agent / 编排器

```sh
# 同一个会话每次使用相同 ID；第一次调用建立基线。
worktree-sync check --cwd /path/to/worktree-B --session conversation-B

# 持续输出 NDJSON；SIGINT/SIGTERM 退出。
worktree-sync watch --cwd /path/to/worktree-B --session conversation-B
```

上游事件包含 `type: worktree.upstream-change`、共享 `eventId`、`root`、`ref`、`previous`、`commit`、`rewritten`、`files`、`commits`、有界 `patch` 和 `message`。跨 agent 消息类型为 `worktree.agent-message`，包含 `sender`、`text`、`files` 和 `message`。一次检查可能输出多行 NDJSON。

stdout 仅用于数据，诊断写入 stderr。**输出成功不等于 agent 已处理**：CLI 在成功写出后记录独立回执。自有宿主使用 `consumeMailbox({ deliver })` 接收批次，成功返回后确认，`return false` 表示仅排队、尚未持久接受。`consumeChanges` 保留为只接收上游事件的兼容 API。Node 宿主导入构建后的 `dist/core/consumer.js`。发送成功但回执落盘前崩溃仍可能重发；使用 eventId 去重，详见 [共享消息指南](shared-messages.md)。

## 引用与远端变化

默认只读本地 `refs/heads/main`。CLI/hooks/OpenCode 可设置 `WORKTREE_MAIN_REF`，CLI 也可使用 `--ref`。例如 `refs/remotes/origin/main`。

不会自动联网、fetch 或安装 Git hooks。监控远端跟踪引用时，须由用户或既有自动化执行 fetch；否则本机无法知道平台上的合并。Git 配置和用户自定义 diff 程序不会作为 patch 生成器执行（禁用 external diff/textconv）。

## 状态、恢复和限制

- 所有平台的状态统一写入用户级 `worktree-agent-sync/repos/<repo-id>/`，支持 `XDG_STATE_HOME` / `WORKTREE_SYNC_STATE_DIR`。同仓库事件共享、每个会话独立回执，不同 clone 不互通。旧 Git 目录游标只读迁移，不删除原文件。
- 同会话并发检查用排他锁避免重复发送；正常退出会释放。若进程被强杀，可能留下 `.lock`；确认其中 PID 已退出后，只删除对应 `.lock`，保留 `.json` 游标。检测到无主锁会报出路径，不会自动抢锁或删除状态。
- 主分支有共同祖先的 reset/force-push 会标为历史改写，发送前后快照差异。若历史完全无关、旧提交已被清理或 Git 正处于无法读取的状态，保留原游标并报错，不静默跳过。
- 检测依据为当前工作区状态，不是 agent 未来打算修改的文件。跨文件语义依赖和跨主机 worktree 不在范围内。
- 首次登记之前的变化不补发；无交集时记录 `irrelevant` 回执，后来才开始修改该文件不会补发已经跳过的历史。新会话也不会收到加入之前的主动广播。
- 同一轮正常前进会逐个检查 first-parent 提交，避免漏掉先修改再还原的文件；大量离线历史可能使检查变慢。每次 Git 命令有 30 秒超时，错误不会推进游标。
- diff 预览限制约 24K 字符，文件列表和提交元数据也可能较大；事件中给出精确哈希以便继续查看。二进制文件仅显示 Git 的二进制变更摘要。
- 自动唤醒会消耗模型额度；插件不验证 agent 是否真正完成适配，也不自行修改、stash、merge、rebase 或提交代码。提供只清理确认事件的 GC 和可选 daemon；未读消息与关闭标记不自动删除，也不按 lastSeen 淘汰会话。详见维护指南。

## 官方接口参考

- [pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Cursor hooks](https://cursor.com/docs/agent/hooks)
- [OpenCode plugins](https://opencode.ai/docs/plugins/) / [SDK](https://opencode.ai/docs/sdk/)

宿主协议会演进；本项目通过协议测试验证输出格式，尚未替代各客户端版本的真实端到端验收。
