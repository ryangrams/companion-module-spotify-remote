## Control Spotify from Companion

Play, pause, skip, set the volume, start your playlists and see what is playing, all on whichever computer or speaker you choose.

### Before you start

- You need Spotify Premium. Spotify only lets other apps control playback on Premium accounts, and a developer app stops working if its owner's Premium lapses.
- Each Spotify developer app can sign in up to five Spotify accounts, so each studio should make its own app. It is free and takes a few minutes.
- Open the Spotify app on the computer that should play the music and sign in. A device only shows up in Spotify while its app is open, so set it to open at login.

### Setup

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard/applications) and create an app. Choose **Web API** when it asks which APIs you plan to use.
2. In the app's settings, add `https://bitfocus.github.io/companion-module-spotify-remote/` as a Redirect URI.
3. Copy the Client ID and Client Secret into this connection's settings, enter the same Redirect URL, and save.
4. Reopen the settings. An address appears in **Auth URL**. Open it in a browser, approve access, and copy the Approval Code the page shows you.
5. Paste the Approval Code into the settings and save. The connection fetches its tokens and turns green once a playback device is chosen.
6. Start a song on the computer that should play the music, reopen the settings, and pick it under **Playback Device**. Every action plays on that device from then on.

You can also set the device with the **Write the ID of the current Active Device to config** action, the same way as before.

### Playlists

The connection reads the playlists in your library when it starts and again every ten minutes. Run **Refresh My Playlists** to pick up a new one straight away.

- **Play One of My Playlists** picks a playlist from a list. You can also paste a playlist link or ID.
- The **My playlists** preset group has one button per playlist, with its cover art.
- The **Playlist browser** preset group is a page of slots that steps through your whole library, so a new playlist appears on the deck without rebuilding buttons. Set how many slots a page has under **Playlist Browser Buttons**, place that many slot buttons, and add the previous and next page buttons.

Both playlist actions can force shuffle on or off. Shuffle on starts on a random track, because Spotify's shuffle only reorders what comes after the first one.

### Keeping music on the right device

Someone can start Spotify on a phone and pull the music away from the studio computer. Two feedbacks catch that, and both default to black on yellow:

- **Warn when music is playing on another device**
- **Warn when the playback device is offline**, usually because the Spotify app on it is closed

**Bring Playback to the Playback Device** moves the music back. The Play / Pause, Now playing and Play here presets already include these warnings.

### Variables worth knowing

- `songName`, `artistName`, `albumName`, `deviceName` and `volume` describe what is playing.
- `playbackDeviceName` and `playbackDeviceOnline` describe the device chosen in the settings.
- `playlistSlot1Name` and up name the playlists on the current browser page, and `playlistPageLabel` shows the page as `1/4`.

If you have an issue with the module, please open an issue on the module's GitHub repo or message Peter Stather on the official Slack.
