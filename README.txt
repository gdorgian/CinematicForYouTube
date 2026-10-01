Cinematic — Netflix-style YouTube (personal rebuild) — v3
=========================================================

Install / update in Brave
1. brave://extensions → Developer mode on
2. First time: "Load unpacked" → pick ~/CinematicForYouTube
   Updating:   click the reload arrow on the Cinematic card
3. Reload youtube.com (sign in, otherwise Home has no feed)

Backup: private GitHub repo gdorgian/CinematicForYouTube

Home page
- Full-screen hero autoplays the selected video (channel • views • upload date,
  big title, Play, Mute/Unmute). ‹ › on the sides step through the current row.
- Rows (scroll the row area up/down, ↑ ↓ keys, or click the hint at the right of
  a row title):
    Recommended for You   YouTube's Home feed, loads more as you reach the end
    Continue Watching     half-watched videos from your history, with a progress
                          bar; the preview starts where you stopped
    New from Subscriptions
    Watch Later
  Rows that come back empty are left out.
- Hover a card to make it the hero. Play (or Enter, or clicking a card) opens the
  video at the second the preview had reached.
- Top bar: only search shows. Move the mouse to the top edge to bring back the
  logo, Create, notifications and your profile.
- Keyboard: ← → video, ↑ ↓ row, Enter play, M sound.

Battery and data
- Previews are capped at 720p.
- The preview pauses after 3 minutes without mouse/keyboard activity, when Brave
  isn't the focused window, or when the tab is hidden. It resumes on activity.

Watch history
- Previews shouldn't land in your history: the player's history pings are dropped
  while the Home screen is up and for every preview playback. Opening a video
  with Play logs it as normal.

How it works
- player.js runs in the page and drives YouTube's own "inline preview" player
  (YouTube refuses embedded players inside youtube.com, error 152).
- Extra rows are read from the ytInitialData of /feed/history,
  /feed/subscriptions and /playlist?list=WL (cached for a few minutes).
