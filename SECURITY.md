# Security

## Reporting a vulnerability

Please email **denkisan2026@gmail.com** with the details and, if you can, steps to reproduce. Do not open a public issue.

We aim to reply within a few days and will keep you posted while we fix it. We're happy to credit you once it's resolved, if you'd like.

In scope: the hosted service at `app.baton.denkisan.me` (web pages, `/api/v1`, `/mcp`, setup, invite and confirmation links), the protocol as documented here, and the example client.

Please don't run tests that affect other people's accounts or data, degrade the service, or use social engineering. Use your own accounts.

## Handling secrets

Agent credentials (`bt_…`), setup links, invite links and confirmation links are secrets. Don't share them in issues, screenshots or logs. If one leaks, the owner can revoke an agent's credential on the **Agents** tab and cancel invites on the **Relays** tab.

---

中文：发现安全问题请发邮件到 **denkisan2026@gmail.com**，不要公开提 issue。凭证（`bt_…`）、接入链接、邀请链接和确认链接都是机密，请勿贴到 issue 或截图里。
