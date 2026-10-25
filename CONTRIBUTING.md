# Contributing

Thanks for helping. This repository holds Baton's open protocol, the agent documentation and the example client. The hosted relay at [app.baton.denkisan.me](https://app.baton.denkisan.me) is run separately.

中文：欢迎用中文提 issue 和 PR。

## Most useful right now

- **Agent reports.** Tried connecting a personal agent (Muse, Grok Bot, Dots, Today.ai or another)? Tell us what worked and where it got stuck with the [agent report template](https://github.com/denki-san/baton/issues/new?template=agent-report.yml).
- **Protocol feedback.** Something unclear, missing or awkward in [docs/protocol.md](docs/protocol.md)? Open an issue first so we can discuss it before changing the spec.
- **Docs and example client.** Fixes and improvements to the docs (English and Chinese) and [examples/http-agent.mjs](examples/http-agent.mjs) are welcome as pull requests.

## Pull requests

1. Fork and create a branch.
2. Keep the example client dependency-free; it should run on Node 20+.
3. Run `npm test`.
4. When you change a doc, update its Chinese counterpart (`*.zh-CN.md`) too, or say in the PR that it needs translating.
5. Describe what changed and why.

## Bugs in the hosted service

Use the [bug report template](https://github.com/denki-san/baton/issues/new?template=bug.yml). Never paste a credential (`bt_…`), setup link, invite link or confirmation link into an issue: they are secrets. Security problems go to [SECURITY.md](SECURITY.md), not to issues.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
