# Evolution World (动态世界) - 答疑知识库

> 本文档供答疑 Bot 使用，包含 Evolution World（EW）的功能说明、常见问题解答和配置指南。

---

## 一、Evolution World 是什么

Evolution World（简称 EW）是 SillyTavern（酒馆）的一个高级插件脚本，用于实现**动态世界系统**。

它的核心功能是：在用户与 AI 对话的过程中，自动调用外部工作流 API 来**抽取、分析、更新**对话中的世界状态（角色关系、环境变化、物品状态等），并将结果写入酒馆的世界书条目中，让 AI 在后续对话中能感知到这些动态变化。


### 核心概念

| 概念 | 简介 |
|---|---|
| **工作流 (Flow)** | 一个独立的 AI 任务配置，负责分析聊天内容并返回需要更新的世界书条目。例如"关系抽取流""环境检测流" |
| **控制器 (Controller)** | 每个工作流生成的 EJS 模板条目，用于根据条件动态控制哪些世界书条目被激活 |
| **Dyn 条目** | 动态世界书条目（以 `EW/Dyn/` 为前缀），由工作流自动创建和管理 |
| **快照 (Snapshot)** | 每次工作流执行后保存的世界状态备份，用于回滚和历史查看 |
| **楼层绑定 (Floor Binding)** | 将工作流的执行结果和快照绑定到聊天中的特定消息楼层 |
| **API 预设 (API Preset)** | 工作流调用外部 AI 模型的接口配置（URL、Key、模型名等） |

---

## 二、功能模块详解

### 2.1 执行时机

EW 支持两种执行时机：

**回复后更新（after_reply）** — 默认模式
- AI 先正常回复，然后 EW 根据最新回复执行工作流
- 不阻塞对话，用户体验更流畅
- 适合大多数场景

**回复前拦截（before_reply）**
- 在用户消息发送给 AI 之前先执行 EW 工作流
- 工作流结果会影响 AI 本次回复的上下文
- 适合需要"先更新世界状态再让 AI 基于最新状态回复"的场景

### 2.2 调度模式

| 模式 | 说明 |
|---|---|
| **并行** | 所有工作流同时发出请求，速度快但互相无法读取对方结果 |
| **串行** | 按优先级顺序逐个执行，后续工作流可以读取前序工作流的结果 |

### 2.3 失败策略

| 策略 | 行为 |
|---|---|
| **失败即中止** | 工作流失败后停止 AI 生成并提示错误 |
| **静默继续** | 显示警告但 AI 照常生成 |
| **自动重roll** | 按配置的次数和间隔自动重试，仍失败则中止 |
| **仅通知** | 只弹出提示，不影响生成 |

### 2.4 Dyn 写入模式

| 模式 | 说明 |
|---|---|
| **覆盖 (overwrite)** | 直接用本次工作流返回的结果替换旧内容 |
| **只增 (add)** | 只把新列表项追加进去，不删除已有项 |
| **增减 (add_remove)** | 把本次返回当成目标状态，多的删掉，缺的补上 |

> 注意：`add` 和 `add_remove` 模式使用 Markdown 列表语义（`- 条目内容`）。如果条目正文不是 Markdown 列表格式，会被跳过并告警，不做危险覆盖。

### 2.5 Dyn 激活模式

| 模式 | 说明 |
|---|---|
| **控制器仓库 (controller_only)** | 条目保持禁用状态（红灯），仅作为数据仓库，真正的注入由 Controller EJS 模板控制 |
| **直接世界书激活 (worldbook_direct)** | 条目直接启用，按配置的关键词、位置、概率等规则参与酒馆世界书匹配 |

### 2.6 楼层绑定与快照

- **楼层绑定**：开启后，工作流写入的 Dyn 条目会与当前聊天楼层绑定。删除该楼层时，绑定的条目会自动清理，实现"删楼 = 回滚"
- **快照存储**：支持两种存储方式：
  - **服务器文件模式 (file)**：快照存为独立 JSON 文件，适合长聊天（推荐）
  - **消息数据模式 (to_message_data)**：快照写入消息的 data 字段，更直观但聊天文件会变大
