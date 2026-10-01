Cinematic — Netflix-style YouTube (personal rebuild) — v2
=========================================================

Install / update in Brave
1. brave://extensions → Developer mode on
2. First time: "Load unpacked" → pick ~/CinematicForYouTube
   Updating:   click the reload arrow on the Cinematic card
3. Reload youtube.com (you need to be signed in so Home has a feed)

Home page becomes:
- Full-screen hero that autoplays the selected video in the background
  (channel avatar + name, big title, Play, Mute/Unmute)
- ‹ › arrows on the sides of the hero to step through videos
- YouTube's category chips (they really filter the feed)
- One horizontal row of videos: hover a card to make it the hero, info card pops
  under it; mouse wheel / edge arrows scroll the row; more videos load as you
  reach the end
- Keyboard: ← → select, Enter plays, M toggles sound
- No sidebar, no Shorts, no ads/banners

Popup: Enable Cinematic, Previews with sound, Hide Shorts everywhere, Open YouTube.

How it works: YouTube refuses to play embedded players inside youtube.com
(error 152), so player.js runs in the page and drives YouTube's own
"inline preview" player, the same one YouTube uses for hover previews.
