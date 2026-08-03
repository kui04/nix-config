{
  config,
  pkgs,
  lib,
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
    unstable.ollama-cuda
    unstable.openspec
  ];

  home.file.".pi/agent/extensions".source = "${config}/extensions";
  home.file.".pi/agent/skills".source = "${config}/skills";
  home.file.".pi/agent/pi-permissions.jsonc".source = "${config}/pi-permissions.jsonc";
  home.file.".pi/agent/zentui.json".source = "${config}/zentui.json";
  home.file.".pi/agent/npm/.npmrc".source = "${config}/npmrc";

  home.file."Templates/pi-mcp.json".source = "${config}/mcp-template.json";

  # After every rebuild, wipe the pi extension install (node_modules +
  # package-lock.json) and reinstall every dependency at @latest, so pi starts
  # silent with fully up-to-date packages. Failures are tolerated: pi itself
  # reinstalls whatever is missing on next startup.
  home.activation.refreshPiNpm = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    npm_root="$HOME/.pi/agent/npm"
    if [ -f "$npm_root/package.json" ]; then
      rm -rf "$npm_root/node_modules" "$npm_root/package-lock.json"
      mapfile -t deps < <(${lib.getExe pkgs.jq} -r '.dependencies | keys[]' "$npm_root/package.json")
      specs=("''${deps[@]/%/@latest}")
      ${pkgs.nodejs}/bin/npm install --prefix "$npm_root" --legacy-peer-deps "''${specs[@]}" || true
    fi
  '';
}
