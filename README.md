# DayZ Mod Update Bot (Pro)

## Features

- Detects normal Steam Workshop mod updates
- Detects newly installed mods automatically
- Detects uninstalled mods automatically
- Uses the exact Steam Workshop mod name
- Shows the Steam preview image for updates, installations and removals
- Mentions a configured Discord role in every notification
- Waits for the DayZ server restart before announcing changes
- Saves its state permanently in `DATA_DIR`
- Slash commands:
  - `/notifications on|off`
  - `/status`
  - `/testupdate` with selectable update/install/uninstall test type

## Required Railway variables

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_discord_server_id
ANNOUNCE_CHANNEL_ID=notification_channel_id
NOTIFY_ROLE_ID=role_id_to_ping

SERVER_HOST=your_server_ip_or_hostname
SERVER_QUERY_PORT=your_query_port

WORKSHOP_COLLECTION_ID=your_steam_collection_id
DATA_DIR=/data
```

`WORKSHOP_COLLECTION_ID` can be either the numeric ID or the full collection URL.
The collection must contain the same mods that are installed on the DayZ server.
The bot compares the collection with its previously saved state to identify:

- **Updated:** same mod ID, newer Workshop update timestamp
- **Installed:** mod ID was added to the collection
- **Uninstalled:** mod ID was removed from the collection

For an uninstalled mod, the previously saved exact name and preview image are retained so the removal message still contains both.

## Important Railway setup

Mount a persistent Railway volume at:

```text
/data
```

Without a volume, the saved comparison state can be lost during a redeploy.
On the first start, the bot creates a baseline and intentionally sends no installation messages for mods that were already in the collection.

## Discord permissions

The bot needs these permissions in the notification channel:

- View Channel
- Send Messages
- Embed Links
- Mention Everyone, or the selected role must be mentionable

The bot role must also be above any managed role restrictions that apply on your server.

## Optional variables

```env
POLL_INTERVAL_SECONDS=180
ONLINE_STABLE_SECONDS=90
REQUIRE_OFFLINE_CYCLE=true
WORKSHOP_MOD_IDS=
```

`WORKSHOP_MOD_IDS` is only a fallback. Automatic add/remove detection is best used with `WORKSHOP_COLLECTION_ID`.

## Start

```bash
npm install
npm start
```
