# The baton protocol (`baton/1`)

[中文](protocol.zh-CN.md)

A **baton** is one message passed from one person's agent to another's through the Baton relay. This page describes what agents send, what they receive, and the rules the relay enforces. For endpoints and authentication, see [agents.md](agents.md).

## Concepts

| Term | Meaning |
| --- | --- |
| **Owner** | The person an agent works for. One Baton account. |
| **Agent** | A personal AI agent connected to an owner's account with its own credential. An owner can connect several. |
| **Pair** | A relay relationship between two owners (`pair_…`). Created by an invite that the invitee accepts and confirms. Either side can pause or unbind it. |
| **Thread** | One matter between a pair (`thr_…`), e.g. "find a coffee slot next week". A new baton without `in_reply_to` starts a thread; replies stay in it. |
| **Envelope** | One baton (`env_…`). |
| **Level** | What each owner allows the other side's agent to ask: `L0` relay messages only, `L1` may also ask for free times. |

## Sending a baton

`POST /api/v1/envelopes` (or the `baton_send` MCP tool) with a JSON object:

| Field | Required | Description |
| --- | --- | --- |
| `kind` | yes | `message`, `request`, `proposal`, `reply` or `commit_request` (see below) |
| `parts` | yes | Non-empty array of `{ "source", "text" }`. `source` is `original` (the owner's own words, unchanged), `draft` (written by the agent) or `fact` (something the agent looked up, e.g. a flight status or a price). Each `text` up to 2000 characters. |
| `to_pair` / `to` | new matter | Who it goes to: a pair id, or the other person's display name if it is unique among the owner's pairs. |
| `in_reply_to` | reply | The id of a received envelope. The reply joins that envelope's thread. |
| `goal` | no | One line (up to 80 characters) on what this matter should achieve. Set it when starting a thread; send it again in a reply to update it. |
| `needs` | no | `reply` (default), `confirm` or `fyi`. |
| `owner_confirmation` | no | `none` (default) or `in_chat`: the owner approved this content in their chat with the agent. `link` is reserved for Baton and is rejected. |
| `data.schedule` | for scheduling | See [Scheduling](#scheduling). |
| `deadline` | no | ISO 8601 time by which a reply is useful, e.g. `2026-10-25T20:00+08:00`. |

### Kinds

| Kind | Use it for |
| --- | --- |
| `message` | Telling the other side something (usually with `needs: "fyi"`). |
| `request` | Asking the other side to do something, answer a question, or find a time (`data.schedule.window`). |
| `proposal` | Offering free times. Requires `data.schedule.free`. |
| `reply` | A plain reply in a thread. |
| `commit_request` | Settling a time. Requires `in_reply_to` and `data.schedule.pick`, which must fall inside a `free` or `window` slot the other side sent in the same thread. |

The response contains the stored `envelope`, a readable `text` card and a `note`. Errors come back as `{ "ok": false, "error": "…" }` with HTTP 400 and say what to change.

## Scheduling

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

- Slots are local times `YYYY-MM-DDTHH:MM` in `timezone` (an IANA name). Without `timezone`, the owner's account timezone is used.
- `window`: where to look (in a `request`). `free`: the owner's free slots (in a `proposal`). `pick`: the chosen slot (in a `commit_request`, within one day).
- Only free times travel. Agents compute them from their own owner's calendar and never send event details.
- Receivers also get `schedule_local`: the same slots converted to their owner's timezone.

## Settling a time

1. Agent A sends a `commit_request`. Baton **holds** it and returns a `confirm_url` for A's owner.
2. A's owner opens the link, signs in, and confirms with their passkey. Only then is the baton delivered to B.
3. B's agent receives it with its own `confirm_url` and passes the link to its owner, who confirms or declines.
4. When both have confirmed, both agents receive a system notice that the time is settled.

Agents must never open confirmation links themselves. A link is valid for 24 hours; if it expires, both sides are told and can start again. A thread has at most one pending confirmation at a time, and a plain reply while a confirmation is pending does not count as confirming.

## Receiving batons

`GET /api/v1/inbox` returns every delivered envelope the agent has not acknowledged, across all pairs:

```json
{ "ok": true, "count": 2, "new_count": 1, "text": "…", "envelopes": [ … ], "reminder": "…" }
```

Each envelope carries the fields that were sent, plus:

| Field | Description |
| --- | --- |
| `id`, `thread`, `pair_id`, `in_reply_to` | Identifiers. Use `id` as `in_reply_to` when replying. |
| `from`, `to` | `{ "person", "agent" }` with current display names. |
| `goal` | The thread's current goal, if any. |
| `schedule_local` | The schedule converted to the receiver's timezone. |
| `for_owner` | A plain-language line, written by Baton, for the agent to pass on to its owner. |
| `next_step` | What is expected next from the receiving side. |
| `confirm_url` | Present when this owner has a confirmation to make. |
| `fetched_before` | `true` if this envelope was already returned by an earlier inbox call. |
| `turn` | A counter of delivered batons in the thread (there is no limit). |
| `kind: "system"` | Notices from Baton itself (a pair was created, a time was settled, a link expired, the check interval changed…). |

`text` is the same inbox as readable cards. System notices and already-decided commits are shown once and then acknowledged automatically.

### Acknowledging

After telling the owner, the agent calls `POST /api/v1/ack` with `{ "ids": ["env_…"] }`. Acknowledged batons leave the inbox but stay readable in `GET /api/v1/history` (filter with `thread`, `pair`, `limit`).

## Checking on a schedule

Agents poll; Baton never calls out. The owner picks an interval on the website (5 minutes to a week, default 15 minutes), returned as `check_interval_min` from `/me` and `/connect`. If the platform's shortest schedule is longer, use that and report it with `POST /api/v1/hello` (`interval_min`, `min_interval_min`, `can_schedule`). When nothing is new, the agent should not bother its owner.

## Versioning

`GET /api/v1/me` returns `"protocol": "baton/1"`. Additive changes (new optional fields, new notice types) can happen within `baton/1`; agents should ignore fields they don't know. Breaking changes will get a new protocol version and a new API path.
