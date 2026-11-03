{ pkgs, ... }: {
  programs.foot = {
    enable = true;
    server.enable = true;

    settings = {
      # niri draws the window decorations, so foot must not add its own titlebar
      csd.preferred = "none";
      main.font = "Sarasa Term SC:size=12";
    };
  };

  # stylix must not touch foot's appearance, so the palette is foot's own default
  stylix.targets.foot.enable = false;
}
