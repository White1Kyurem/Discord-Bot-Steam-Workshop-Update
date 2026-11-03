# DayZ Mod Update Bot (Pro)

## Features
- Tracks ALL mods automatically
- Shows mod name instead of ID
- Shows Steam preview image
- Detects the required server offline/online restart cycle
- Reads `appworkshop_221100.acf` from the DayZ server over SFTP
- Compares the Steam Workshop content manifest with the installed manifest
- Announces an update only when it was installed before the server came online
- Persists detected and pending updates in `DATA_DIR`
- Beautiful dark purple Discord embed
- Slash commands:
  - /notifications on|off
  - /status
  - /checkmanifest

## Setup
1. Upload to GitHub
2. Deploy to Railway
3. Set environment variables
4. Mount volume to /data

## Required SFTP verification

The bot intentionally does not treat a restart as proof that a mod was updated.
Configure these Railway variables so it can verify the installed Steam Workshop
manifest on the DayZ server:

```env
SERVER_SFTP_HOST=YOUR_SERVER_IP
SERVER_SFTP_PORT=8822
SERVER_SFTP_USERNAME=YOUR_SFTP_USERNAME
SERVER_SFTP_PASSWORD=YOUR_SFTP_PASSWORD
SERVER_WORKSHOP_ACF_PATH=steamapps/workshop/appworkshop_221100.acf
SERVER_SFTP_SEARCH_ROOT=.
DATA_DIR=/data
```

The password must remain a Railway secret and must never be committed to GitHub.
If the host exposes the manifest under another path, change
`SERVER_WORKSHOP_ACF_PATH`. The `/status` command shows the last successful
manifest path or the exact verification error.

After deploying, run `/checkmanifest` once. It tests the SFTP login, locates
the ACF file and reports how many installed Workshop items were found without
waiting for a real update. If the configured path is wrong, the bot searches
the accessible SFTP folders automatically. If GTXGaming does not expose the
file at all, the error also lists the visible root entries so another strict
verification source can be selected.

## Start
npm install
npm start

