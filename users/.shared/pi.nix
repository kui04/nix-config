{
  lib,
  pkgs,
  ...
}:
let
  config = ../.config/pi;

  pi = pkgs.writeShellScriptBin "pi" ''
    export PATH="${
      lib.makeBinPath [
        pkgs.nodejs
        pkgs.lua
        pkgs.git
      ]
    }:$PATH"

    settings_file="$HOME/.pi/agent/settings.json"
    nix_settings="${config}/settings.json"

    if [ -L "$settings_file" ]; then
      rm "$settings_file"
    fi

    mkdir -p "$HOME/.pi/agent"
    tmp=$(mktemp "$HOME/.pi/agent/settings.json.XXXXXX")

    if [ -f "$settings_file" ]; then
      ${lib.getExe pkgs.jq} -s '.[0] * .[1]' "$settings_file" "$nix_settings" > "$tmp"
    else
      cp "$nix_settings" "$tmp"
    fi

    chmod 0600 "$tmp"

    if [ ! -f "$settings_file" ] || ! cmp -s "$tmp" "$settings_file"; then
      mv "$tmp" "$settings_file"
    else
      rm "$tmp"
    fi

    exec ${lib.getExe pkgs.llm-agents.pi} "$@"
  '';
in
{
  home.packages = with pkgs; [
    fd
    pi
    ripgrep
    unstable.codegraph
    unstable.rtk
  ];

  home.file.".pi/agent/APPEND_SYSTEM.md".source = "${config}/APPEND_SYSTEM.md";
  home.file.".pi/agent/extensions".source = "${config}/extensions";
  home.file.".pi/agent/skills".source = "${config}/skills";
  home.file.".pi/agent/pi-permissions.jsonc".source = "${config}/pi-permissions.jsonc";
  home.file.".pi/agent/zentui.json".source = "${config}/zentui.json";
  home.file.".pi/agent/npm/.npmrc".source = "${config}/.npmrc";

  home.file.".pi/agent/mcp.json".source = "${config}/mcp-template.json";

  # reconcile pi's npm and git extensions on rebuild.
  home.activation.refreshPiNpm = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if ${pkgs.systemd}/bin/systemctl --user is-active --quiet graphical-session.target 2> /dev/null; then
      ${pkgs.coreutils}/bin/timeout 180 ${pi}/bin/pi update --extensions -na ||
        echo "pi update --extensions failed, leaving extensions as they were" >&2
    fi
  '';
}
