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

  # stylix supplies the palette, the font above stays ours
  stylix.targets.foot.fonts.enable = false;
}