- **同步快照**：切换存储模式后，可点击"同步快照"迁移已有数据

### 2.7 隐藏设置

EW 支持"保留最新 N 条消息"的隐藏功能：
- **affect_workflow_context 关闭时**：隐藏只影响主回复 AI 的上下文，工作流仍可读取完整历史
- **affect_workflow_context 开启时**：工作流和主回复一样，只能读取未隐藏的消息

### 2.8 历史面板

历史面板展示每个聊天楼层的快照和执行状态：

| 状态 | 含义 |
|---|---|
| **exact** | 快照版本精确匹配当前可见消息版本 |
| **single_fallback** | 该楼只有一份快照，按唯一版本展示 |
| **same_swipe_fallback** | 匹配到同一 swipe 的其他版本快照 |
| **latest_fallback** | 回退到该楼最新的一份快照 |
| **skipped** | 系统记录了 after-reply 事件，但本轮被自动间隔或无匹配流跳过 |
| **missing** | 既没有可展示快照，也没有执行记录 |

---

## 三、常见问题 (FAQ)

### 3.1 基础使用

**Q: EW 怎么安装？**
A: EW 是一个酒馆助手脚本。你需要在 SillyTavern 中通过"脚本注入"的方式加载 EW 的打包文件。具体步骤请参考酒馆助手的加载教程。

**Q: 总开关在哪？关了会怎样？**
A: 在 EW 面板的"总览"标签页最顶部。关闭后 EW 不会拦截发送、不执行任何工作流。建议先在单聊天内开启验证，出现异常可先关闭总开关快速回退。

**Q: 我没有外部 API，能用 EW 吗？**
A: EW 需要调用外部 AI 模型来执行工作流任务。你需要至少配置一个 API 预设（URL + Key + 模型名），或使用酒馆连接器模式直接使用酒馆当前的主 API。

### 3.2 API 配置

**Q: API URL 填什么？**
A: 填你的 AI 模型服务的基础地址。例如 OpenAI 兼容接口通常是 `https://api.openai.com/v1` 或你的中转站地址。填写后可点击"加载模型列表"验证连通性。

**Q: API Key 必须填吗？**
A: 取决于你的 API 服务是否需要鉴权。如果你的服务要求 Authorization 头，则需要填写。

**Q: 额外请求头怎么填？**
A: JSON 格式，例如 `{"X-Token":"your-token"}`。用于网关鉴权或路由标识。格式错误会导致请求异常。

**Q: 我有多个 API，怎么给不同工作流分配不同的 API？**
A: 在"API 配置"标签页创建多个 API 预设（每个有独立的 URL/Key/模型），然后在每个工作流的"API 配置预设"下拉框中选择对应的预设。

### 3.3 工作流配置

**Q: 工作流 ID 有什么要求？**
A: 需要在当前配置中唯一。工作流 API 的返回体会带 `flow_id` 与其对应。重复 ID 会导致调试和结果合并定位困难。

**Q: 优先级是什么？数字大的优先还是小的？**
A: **数字大的优先级高**。多工作流结果合并时按优先级降序合并；同优先级按工作流顺序后者覆盖前者。

**Q: "自动触发执行间隔" 是什么？**
A: 控制该工作流每多少次自动触发才执行一次。设为 1 表示每次都执行；设为 3 表示只在第 3、6、9 次触发时执行。只对自动触发生效，手动运行和重 roll 不受影响。

**Q: 上下文楼层数怎么设？**
A: 这是发送给工作流 AI 的历史消息楼层数量。数值越大上下文越完整但 payload 也越大。建议按模型上下文窗口和成本调优，一般 4-12 层够用。

**Q: 超时设多少合适？**
A: 默认 300000ms（5 分钟）。如果你的 API 响应较慢或模型输出较长，可以适当增加。但总超时不应超过 EW 全局设置中的"总超时"。

