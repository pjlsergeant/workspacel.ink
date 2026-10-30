# workspacel.ink

Rewrites the workspace on a Slack link to the one you chose, then redirects.

    https://workspacel.ink/r/archives/C0CDA94QTQQ/p1793097077519469
      -> https://<your-workspace>.slack.com/archives/C0CDA94QTQQ/p1793097077519469

Put `workspacel.ink/` in front of any Slack link, or paste a Slack link into
the box on https://workspacel.ink/ to get a `https://workspacel.ink/r/...`
link that doesn't mention the workspace it came from. Whoever opens it is sent
to the same channel, message, file or profile on *their* workspace (set once,
under "settings").

**NOT ASSOCIATED WITH SLACK.** This is an independent project. "Slack" is used
only to describe which links it understands.

## Data retention

**ZERO DATA RETENTION** — We store nothing. Cloudflare may log the URL you
visit. Your settings stay in your browser.

The page is a single static file with no external requests and no tracking.
Your workspace and redirect delay live in your browser's localStorage
(`workspacel.ink:settings`) and nowhere else. The origin must record nothing
(see [Hosting requirements](#hosting-requirements)).

## Accepted links

Three input forms:

1. `/r/<slack path>`
2. `/https://<host>/<slack path>`
3. `/<host>/<slack path>`

`<host>` is a workspace host (`<name>.slack.com` or
`<name>.enterprise.slack.com`, lowercase; shape-checked, then discarded) for
the permalink shapes, or exactly `app.slack.com` for the `client/` shapes.
`http:` and every other scheme or host are rejected.

| Slack path | Redirects to |
|---|---|
| `archives/<channel>` | same |
| `archives/<channel>/p<16 digits>` | same, with `thread_ts` (and `cid`, which must match the channel); other parameters dropped |
| `team/<user>` | same |
| `files/<user>/<file>[/<filename>]` | `files/<user>/<file>` |
| `docs/<team>/<file>` | same |
| `client/<team>/<channel>` | `archives/<channel>` |
| `client/<team>/<channel>/thread/<channel>-<ts>` | `archives/<channel>/p<ts without the dot>?thread_ts=<ts>&cid=<channel>` |

IDs are an uppercase prefix letter (`C`/`G`/`D` channel, `U`/`W` user, `F`
file, `T`/`E` team) followed by 8–12 of `A-Z0-9`. Other paths, trailing
slashes, and a `thread_ts` or `cid` that isn't exactly valid (including any
percent-encoding in them) are rejected. Other query parameters are dropped
without inspection. The filename segment of file links is discarded; it may
be any printable non-space ASCII other than `/` (but not `.` or `..`).
Browsers percent-encode spaces and non-ASCII first, and turn `\` into `/`,
so a `\` never arrives as part of it. Nothing is ever percent-decoded.

Agents and other tools that write links can swap `https://<workspace>.slack.com/`
for `https://workspacel.ink/r/`. For fetchers that don't run JavaScript (curl,
HTML-to-markdown converters, agents), the page carries a static explanation of
how to follow the link by hand; the stylesheet hides it and the script removes
it on load.

## Security model

- The destination host comes only from the visitor's own validated setting;
  the inbound link's workspace is discarded.
- Only allowlisted link shapes are accepted. Path segments other than the
  discarded filename, and `thread_ts` / `cid`, must match exactly (so no `%`)
  or the link is rejected; unknown query parameters are dropped without
  inspection.
- Nothing is percent-decoded.
- The destination is built from parsed fields via `URL` setters, then checked
  for an exact match before use.
- Variable text is only ever set via `textContent` / `.value`; a test bans
  HTML sinks such as `innerHTML`.
- The page has one inline script, pinned by a CSP hash, and makes no external
  requests.

## Build and test

Node 22, no dependencies.

    npm test          # node --test (tests build into a temp directory)
    npm run build     # node build.mjs -> dist/index.html

`build.mjs` inlines `parser.mjs` and the page script from `src/index.html`
into one `<script>`, computes its SHA-256 and writes `dist/index.html` with a
`<meta http-equiv="Content-Security-Policy">` pinned to that hash and a
`<meta name="referrer" content="no-referrer">`.

## Hosting requirements

`dist/index.html` is the whole site. However it is hosted:

- Serve `dist/index.html` for every path with status 200, and no redirects.
- HTTPS only, with HSTS.
- Nothing is recorded at the origin (no access logs, at any proxy in the
  path). Otherwise the retention claim above is false.
- Send `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`. (The
  CSP and referrer policy are already in the page as `<meta>` tags.)

## Licence

MIT. See [LICENSE](LICENSE).
