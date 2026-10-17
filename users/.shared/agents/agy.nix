{
  lib,
  pkgs,
  ...
}:
let
  config = ../../.config/agy;
  sharedSkills = import ./skills.nix { inherit pkgs; };
  sharedSystemPrompt = ../../.config/agents/SYSTEM.md;

  rtkRewriteScript = pkgs.writeShellScript "rtk-rewrite.sh" ''
    [ "$RTK_DISABLED" = "1" ] && { echo "{}"; exit 0; }
    command -v rtk >/dev/null 2>&1 || { echo "{}"; exit 0; }

    input=$(cat)
    cmd=$(echo "$input" | ${lib.getExe pkgs.jq} -r '.toolCall.args.CommandLine // empty')

    if [ -z "$cmd" ] || [[ "$cmd" =~ ^[[:space:]]*rtk ]]; then
      echo "{}"
      exit 0
    fi

    rewritten=$(rtk rewrite "$cmd" 2>/dev/null || true)

    if [ -n "$rewritten" ] && [ "$rewritten" != "$cmd" ]; then
      ${lib.getExe pkgs.jq} -n --arg rw "$rewritten" '{"decision": "allow", "overwrite": {"CommandLine": $rw}}'
    else
      echo "{}"
    fi
  '';

  agy = pkgs.writeShellScriptBin "agy" ''
    export PATH="${
      lib.makeBinPath [
        pkgs.nodejs
        pkgs.python3
        pkgs.git
        pkgs.ripgrep
        pkgs.fd
        pkgs.jq
        pkgs.unstable.rtk
        pkgs.unstable.codegraph
      ]
    }:$PATH"

    settings_file="$HOME/.gemini/antigravity-cli/settings.json"
    nix_settings="${config}/settings.json"

    if [ -L "$settings_file" ]; then
      rm "$settings_file"
    fi

    mkdir -p "$HOME/.gemini/antigravity-cli"
    tmp=$(mktemp "$HOME/.gemini/antigravity-cli/settings.json.XXXXXX")

    if [ -f "$settings_file" ] && [ -s "$settings_file" ]; then
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

    exec ${lib.getExe pkgs.llm-agents.antigravity-cli} "$@"
  '';
in
{
  home.packages = [
    agy
  ];

  # global instructions / system prompt for Antigravity
  home.file.".gemini/GEMINI.md".source = "${sharedSystemPrompt}";
  home.file.".gemini/config/GEMINI.md".source = "${sharedSystemPrompt}";

  # antigravity discovery location for skills
  home.file.".gemini/config/skills".source = "${sharedSkills}";

  # hooks configuration and scripts
  home.file.".gemini/config/hooks.json".source = "${config}/hooks.json";
  home.file.".gemini/config/scripts/rtk-rewrite.sh" = {
    source = rtkRewriteScript;
    executable = true;
  };

  # mcp templates
  home.file."Templates/agy-mcp.json".source = "${config}/mcp-template.json";
}