### 3.4 提示词配置

**Q: 提示词条目支持哪些角色？**
A: `system`（系统提示）、`user`（用户消息）、`assistant`（助手消息）。

**Q: "相对"和"聊天中"插入位置有什么区别？**
A: "相对"模式适合稳定的全局约束，在消息列表的固定位置插入；"聊天中"模式随对话动态变化，更适合上下文相关的提示。

**Q: 触发器是什么？**
A: 限制该提示词在什么触发类型下生效。默认"All types"表示所有场景都生效，也可以只在"发送""继续""重试"等特定操作时才使用。

### 3.5 提取与排除规则

**Q: 提取规则怎么用？**
A: 按 start/end 标签从聊天文本中提取片段。例如 start=`<worldstate>` end=`</worldstate>` 会提取两个标签之间的内容，作为工作流上下文的一部分。

**Q: 排除规则怎么用？**
A: 同样按 start/end 标签，但会**剔除**匹配的片段。常用于去掉 `<thinking>...</thinking>` 等系统中间内容，减少噪声和泄漏风险。

### 3.6 响应处理

**Q: 移除正则和提取正则有什么区别？**
A:
- **移除正则**：在 JSON 解析前执行，全局匹配并删除匹配内容。例如 `<thinking>[\s\S]*?</thinking>` 删除思考过程。
- **提取正则**：在移除正则之后执行，使用第一个捕获组 (group 1)。例如 `<content>([\s\S]*?)</content>` 只保留 `<content>` 标签中的内容。

**Q: 请求模板是什么？**
A: 用于对标准请求体做 JSON merge 扩展。你可以添加额外字段传递给外部工作流 API。请确保合并后的 JSON 结构有效。

### 3.7 生成参数

**Q: 流式传输要开吗？**
A: 一般建议开启。开启后服务端边生成边返回，体验更好。关闭则等待完整结果后一次性返回。

### 3.8 Dyn 世界书条目配置

**Q: "控制器仓库"和"直接世界书激活"怎么选？**
A:
- **控制器仓库**：条目只存数据，不直接注入 AI 上下文。由 Controller EJS 模板根据规则决定激活哪些。更灵活、可控。
- **直接世界书激活**：条目直接启用并参与酒馆世界书匹配。配置更简单但灵活性较低。

**Q: 策略类型 (type) 该填什么？**
A: 最常见的是 `constant`（常驻），表示该条目始终参与匹配。其他值按你当前酒馆支持的世界书策略代码填写。

**Q: 扫描深度填什么？**
A: 最常用 `same_as_global`，表示跟随酒馆全局扫描深度设置。也可以填具体数字来独立控制。

**Q: 注入位置有哪些选项？**
A: 可选值如下：

| 值 | 说明 |
|---|---|
| `before_character_definition` | 放在角色设定前（最常用） |
| `after_character_definition` | 放在角色设定后 |
| `before_example_messages` | 放在示例对话前 |
| `after_example_messages` | 放在示例对话后 |
| `before_author_note` | 放在作者注前 |
| `after_author_note` | 放在作者注后 |
| `at_depth` | 按聊天深度插入 |
| `at_depth_as_system` | 按聊天深度插入（系统身份） |
| `at_depth_as_assistant` | 按聊天深度插入（助手身份） |
| `at_depth_as_user` | 按聊天深度插入（用户身份） |

**Q: 注入身份选什么？**
A: 通常选 `system` 最稳。也可以按需选 `user` 或 `assistant`。

### 3.9 快照与历史

**Q: 快照存储方式选哪个？**
A: **推荐"服务器文件"模式**。长聊天场景下，如果用"消息数据"模式会导致聊天文件膨胀。切换模式后点"同步快照"可以迁移数据。

**Q: 历史面板里的状态标签是什么意思？**
A:
- `exact`：精确匹配当前版本
- `single_fallback`：该楼只有一份快照
- `skipped`：本轮被跳过（自动间隔或无匹配流）
- `missing`：没有快照也没有执行记录

