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
      # https://github.com/apmantza/pi-lens
      "npm:pi-lens"
      # https://github.com/nicobailon/pi-mcp-adapter
      "npm:pi-mcp-adapter"
      # https://github.com/omaclaren/pi-markdown-preview
      "npm:pi-markdown-preview"
      # https://github.com/nicobailon/pi-subagents
      "npm:pi-subagents"
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
  ];
}
