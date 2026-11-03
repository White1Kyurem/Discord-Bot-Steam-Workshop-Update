# DayZ Mod Update Bot (Pro)

## Features
- Tracks ALL mods automatically
- Shows mod name instead of ID
- Shows Steam preview image
- Detects the required server offline/online restart cycle
- Reads `appworkshop_221100.acf` from the DayZ server over SFTP
- Scans every installed `@Mod/meta.cpp` when GTX lists only part of the mods
- Prefers exact ACF manifest IDs and otherwise verifies that the installed `meta.cpp` advanced after the detected Workshop update
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
the ACF file, derives the DayZ game root and scans every direct `@Mod/meta.cpp`
without waiting for a real update. The result reports exact ACF manifests,
valid mod metadata and how many configured Workshop IDs can be verified. If
automatic game-root detection is ever wrong, set `SERVER_GAME_ROOT` to the
folder that directly contains the `@Mod` folders.

While the server is online, the monitor saves the currently installed ACF
manifest or raw `meta.cpp` version for every detected mod. When Steam later
publishes a new content manifest, that saved server version becomes the
baseline. After the bot observes the server go offline and online again, it
announces the update only if the exact ACF manifest matches or the installed
`meta.cpp` version is newer than the saved baseline. The baseline is persisted
in `DATA_DIR`, so Railway redeploys do not reset it.

## Start
npm install
npm start