**Q: 删楼后工作流的条目怎么办？**
A: 开启"楼层绑定"后，删除楼层会自动清理该楼层绑定的 EW/Dyn/ 条目。如果同时开启了"自动清理孤儿条目"，切换聊天时也会清理无主条目。

### 3.10 重roll与重推导

**Q: 重roll范围有哪些选项？**
A:
- **全部工作流**：重跑当前楼的所有工作流
- **仅失败工作流**：只重试失败部分，保留成功结果
- **失败队列**：批量扫描当前聊天所有失败楼层，逐个重试

**Q: 什么是"历史重推导"？**
A: 对旧楼层重新执行工作流。支持 before_reply、after_reply、manual 三种模式。如果旧楼没有胶囊（执行快照），会要求确认后再执行。

### 3.11 常见故障排查

**Q: 工作流超时了怎么办？**
A: 检查 API 服务是否正常、网络是否稳定。可以适当增加单条工作流的"超时"设置和全局"总超时"设置。

**Q: 工作流显示成功但条目没更新？**
A: 可能原因：
1. 工作流返回的 `desired_entries` 为空
2. 条目名称与预期不符（检查 `dynamic_entry_prefix` 配置）
3. Controller 模板规则没有匹配到相关条目

**Q: 看到"本轮被跳过"是正常的吗？**
A: 是的。如果你设置了"自动触发执行间隔"大于 1，部分轮次会被跳过，这是正常行为。

**Q: 工作流执行了两次怎么办？**
A: EW 已内置多层去重防护。如果仍观察到双执行，可在浏览器控制台查看 `[Evolution World]` 相关日志，特别是 `skipped as duplicate` 或 `time-windowed dedup` 日志。

**Q: 切换聊天后条目混乱了？**
A: 确保开启了"楼层绑定"和"自动清理孤儿条目"。EW 在切换聊天时会自动清理和恢复快照。如果问题仍在，可尝试点击"同步快照"手动触发清理和恢复。

---

## 四、工作流 API 接口规范

### 4.1 请求格式 (FlowRequest)

EW 发给外部工作流 API 的请求体结构：

```json
{
  "version": "ew-flow/v1",
  "request_id": "唯一请求ID",
  "chat_id": "聊天ID",
  "message_id": 5,
  "user_input": "用户输入的消息",
  "trigger": {
    "timing": "before_reply | after_reply | manual",
    "source": "触发来源",
    "generation_type": "normal | continue | regenerate | swipe"
  },
  "flow": {
    "id": "工作流ID",
    "name": "工作流名称",
    "priority": 100,
    "timeout_ms": 300000,
    "generation_options": {
      "max_reply_tokens": 65535,
      "temperature": 1.2,
      "stream": true
    },
    "behavior_options": {
      "name_behavior": "default",
      "reasoning_effort": "auto"
    }
  },
  "context": {
    "turns": 8,
    "extract_rules": [],
    "exclude_rules": [],
    "ew_dyn_entries": {
      "active_names": ["当前激活的Dyn条目名"],
      "inactive_names": ["当前未激活的Dyn条目名"],
      "entries": [],
      "write_hint": {
        "mode": "overwrite",
        "item_format": "markdown_list",
        "activation_mode": "controller_only"
      }
    }
  },
  "serial_results": []
}
```

### 4.2 响应格式 (FlowResponse)

外部工作流 API 需要返回的响应体结构：

```json
{
  "version": "ew-flow/v1",
  "flow_id": "对应的工作流ID",
  "status": "ok",
  "priority": 100,
  "reply_instruction": "（可选）给 Controller 用的指令文本",
  "operations": {
    "worldbook": {
      "desired_entries": [
        {
          "name": "EW/Dyn/角色关系",
          "content": "- 主角和NPC甲是朋友\n- 主角和NPC乙关系紧张",
          "enabled": true
        }
      ],
      "remove_entries": [
        { "name": "EW/Dyn/旧条目" }
      ]
    },
    "controller_model": {
      "template_id": "entry_selector_v1",
      "variables": [],
      "rules": [],
      "fallback_entries": []
    }
  },
  "diagnostics": {
    "trace_id": "调试用追踪ID"
  }
}
```

