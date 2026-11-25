# dsh-turn-prompt

中文 | [English](#english)

在 DSH（DeepSeek Harness）的输入框旁加一枚 **提示词控件**：事先存好多套提示词，发送前点一下选中，「下一轮」的系统提示词就带上这套内容；**本轮结束自动回到默认**（不附加任何额外提示词）。想再加，就再手动选一次。

## 它做什么

- **多套预设、手动选择**：点开控件就是列表，默认项在最上面，下面是你的预设。
- **只作用于下一轮**：选中后生效于接下来那一轮；`turn/end` 一到，宿主机自动撤销选择，界面回到「默认」。
- **不进对话记录**：提示词作为系统提示词片段参与请求，聊天里显示、保存的还是你自己打的字。
- **可管理**：面板里的「管理」能新增、改名、改内容、删除，也能恢复随包附带的几套；预设保存在本浏览器（`localStorage`）。
- **两种语言**：界面与随包预设跟随 DSH 界面语言（中文 / English）。

## 安装

```bash
# ① 装到你在用的 profile（web / desktop 二选一）
dsh plugin --profile web add dsh-turn-prompt
# 或
dsh plugin --profile desktop add dsh-turn-prompt
```

装完重启一次 DSH（或刷新页面）。输入框左侧出现「提示词」按钮即可。

本地开发时也可以直接装目录：**Plugins → Add plugin** 填包目录的绝对路径，或用 `plugin_manager` 的 `install_bundle`。

## 使用

1. 点输入框左侧的「提示词」。
2. 选一套（或选最上面的「默认（不附加提示词）」取消）。
3. 正常发消息。这一轮模型看到的就是系统提示词 + 你选的那套。
4. 本轮结束时控件自动回到默认；要再用就再选一次。

「管理」里改完即时生效并保存。

## 边界

- 只在 **Web / Desktop 的图形界面** 里有按钮；没有浏览器界面的 profile（headless、ACP、SDK）里不会注入任何东西。
- 选择只作用于**下一轮**；同一轮里的多次模型请求都带着它，直到该轮结束。
- 预设保存在浏览器本地：换浏览器、清站点数据后回到随包默认的几套。
- 注入的是系统提示词片段，会改变系统提示词文本；对依赖前缀缓存的路由，缓存命中率可能受影响。
- 关掉插件后按钮和注入一起消失，对话记录不受影响。

## 许可

MIT。

---

<a id="english"></a>
## English

A prompt control beside the DSH composer: keep several prompt sets, click one before sending, and its text joins the **next turn's** system prompt. The selection returns to the default of no extra prompt as soon as that turn ends, so a further turn needs another explicit pick.

### What it does

- **Several sets, picked by hand** — the panel lists the default row first, then your sets.
- **Next turn only** — the Host drops the selection on `turn/end`, and the control falls back to Default.
- **Not in the transcript** — the text participates as a system-prompt section, so the conversation keeps exactly the message you typed.
- **Manageable** — Manage inside the panel adds, renames, edits, deletes, and restores the shipped sets; sets live in this browser's `localStorage`.
- **Bilingual** — interface text and shipped sets follow the DSH interface language (中文 / English).

### Install

```bash
dsh plugin --profile web add dsh-turn-prompt   # or --profile desktop
```

Restart DSH (or reload the page) once. A “Prompt” control on the left of the composer means it is live.

### Use

Open the control, pick a set (or the top default row to clear), then send as usual. The control returns to Default when the turn ends.

### Limits

- The control exists only in the Web/Desktop GUI; profiles without a browser surface inject nothing.
- One selection covers one turn — every model request inside that turn carries it, until the turn ends.
- Sets are browser-local: another browser, or cleared site data, falls back to the shipped defaults.
- The text is a system-prompt section, so the system prompt changes; routes that reuse a prompt prefix may see a lower cache hit rate.
- Turning the plugin off removes the control and the injection.

MIT licensed.
