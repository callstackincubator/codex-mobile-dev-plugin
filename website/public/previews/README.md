# Feature previews

These videos are dark renders of the authored scenes from
[`feat/feature-previews` at `5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7`](https://github.com/callstackincubator/codex-mobile-dev-plugin/tree/5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7/design/stageshow).
Their React sources and rehearsal notes live under `design/stageshow/examples/`
at the same commit. The original layout and story are retained.

| Website asset | Source scene | Poster timestamp |
| --- | --- | --- |
| `performance.mp4` | `md-recording` | 9 seconds: finished recording with a selected range |
| `storage.mp4` | `md-storage` | 7 seconds: stored values and change history |

The palette comes from the plugin's dark declarations in `packages/ui/src/theme.css`
and the dark host variables in `tooling/hosts/profiles.ts`. Storage's semantic
colors use the same Tailwind tokens as the plugin. `website/previews/plugin-dark.css`
maps these colors to the source scenes, with the website's background outside
the plugin window. The phone's app retains its own colors.

`website/scripts/render-feature-previews.mjs` steps the source's virtual clock
at 60 fps, renders 1920 × 1080 frames, and encodes silent H.264 with FFmpeg.
The matching WebP posters are encoded from the same rendered frames with Sharp.
The scenes use authored demonstration data.

The annotation hero is native HTML and SVG, implemented in
`website/src/components/home/annotation/`. It does not use a video or poster.

## Regenerate

Use Node.js 24 with the repository and website dependencies installed, Google
Chrome, and FFmpeg. From the repository root:

```sh
preview_source=$(mktemp -d)
git archive 5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7 design/stageshow | tar -x -C "$preview_source"
npm ci --prefix "$preview_source/design/stageshow" --ignore-scripts --no-audit --no-fund
pnpm --dir website previews "$preview_source/design/stageshow"
```

Add `--stills` to inspect key frames without replacing the published assets, or
`--serve` to preview the dark source scenes in the browser. Review-frame paths
and the preview server URL are printed by the renderer.

Use `--only storage` or `--only performance` to render just one recording.

Stageshow is MIT licensed; its notice is preserved in `LICENSE`. Product names
and illustrated interfaces remain with their respective owners and do not imply
endorsement. No third-party fonts or photographs are included in these exports.
