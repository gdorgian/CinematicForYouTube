Cinematic — Netflix-style YouTube (personal rebuild) — v3.3
===========================================================

Install / update in Brave
1. brave://extensions → Developer mode on
2. First time: "Load unpacked" → pick ~/CinematicForYouTube
   Updating:   click the reload arrow on the Cinematic card
3. Reload youtube.com (sign in, otherwise Home has no feed)

Backup: private GitHub repo gdorgian/CinematicForYouTube

Home page
- Full-screen hero autoplays the selected video (channel • views • upload date,
  big title, Play, Mute/Unmute). ‹ › on the sides step through the current row.
- Rows (scroll up/down anywhere: one row per gesture; ↑ ↓ keys; or click the
  hint at the right of a row title). Swipe sideways to scroll a row:
    Recommended for You   YouTube's Home feed, loads more as you reach the end
    Continue Watching     half-watched videos from your history, with a progress
                          bar; the preview starts where you stopped
    New from Subscriptions
    Watch Later
  Rows that come back empty are left out.
- Hover a card to make it the hero. Its preview is a "trailer": it starts ~12% in
  (from the start for videos under 90 s; where you stopped for Continue Watching).
- Play (or Enter, or clicking a card) opens the video from the beginning, or
  where you left off if you've partly watched it. The preview never counts.
- Top bar: hidden. Move the mouse to the top edge to bring back the logo,
  search, Create, notifications and your profile.
- Keyboard: ← → video, ↑ ↓ row, Enter play, M sound.

Video page: ambient light
- While a video plays, its colours glow out around the player and under the
  translucent top bar, on a pure black page. Same technique as "Ambient light for
  YouTube": the picture is drawn as ~9 layers, each bigger by 15.3% of the video
  width, so the light on each side comes from that side's edge of the picture;
  the outer part fades to black. Follows the player in normal and theater mode;
  off in fullscreen.
- Popup: Ambient light on/off, Glow spread (default 122), Glow blur (default 38),
  Glow strength. Defaults are the values exported from your Ambient Light setup.
- Replaces YouTube's own (subtler) ambient mode.
- Light on the battery: one 128px downscale of the frame, ~9 tiny draws, at most
  30 fps; the GPU does the blur.
- Test bench: test/ambient.html (a fake watch page with a test-pattern video;
  serve the repo root and open /test/ambient.html).

Battery and data
- Previews play at 1080p.
- The preview pauses after 2 minutes without mouse/keyboard activity, when Brave
  isn't the focused window, or when the tab is hidden. It resumes on activity.

Watch history
- Previews don't land in your history: on Home, every player except the real
  watch player (incl. the miniplayer) has its history pings dropped, and preview
  pings are dropped everywhere. Opening a video with Play logs it as normal.
- Diagnostics (off by default): in the YouTube tab's console run
  localStorage.setItem('cyt:debug','1'), reload; history-related requests are
  recorded in localStorage['cyt:log'].

How it works
- player.js runs in the page and drives YouTube's own "inline preview" player
  (YouTube refuses embedded players inside youtube.com, error 152).
- Extra rows are read from the ytInitialData of /feed/history,
  /feed/subscriptions and /playlist?list=WL (cached for a few minutes).
