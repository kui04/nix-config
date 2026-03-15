{pkgs, ...}: {
  stylix = {
    enable = true;
    autoEnable = true;
    overlays.enable = false;

    polarity = "dark";
    base16Scheme = "${pkgs.base16-schemes}/share/themes/material-darker.yaml";

    cursor.name = "Bibata-Modern-Ice";
    cursor.package = pkgs.bibata-cursors;
    cursor.size = 24;

    icons.enable = true;
    icons.dark = "Adwaita";
    icons.package = pkgs.adwaita-icon-theme;

    # fonts are installed system-widely, so just set the names here
    fonts = {
      serif.name = "Noto Serif CJK SC";
      sansSerif.name = "Noto Sans CJK SC";
      monospace.name = "AdwaitaMono Nerd Font";
    };
  };

  xdg.configFile."ghostty/".source = ../.config/ghostty;
  xdg.configFile."swaylock/".source = ../.config/swaylock;
  xdg.configFile."swayidle/".source = ../.config/swayidle;
  xdg.configFile."waybar/".source = ../.config/waybar;
  xdg.configFile."wofi/".source = ../.config/wofi;
  xdg.configFile."mako/".source = ../.config/mako;
}