关键字段说明：
- `desired_entries`：需要创建或更新的世界书条目（只需 name/content/enabled 三个字段）
- `remove_entries`：需要删除的世界书条目
- `controller_model`：Controller EJS 模板配置（可选）
- `reply_instruction`：写入 Controller 条目的指令文本

---

## 五、术语对照表

| 英文 | 中文 | 说明 |
|---|---|---|
| Flow | 工作流 | 一个独立的 AI 抽取/更新任务 |
| Controller | 控制器 | EJS 模板，动态控制条目激活 |
| Dyn Entry | 动态条目 | `EW/Dyn/` 前缀的世界书条目 |
| Snapshot | 快照 | 执行后的世界状态备份 |
| Floor Binding | 楼层绑定 | 条目与消息楼层的关联 |
| API Preset | API 预设 | 工作流调用模型的接口配置 |
| Swipe | 滑动 | 酒馆中切换同一楼层不同版本的回复 |
| Reroll | 重roll | 重新执行工作流 |
| Rederive | 重推导 | 对历史楼层重新执行工作流 |
| Floor | 楼层 | 聊天中的一条消息 |
| Timing | 时机 | before_reply / after_reply / manual |
| Dispatch | 调度 | 工作流请求的发送 |
| Merge | 合并 | 多工作流结果的合并处理 |
| Orphan | 孤儿条目 | 不再与任何楼层关联的 Dyn 条目 |

---

## 六、配置参数速查

### 全局参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| 总开关 (enabled) | 关 | 关闭后不拦截不执行 |
| 调度模式 (dispatch_mode) | 并行 | 串行/并行 |
| 执行时机 (workflow_timing) | 回复后 | before/after_reply |
| 失败策略 (failure_policy) | 中止 | stop/continue/retry/notify |
| 总超时 (total_timeout_ms) | - | 整轮工作流最大耗时 |
| 门控时效 (gate_ttl_ms) | - | 去重防重入有效期 |
| 动态条目前缀 | EW/Dyn/ | Dyn 条目命名前缀 |
| 控制器前缀 | EW/Controller/ | Controller 条目命名前缀 |
| 楼层绑定 | - | 条目与楼层关联 |
| 快照存储 | file | file / to_message_data |
| 回复后延迟 | 0 | AI 回复后等几秒再开始 |
| 自动重roll次数 | 1 | 失败后重试次数 |
| 自动重roll间隔 | 0 | 两次重试间等待秒数 |
| 并行发出间隔 | 0 | 并行模式错峰间隔 |
| 串行发出间隔 | 0 | 串行模式等待间隔 |

### 工作流参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| 开关 (enabled) | - | 是否参与调度 |
| 名称 (name) | - | 界面识别用 |
| ID (id) | - | 请求/响应对应用，需唯一 |
| API 预设 (api_preset_id) | - | 选择哪个 API |
| 优先级 (priority) | 100 | 数字大优先 |
| 执行间隔 (run_every_n_floors) | 1 | 每 N 次触发执行一次 |
| 超时 (timeout_ms) | 300000 | 单条最大耗时(ms) |
| 上下文楼层数 (context_turns) | 8 | 发给工作流的历史楼层数 |
| Dyn 写入模式 | overwrite | overwrite/add/add_remove |
| Dyn 激活模式 | controller_only | controller_only/worldbook_direct |

### 生成参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| 温度 (temperature) | 1.2 | 输出随机性 |
| 频率惩罚 | 0.85 | 抑制词汇重复 |
| 存在惩罚 | 0.5 | 鼓励引入新词 |
| Top P | 0.92 | 核采样阈值 |
| 最大回复长度 | 65535 | 单次生成上限(token) |
| 流式传输 | 是 | 边生成边返回 |
| 备选回复数 | 1 | 候选数量 |
