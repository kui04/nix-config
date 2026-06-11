{
  config,
  pkgs,
  ...
}: let
in {
  programs.pi.coding-agent.enable = true;
  programs.pi.coding-agent.settings = {
    packages = [
      # https://github.com/mksglu/context-mode
      "npm:context-mode"
      # https://github.com/edlsh/pi-ask-user
      "npm:pi-ask-user"
      # https://github.com/coctostan/pi-hashline-readmap
      "npm:pi-hashline-readmap"
      # https://github.com/omaclaren/pi-markdown-preview
      "npm:pi-markdown-preview"
      # https://github.com/nicobailon/pi-mcp-adapter
      "npm:pi-mcp-adapter"
      # https://github.com/AlexParamonov/pi-subagents-lite
      "npm:pi-subagents-lite"
    ];

    extensions = [];

    defaultThinkingLevel = "xhigh";
    followUpMode = "all";
    quietStartup = true;
    steeringMode = "all";
    httpIdleTimeoutMs = 60000;
    treeFilterMode = "user-only";
  };

  home.packages = with pkgs; [
    ripgrep
    fd
    ast-grep
    nushell
    universal-ctags
    difftastic
    shellcheck
    yq
    scc
  ];
}
