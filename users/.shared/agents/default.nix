{
  pkgs,
  ...
}:
let
  sharedSkills = import ./skills.nix { inherit pkgs; };
  sharedSystemPrompt = ../../.config/agents/SYSTEM.md;
in
{
  imports = [
    ./agy.nix
    ./pi.nix
  ];

  # common CLI tools used by agents
  home.packages = with pkgs; [
    fd
    ripgrep
    unstable.codegraph
    unstable.rtk
  ];

  # global canonical agent directory links
  home.file.".agents/skills".source = sharedSkills;
  home.file.".agents/SYSTEM.md".source = sharedSystemPrompt;
}
