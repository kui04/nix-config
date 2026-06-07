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
      # https://github.com/nicobailon/pi-mcp-adapter
      "npm:pi-mcp-adapter"
      # https://github.com/omaclaren/pi-markdown-preview
      "npm:pi-markdown-preview"
      # https://github.com/nicobailon/pi-subagents
      "npm:pi-subagents"
    ];
  };

  home.packages = with pkgs; [
    ripgrep
    fd
  ];
}
