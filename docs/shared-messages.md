# Worktree Relay：用户级共享消息存储

所有适配器使用同一个平台无关的消息层；不再把 CLI/hooks/OpenCode 状态保存在各自的 Git 目录中。

## 目录与隔离

默认目录为 `~/.local/state/worktree-agent-sync`；若设置了绝对路径 `XDG_STATE_HOME`，则使用 `$XDG_STATE_HOME/worktree-agent-sync`。也可通过绝对路径 `WORKTREE_SYNC_STATE_DIR` 直接覆盖整个状态根目录。所有参与者必须使用相同的状态根目录。

```text
<state-root>/repos/<repo-id>/
├── repo.json                    # canonical Git common directory
├── publish.lock                 # 发布与注册的短期排他锁
├── refs/<ref-key>.json           # 每个共享引用的监控位置
├── sessions/<session-key>.json   # agent 类型、原生 ID、worktree、订阅、lastSeen
├── sessions/<session-key>.lock   # 每个接收会话的消费锁
├── events/<event-id>.json        # 共享事件，每个事件只存一份
├── trash/                       # 已批准清理事件的恢复 journal
└── receipts/<session-key>/
    └── <event-id>.json           # 该会话独立的投递/无关回执
```

- `repo-id` 是 `git rev-parse --git-common-dir` 的绝对真实路径的 SHA-256。同一仓库的 worktree 自动共享；同 remote 的独立 clone 不自动互通，也不按仓库名合并。
- 会话键由 worktree 真实路径、监控 ref、agent 类型与原生 session ID 共同生成。两个平台即使 ID 相同也不会互相消费；不同 ref 的订阅独立。
- hooks 若提供非空 `agent_id`，直接返回空响应，不为短期子 agent 登记订阅或消费父会话消息；父会话在下一次 hook 收件。
- 目录以 `0700`、JSON 文件以 `0600` 创建；消息不进入版本控制。Windows 上实际访问权限仍由系统 ACL 决定。
- 这是同一 OS 用户的本机协作，不是防范同用户恶意进程的安全沙箱，也不是跨用户或跨机器消息服务。

## 两类事件

### 自动上游变更

任意接收端发现监控 ref 更新时，在仓库锁内发布一个共享提交范围事件，然后推进仓库级监控位置。重复轮询不会重复发布；同一提交范围在 reset 后再次出现时，会通过前序事件 ID 区分新的发生次数。

各目标会话独立计算文件交集和 diff。上游事件保存提交指针，投递时读取 Git 对象，不把每个 worktree 的 diff 都复制进公共事件。

没有本地相关修改的会话记录 `irrelevant` 回执，不唤醒 agent。新会话在当前主分支建立基线，不补发加入前的历史。每个已登记但离线的会话仍保有自己的收件资格，恢复后可补检。

### 主动跨 agent 消息

先确保目标会话已通过原生接收器、hook 或一次 `check` 登记，再从发送方 worktree 发送：

```sh
# 查看这个仓库已经登记的会话；lastSeen 不是在线保证。
worktree-sync sessions --cwd /project/worktree-A

# 发送给本仓库其他已登记会话。
worktree-sync send --cwd /project/worktree-A \
  --agent claude-code --session claude-session-A \
  --message '配置接口已调整，请检查依赖此接口的实现。'

# 只投递给当前也在修改这些文件的会话，--file 可重复。
worktree-sync send --cwd /project/worktree-A \
  --agent claude-code --session claude-session-A \
  --file src/config.ts --file src/types.ts \
  --message '这两个文件的接口约定有变化，请评估当前任务是否需要适配。'
```

不带 `--file` 时广播给同仓库其他已登记会话；带文件时，在**接收检查时**匹配该 worktree 的已提交/暂存/未提交/未跟踪修改。发送者自己的同一会话不收回自己的消息，其他会话即使在同一个 worktree 也可接收。

`send` 只发布消息，不登记或刷新发送者的接收订阅；一次性发送者不会成为后续广播的接收者。若发送者也需要收件，应通过接收器、`check` 或 `join` 显式登记。既有关闭会话仍需先 `join` 才能发送。

`send` 输出 `{ "eventId": "...", "recipients": 2 }`。人数是发布时的候选会话数，不是实际送达数；文件过滤、离线或宿主能力可能导致尚未投递。`recipients: 0` 表示当时没有其他已登记会话；将来新加入的会话不会补收这条消息。

文本非空且不超过 64 KiB；文本与文件列表的组合也限制为 64 KiB。文件必须是仓库相对文件路径，不允许绝对路径、目录或 `..` 跳转。发送时也检查不带尾斜杠的现存目录；允许已删除或重命名文件的路径。旧版本写入的目录样式路径仍可读取和清理，无文件交集时确认 `irrelevant`，不会转成广播或阻塞整个收件箱。`./src/config.ts`、`src//config.ts` 会在去重和匹配前规范为 `src/config.ts`，历史保留事件也采用相同规则。Windows 的反斜杠按分隔符处理；Unix 上的反斜杠保留为文件名字符。既有 `irrelevant` 回执不会因升级被自动撤销；已漏收的旧消息需要发送者重新发布。消息中的文字只作为其他 agent 的数据，不增加任何任务或 Git 操作授权。

## 接收与回执

