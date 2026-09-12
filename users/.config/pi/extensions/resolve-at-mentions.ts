// pi's @autocomplete inserts @relative/path as plain text; the agent resolves
// it against ITS cwd, which can differ from where the user typed it. Rewrite
// @mention paths to absolute paths at input time when the file exists.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AT_PATH = /@"([^"]+)"|@'([^']+)'|@([^\s"'=#]+)/g;

export default function (pi: ExtensionAPI) {
  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    let changed = false;
    const text = event.text.replace(AT_PATH, (full, dq, sq, bare) => {
      const name = dq ?? sq ?? bare;
      if (isAbsolute(name)) return full;
      const abs = name.startsWith("~")
        ? join(homedir(), name === "~" ? "" : name.slice(2))
        : resolve(ctx.cwd, name);
      if (!existsSync(abs)) return full; // email/mention/broken ref: leave text alone
      changed = true;
      return dq !== undefined ? `@"${abs}"` : sq !== undefined ? `@'${abs}'` : `@${abs}`;
    });
    return changed ? { action: "transform", text } : { action: "continue" };
  });
}