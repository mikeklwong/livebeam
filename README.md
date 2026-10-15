# Livebeam

Streaming community tools for Discord: a responsive website, an interactive configuration dashboard, and a self-hosted Node service.

## Run

Requires Node.js 22.13+ (Node 24 recommended). No npm dependencies are required.

```sh
node server/index.mjs
```

Open **http://localhost:4173**. Without credentials the dashboard operates as a browser-local demo. Use **Load sample configurations** on Overview to try it. Notifications, role rules, schedules, settings, search, previews, export, import, and reset are interactive.

To run the connected service, copy `.env.example` to `.env`, configure your credentials, and run:

```sh
node --env-file=.env server/index.mjs
```

`npm start`, `npm test`, and `npm run check` are also available on standard Node installations.

## Connect Discord

1. Create your own application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_BOT_TOKEN` in `.env`.
3. Set `PUBLIC_URL` to the deployed origin. For local development it is `http://localhost:4173`.
4. Register `PUBLIC_URL/auth/discord/callback` as an OAuth2 redirect URL.
5. Start Livebeam, choose **Add bot to Discord**, then **Connect Discord**. The dashboard lists servers you can manage.
6. Give the bot access to the announcement channel and place its role above any live roles it will assign. The invite asks for View Channel, Send Messages, Embed Links, Read Message History, Manage Roles, Create Events, and Manage Events.

OAuth state is bound to an HttpOnly cookie. Tokens are kept in server memory, expire after at most 24 hours, and are never returned to the browser. Restarting the service requires a new sign-in. Configuration writes require same-origin JSON requests and freshly checked server permissions. Manager-role delegates cannot change the manager role list.

## Streaming providers

| Provider | Credentials | Creator identifier | Polling |
| --- | --- | --- | --- |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch login | Default 2 minutes |
| YouTube | `YOUTUBE_API_KEY` | `UC` channel ID | 30-minute cache per channel/content filter |
| Kick | `KICK_ACCESS_TOKEN` | Numeric broadcaster user ID | Default 2 minutes |

Twitch app tokens are renewed automatically. Kick access-token rotation must be managed by the operator. YouTube livestream detection uses search and consumes substantial API quota; size your quota for the number of channels. Upload detection uses the uploads playlist and seeds the first observed videos without announcing a historical backlog.

Messages support `{name}`, `{title}`, `{game}`, and `{url}`. Game filters match any listed category; title filters require every listed keyword. Mentions are disabled. Live delivery includes deduplication, cooldowns, stream-end editing/deletion/messages, optional crossposting, and optional custom webhook identity.

For a custom webhook, put its URL in an environment variable such as `COMMUNITY_WEBHOOK`, and enter **only that variable name** in the dashboard. The service verifies that it belongs to the selected server and channel. Webhook secrets are not stored in browser configuration or backups.

## Roles and schedules

Live Role uses explicit `DiscordUserID:twitchlogin` mappings, one per line. Include/exclude filters use Discord role IDs. Roles that predate Livebeam are not claimed or removed by the service. Deleting a rule causes previously assigned roles to be removed on a subsequent successful cycle.

Schedule rules sync up to the next 20 Twitch schedule segments to Discord external events. Events are created once and updated when details change. Cancelled segments are cancelled in Discord. Existing Discord events are retained if a whole schedule configuration is deleted.

## Deployment

The `dist/` directory is a buildless static frontend. Static hosting serves the demo only. Live OAuth, scheduled polling, and Discord delivery require the included Node server to stay running with a persistent `data/` directory.

For a server deployment:

- Set `HOST=0.0.0.0`, `PORT`, and an HTTPS `PUBLIC_URL`.
- Put it behind a TLS reverse proxy that preserves the original Host header.
- Run **one service process** against the data directory. The JSON store is not a distributed database.
- Back up `data/` and protect both it and `.env`. Do not commit either.
- Restart the service after changing environment variables.

The Sites hosting manifest is for the static demo deployment, not the Node service. The container definition supports the connected Node service; mount a volume at `/app/data`.

```sh
docker build -t livebeam .
docker run --env-file .env -e HOST=0.0.0.0 -p 4173:4173 -v livebeam-data:/app/data livebeam
```

## Implemented and remaining

Implemented: landing page, feature comparisons, documentation, FAQ, brand download, responsive navigation, configuration dashboard, Discord OAuth, guild authorization, three provider adapters, customizable notifications, filters, cooldowns, stream cleanup, crossposting, webhook identity, mapped Live Role rules, schedule synchronization, activity logs, diagnostics, JSON export/import, and separate demo data.

Not implemented: paid subscriptions or entitlements, Discord slash commands, native Discord Linked Roles / Twitch affiliate verification, Twitch team imports, presence-based automatic member discovery, YouTube Shorts classification, VOD summaries, translated interfaces, staffed support, partner programs, or distributed event delivery. The private interfaces and behavior of other services cannot be verified from public pages. This project does not claim full feature parity with another service.

Live API adapters have been tested with mocks and local HTTP checks, not real provider credentials. Before enabling a community, validate delivery in a private test channel. Polling may miss streams shorter than a polling interval. YouTube live transitions can take up to 30 minutes to appear. The service is suitable for a personal single-process deployment; it is not a large-scale hosted bot platform.

## Checks

```sh
node --check dist/app.js
node --check server/index.mjs
node --check server/engine.mjs
node --test test/*.test.mjs
```

Tests exercise filtering, deduplication, cooldowns, retry behavior, upload seeding, role ownership, schedule updates, webhook restrictions, HTTP routing, authentication, origin validation, OAuth rejection, and source-file isolation.
