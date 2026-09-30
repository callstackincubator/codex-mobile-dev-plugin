import type { ComponentProps } from "react";
import expandMore from "@material-symbols/svg-400/outlined/keyboard_arrow_down.svg";
import expandLess from "@material-symbols/svg-400/outlined/keyboard_arrow_up.svg";
import check from "@material-symbols/svg-400/outlined/check.svg";
import smartphone from "@material-symbols/svg-400/outlined/mobile.svg";
import android from "@material-symbols/svg-400/outlined/android.svg";
import terminal from "@material-symbols/svg-400/outlined/terminal.svg";
import home from "@material-symbols/svg-400/outlined/home.svg";
import lock from "@material-symbols/svg-400/outlined/lock.svg";
import back from "@material-symbols/svg-400/outlined/arrow_back.svg";
import recent from "@material-symbols/svg-400/outlined/filter_none.svg";
import camera from "@material-symbols/svg-400/outlined/photo_camera.svg";
import refresh from "@material-symbols/svg-400/outlined/refresh.svg";
import search from "@material-symbols/svg-400/outlined/search.svg";
import layers from "@material-symbols/svg-400/outlined/layers.svg";
import follow from "@material-symbols/svg-400/outlined/vertical_align_bottom.svg";
import pause from "@material-symbols/svg-400/outlined/pause.svg";
import play from "@material-symbols/svg-400/outlined/play_arrow.svg";
import clear from "@material-symbols/svg-400/outlined/delete_sweep.svg";
import settings from "@material-symbols/svg-400/outlined/tune.svg";
import close from "@material-symbols/svg-400/outlined/close.svg";
import attach from "@material-symbols/svg-400/outlined/attach_file.svg";
import detach from "@material-symbols/svg-400/outlined/link_off.svg";
import code from "@material-symbols/svg-400/outlined/code.svg";

const icons = { expand_more: expandMore, expand_less: expandLess, check, smartphone, android, terminal, home, lock, arrow_back: back, filter_none: recent, photo_camera: camera, refresh, search, layers, vertical_align_bottom: follow, pause, play_arrow: play, delete_sweep: clear, tune: settings, close, attach_file: attach, link_off: detach, code };
export type IconName = keyof typeof icons;

export function MaterialIcon({ name, ...props }: Omit<ComponentProps<"svg">, "children"> & { name: IconName }) {
  // Only bundled Google SVG paths enter the document, never log or tool content.
  return <svg viewBox="0 -960 960 960" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false" {...props}
    dangerouslySetInnerHTML={{ __html: icons[name].replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "") }} />;
}