原生适配器和 hooks 自动接收两类事件。手动接入：

```sh
worktree-sync check --cwd /project/worktree-B --agent codex --session codex-session-B
worktree-sync watch --cwd /project/worktree-B --agent codex --session codex-session-B
```

应与宿主使用相同的 agent 名称和稳定 session ID。默认 CLI agent 名称是 `cli`；省略 `--agent` 将登记成独立的 CLI 消费者，而不是某个原生 agent 的会话。

CLI 返回 NDJSON：自动变更类型为 `worktree.upstream-change`，主动消息类型为 `worktree.agent-message`。同一次检查可能输出多行，空 stdout 表示本轮没有投递。

每个消费者有独立回执，B 接收后不会删除事件，也不会影响 C 的消费。回执状态只有：

- `delivered`：适配器已接受；不表示模型完成适配。
- `irrelevant`：本次检查没有相关文件交集。

若事件所需的 Git 对象无法读取，发送 `unavailable: true` 的“上游变更历史不可用”通知，而不是把未知变更当作无关；其中的空文件列表不代表无影响。只有宿主接受该诊断后才写 `delivered`，失败或排队仍保留事件。后续消息与新的上游范围可继续消费；Git 程序无法执行、状态损坏或完整但无共同祖先的事件仍报错，不自动伪装成历史缺口。

pi 在消息真正出现在会话历史后才确认；仅排入 follow-up 队列时不确认。其余适配器依据宿主调用成功或 hook/CLI 输出完成确认。宿主在读取 hook 输出前崩溃仍可能丢失模型层投递，不能宣称恰好一次。

消费批次最多 8 条，并按约 64K 字符限制批次数据大小；单条事件较大时仍可独占一个批次，避免永远无法前进。未发送的事件保留到下一次检查。失败或取消不写成功回执；发送成功但回执落盘前崩溃可能重发。

## SDK 接入

Node 宿主从构建后的 JS 导入：

```js
import { consumeMailbox } from './dist/core/consumer.js';
import { sendMessage, formatNotifications } from './dist/core/mailbox.js';

await consumeMailbox({
  cwd: '/project/worktree-B',
  ref: 'refs/heads/main',
  adapter: 'my-agent',
  session: 'stable-native-session-id',
  async deliver(notifications) {
    await host.acceptMessage(formatNotifications(notifications));
    // 成功返回后写回执；throw 表示失败；return false 表示只排队、尚未持久接收。
  },
});
```

`signal` 可取消 Git 检查和锁等待；`sendMessage`、join/leave 与 GC 也支持取消。接收、发送、join/leave 和 GC 的仓库发布锁最多重试 5 秒，带短抖动；超时会明确报出锁路径和 PID，不再静默跳过。新鲜的同会话消费锁冲突仍跳过本轮以防重复投递，超过 60 秒则给出诊断；不自动抢锁。`isDelivered(eventId)` 让有持久历史的宿主在重试时确认先前消息。`consumeChanges({ deliver })` 保留为只消费上游变更的兼容 API，不会确认主动消息。

## 旧状态迁移与维护

- 旧 `<git-common-dir>/worktree-agent-sync/<key>.json` 会被只读导入，生成对应会话的补检事件，不删除或覆盖原文件。
- pi 会导入旧会话中的 `worktree-watch-state` / 旧格式变更消息位置；新回执按原生 session ID 保存，不随同一会话中的树导航回退。
- 升级不会自动删除或关闭旧订阅。旧版本的 send-only 身份、`父会话/agent_id` 子会话可能已留下幽灵登记；先用 `sessions` 核实身份。若不确认旧未读消息，可显式 `leave` 阻止未来收件，旧事件仍保留。若用户决定确认旧消息，应暂停其他发布者/接收器以免收件箱继续增长，使用对应 `--cwd`、`--agent`、`--session` 逐批 `check` 并检查输出，直到为空，再 `leave` 和按正常 GC 规则清理；已经 leave 的身份需先显式 `join` 才能收件。不能把真实离线会话当成幽灵自动淘汰。
- 被强杀的进程可能留下 `.lock`。检查 PID 确认进程已退出后只删除该锁，不删除事件和回执。不会自动抢占可能仍存活的进程。
- `leave` 显式退出未来订阅，`join` 显式恢复；退出不等于已读。`gc` 默认预览，只清理所有接收者已确认并超过保留期的事件；可选 daemon 在启动时和每小时自动清理。不设置离线 TTL，`lastSeen` 仅供诊断。详见 [维护指南](maintenance.md)。
- 收件检查仍扫描保留事件和本会话回执的文件名，但先读取并校验回执，只加载未确认事件正文；每批最多并发读取 32 条，投递仍按时间和 ID 排序。损坏回执会报错而不是当作已读；已确认事件正文不再由该会话轮询校验，GC 仍校验全部事件。没有新增缓存、索引或状态迁移，定期安全清理仍能减少扫描量。需要清空状态时应先停止 daemon 和所有参与进程，备份后再操作；清空会丢失待处理消息和去重记录。
- 公共目录不会绕过宿主的投递限制：Claude Code/Codex/Cursor 的 hook 仍不能主动唤醒已经空闲的会话；pi/OpenCode 的原生轮询可以。已经被远端宿主接受的请求也无法通过本地取消撤回。
