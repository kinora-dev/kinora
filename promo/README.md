# kinora promo

A 15-second motion graphics film for kinora, written as a web page and rendered
to video with the workspace's own Playwright.

## Render

Needs `ffmpeg` on the PATH and the Chromium that Playwright installs
(`pnpm --filter @kinora/web exec playwright install chromium`). The renderer asks
Chromium for the Metal GPU backend, so it has only been run on macOS.

```bash
node promo/render.mjs                    # 1080p60 master -> promo/out/kinora-promo.mp4 (+ -silent.mp4)
node promo/render.mjs --draft            # quick 30fps pass, no motion blur
node promo/render.mjs --range 9.4,11.3   # only that stretch, at full quality
node promo/render.mjs --still 3.2,7.5    # PNG stills at the given seconds
node promo/render.mjs --sheet 8,10.5,12  # contact sheet: from,to[,count]
node promo/render.mjs --preview          # http://127.0.0.1:4173, with a scrubber
```

The full render takes about 5 minutes on an M5 Pro. Everything lands in `out/`,
which is gitignored: the videos are build output, not source.

## How it works

The film is a pure function of time. `src/film.js` exposes `seek(t)`, which places
every element on a 1920x1080 stage, and nothing remembers the previous frame. So
the renderer can seek it in any order, across parallel workers, and at sub-frame
instants: each frame is 16 instants captured at twice the output size, then scaled
down and averaged in linear light, which is real motion blur.

Everything is cut on a 128 BPM grid (8 bars are exactly 15 seconds). The cue sheet
in `src/timing.js` drives both the picture and the soundtrack, which `audio.mjs`
synthesizes from scratch, so the two cannot drift apart. To retime a beat, change
its cue there.

The dashboard and trace viewer on screen are rebuilt from the real components'
classes, with the dark theme tokens and the fonts from `@kinora/ui`. When the
product UI changes, `promo.css`, `src/wall.js` and `src/trace.js` are the places
to update.
