# System artwork: the captain mascot

Replaces the Stremio cat and the Stremio poster collages. Five images, same filenames the app already loads from
`assets/images/`:

| File | Where it shows | Pose / content |
|---|---|---|
| `empty.png` (300²) | Empty search, library, title lists; 404; errors | The captain beside an **empty treasure chest**, shrugging (the cat-in-a-box moment) |
| `default_avatar.png` (800²) | Settings user card, nav menu | Head-and-shoulders portrait, big grin |
| `anonymous.png` (512²) | Nav menu when signed out | Captain in round sunglasses, peeking over a barrel |
| `library_placeholder.png` (500×286) | Empty Library | Fanned row of five illustrated **original** film posters, a glowing play button on the middle one |
| `calendar_placeholder.png` (500×286) | Empty Calendar | Same, with a calendar page on the middle card |

## The character (original design, working name "Skipper")
A cheerful, scrappy kid-captain, about ten. Round face, huge open grin, tousled dark-brown hair, a few freckles, bright eyes.
Deep-navy captain's coat with brass buttons, a small orange-to-gold **play-button medal**, an oversized navy **tricorn hat**
with orange trim and a gold film-reel badge, and a little flag on a pole showing our house-with-play-button mark.
Brand colours: orange `#F27A24` to gold `#FFD700` accents on navy.

Keep it clearly our own: **no straw hat, no red hat band, no red open vest, no scar under the eye, no stretchy arms**, and never
prompt "in the style of" a named character or studio.

## Style (put this in every prompt)
> Polished stylized 3D animation render, soft studio lighting, warm saturated colours, clean readable silhouette, premium
> family-film quality, consistent character design. Single flat solid pure green (#00FF00) background, no cast shadow on the
> ground, no text, no watermark, full subject in frame with margin.

## Workflow
1. **Character sheet first.** Generate Skipper front, 3/4 and side view on the green background. Pick one; this image is the
   reference you attach to every later prompt so the character stays the same.
2. **The three character images** (attach the sheet as a reference), 1:1:
   - `empty`: "Skipper kneeling beside an open, empty wooden treasure chest, peering inside with a puzzled grin, one hand raised
     in a shrug, a couple of loose coins on the floor. Full body."
   - `default_avatar`: "Head-and-shoulders portrait of Skipper looking slightly up and to the side with a huge grin, tricorn
     hat on, medal visible."
   - `anonymous`: "Skipper wearing round dark sunglasses, smirking, peeking over the top of a wooden barrel. Head and hands only."
3. **The two placeholders** (no reference needed), 16:9:
   - `library_placeholder`: "Five illustrated vertical film posters fanned in a row, slightly blurred at the far ends: a
     ship on moonlit waves, a lighthouse, a dragon over mountains, a star map, and in the middle a glowing orange play
     button on a navy poster. Invented artwork only, no text, no real films or characters." (Background may be dark navy;
     these are not keyed.)
   - `calendar_placeholder`: the same, with a calendar page (a grid, no numbers) on the middle poster instead of the play button.
4. **Drop the results** into `assets/brand/mascot/raw/` named `empty.png`, `default_avatar.png`, `anonymous.png`,
   `library_placeholder.png`, `calendar_placeholder.png` (the character sheet as `sheet.png`).
5. **Process and rebuild:**
   ```sh
   pip install pillow
   python3 scripts/brand/process-mascot.py            # keys out the green, crops, writes assets/images/*.png
   npx webpack --mode production                      # check the empty states in the app
   ```
6. **Record where it came from** in `assets/brand/mascot/SOURCE.txt`: tool and model, date, and the exact prompts. Commit the raw
   renders and the processed images together.

## Private replacements (not in git)
An install can show different system artwork without touching the repo: put PNGs named like the table above in
`<data>/art/` (`data/art/empty.png`, …). The server serves them instead of the built-in image
(`http_server.js`; the five files are left out of the offline cache so a change shows up). Use only artwork you have the right
to use on that install.
