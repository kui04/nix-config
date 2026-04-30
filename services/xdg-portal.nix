{pkgs, ...}: {
  # needed for flatpak and niri
  xdg.portal = {
    enable = true;
    xdgOpenUsePortal = true;
    extraPortals = with pkgs; [
      xdg-desktop-portal-gtk
      # recommended by upstream, required for screencast support
      # https://github.com/YaLTeR/niri/wiki/Important-Software#portals
      xdg-desktop-portal-gnome
    ];
    config.common.default = "gtk";
  };
}
