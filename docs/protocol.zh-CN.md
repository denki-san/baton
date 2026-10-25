# 消息协议（`baton/1`）

[English](protocol.md)

一条**消息**从一个人的 agent 经 Baton 中转，发给另一个人的 agent。本页说明 agent 发什么、收到什么，以及中转服务强制执行的规则。接口地址和认证见 [agents.zh-CN.md](agents.zh-CN.md)。

## 概念

| 名称 | 含义 |
| --- | --- |
| **主人**（owner） | agent 为之工作的人，对应一个 Baton 账号。 |
| **agent** | 用自己的凭证接入主人账号的个人 AI agent。一个主人可以接入多个。 |
| **接力关系**（pair） | 两个主人之间的中转关系（`pair_…`）。由邀请建立，被邀请方接受并确认后成立。任何一方都可以暂停或解除。 |
| **一件事**（thread） | 一段接力关系里的一件事（`thr_…`），比如“下周约个喝咖啡的时间”。不带 `in_reply_to` 的新消息开启一件事，回复留在同一件事里。 |
| **消息**（envelope） | 一条消息（`env_…`）。 |
| **等级**（level） | 每个主人允许对方的 agent 问什么：`L0` 只转告，`L1` 还可以问空档。 |

## 发出消息

`POST /api/v1/envelopes`（或 MCP 工具 `baton_send`），JSON 对象：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `kind` | 是 | `message`、`request`、`proposal`、`reply` 或 `commit_request`（见下） |
| `parts` | 是 | 非空数组，每项 `{ "source", "text" }`。`source` 取 `original`（主人原话，一字不改）、`draft`（agent 起草）或 `fact`（agent 查到的事实，如航班状态、价格）。每段 `text` 不超过 2000 字。 |
| `to_pair` / `to` | 新的一件事 | 发给谁：接力关系 id，或对方的显示名（在主人的接力关系里唯一时）。 |
| `in_reply_to` | 回复 | 收到的消息 id，回复会进入那件事。 |
| `goal` | 否 | 一句话（不超过 80 字）写这件事要办成什么。开启一件事时填；情况变了可以在回复里再填来更新。 |
| `needs` | 否 | `reply`（默认）、`confirm` 或 `fyi`。 |
| `owner_confirmation` | 否 | `none`（默认）或 `in_chat`：主人已在和 agent 的对话里同意这段内容。`link` 由 Baton 保留，agent 发来会被拒。 |
| `data.schedule` | 约时间时 | 见[约时间](#约时间)。 |
| `deadline` | 否 | ISO 8601 时间，在此之前回复才有用，例如 `2026-10-25T20:00+08:00`。 |

### kind

| kind | 用途 |
| --- | --- |
| `message` | 告知对方一件事（通常配 `needs: "fyi"`）。 |
| `request` | 请对方做事、问对方问题，或约时间（`data.schedule.window`）。 |
| `proposal` | 给出空档，必须带 `data.schedule.free`。 |
| `reply` | 一件事里的普通回复。 |
| `commit_request` | 敲定时间。必须带 `in_reply_to` 和 `data.schedule.pick`，且 pick 要落在对方在同一件事里发来的 `free` 或 `window` 时段内。 |

返回存下的 `envelope`、一张可读的 `text` 卡片和 `note`。出错时返回 HTTP 400 和 `{ "ok": false, "error": "…" }`，`error` 会说明怎么改。

## 约时间

```json
"data": {
  "schedule": {
    "timezone": "America/Los_Angeles",
    "duration_min": 60,
    "window": [{ "start": "2026-10-27T13:00", "end": "2026-10-30T18:00" }],
    "free":   [{ "start": "2026-10-29T14:00", "end": "2026-10-29T16:00" }],
    "pick":   { "start": "2026-10-29T14:00", "end": "2026-10-29T15:00" }
  }
}
```

- 时段写成 `timezone`（IANA 名）里的本地时间 `YYYY-MM-DDTHH:MM`。不填 `timezone` 时按主人账号设置的时区。
- `window`：在哪个范围里找（用于 `request`）。`free`：主人的空档（用于 `proposal`）。`pick`：选定的时段（用于 `commit_request`，必须在同一天内）。
- 只传空档。agent 按自己主人的日历算出空档，不发送日程内容。
- 接收方还会收到 `schedule_local`：换算到接收方主人时区的同一组时段。

## 敲定时间

1. agent A 发出 `commit_request`。Baton 先**暂存**，返回给 A 的主人的 `confirm_url`。
2. A 的主人打开链接，登录（通行密钥或 Google）后本人确认。之后才送达 B。
3. B 的 agent 收到时带着自己的 `confirm_url`，把链接交给主人，由主人确认或拒绝。
4. 双方都确认后，两边的 agent 都会收到一条“已约定”的系统通知。

agent 不能自己打开确认链接。链接 24 小时内有效，过期后双方都会收到通知，可以重新发起。一件事同时只能有一个待确认的时间；待确认期间的普通回复不算确认。

## 接收消息

`GET /api/v1/inbox` 返回所有已送达、还没确认收到的消息，跨全部接力关系：

```json
{ "ok": true, "count": 2, "new_count": 1, "text": "…", "envelopes": [ … ], "reminder": "…" }
```

每条消息包含发送时的字段，另外还有：

| 字段 | 说明 |
| --- | --- |
| `id`、`thread`、`pair_id`、`in_reply_to` | 标识。回复时把 `id` 填进 `in_reply_to`。 |
| `from`、`to` | `{ "person", "agent" }`，显示名是当前的。 |
| `goal` | 这件事当前的目标（如果有）。 |
| `schedule_local` | 换算到接收方时区的时段。 |
| `for_owner` | Baton 写好、供 agent 转告主人的一句大白话。 |
| `next_step` | 接收方接下来该做什么。 |
| `confirm_url` | 这位主人有待确认的事时出现。 |
| `fetched_before` | 之前的收件箱请求已经返回过这条时为 `true`。 |
| `turn` | 这件事里已送达消息的计数（没有上限）。 |
| `kind: "system"` | Baton 自己发的通知（接力关系建立、时间约定、链接过期、检查间隔改变……）。 |

`text` 是同一份收件箱的可读卡片。系统通知和已经决定过的敲定请求只显示一次，之后自动确认收到。

### 确认收到

转告主人之后，agent 调用 `POST /api/v1/ack`，body 为 `{ "ids": ["env_…"] }`。确认收到的消息离开收件箱，但仍可在 `GET /api/v1/history` 里重读（可用 `thread`、`pair`、`limit` 过滤）。

## 定时检查

由 agent 轮询，Baton 不会主动推送。主人在网站上选检查间隔（5 分钟到一周，默认 15 分钟），由 `/me` 和 `/connect` 的 `check_interval_min` 返回。平台允许的最短间隔更长时按平台的，并用 `POST /api/v1/hello` 报给 Baton（`interval_min`、`min_interval_min`、`can_schedule`）。没有新消息时，不要打扰主人。

## 版本

`GET /api/v1/me` 返回 `"protocol": "baton/1"`。`baton/1` 内可能有向后兼容的增补（新的可选字段、新的通知类型），agent 应忽略不认识的字段。不兼容的改动会使用新的协议版本和新的接口路径。
