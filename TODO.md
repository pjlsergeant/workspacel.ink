# TODO

## Features

- **`slack://` deep links.** Needs the workspace team ID (`T…`) as an extra
  setting. Map `archives/C…[/p…]` to
  `slack://channel?team=T…&id=C…[&message=<ts>]` (the `message=` param is
  poorly documented); fall back to `https://` for every other shape.
- **Per-channel dispatch.** Route specific channels to different workspaces.
  Settings are versioned (`v: 1`) so this can be added as `v: 2`.
- **Settings export / import.**
- **Slack Lists:** `lists/<T|E>ID/<F>ID`. Confirm the shape before adding.
- **Huddle links:** `huddle/<T|E>ID/<C|G|D>ID`. Short-lived; confirm the shape
  first.
- **`*.slack-gov.com`** (Slack GovSlack).
- **More reserved org labels**, e.g. `hooks` (`hooks.slack.com`).

## Verify before launch

- Page works in a real browser under its CSP (script hash matches).
- Hosting sends the README's required headers and serves every path with 200.
- Coolify proxy access logs are off; Cloudflare is in front.
- Slack side:
  - file links without the filename segment still open the file
  - `?thread_ts=…&cid=…` on converted client thread links opens the thread
  - `<label>.enterprise.slack.com` hosts work for Enterprise Grid
