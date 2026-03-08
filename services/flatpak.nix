{pkgs, ...}: {
  config = {
    # enable flatpak
    services.flatpak.enable = true;
    # expose system fonts directory so Flatpak apps can find host fonts
    fonts.fontDir.enable = true;

    xdg.portal = {
      enable = true;
      xdgOpenUsePortal = true;
      extraPortals = with pkgs; [xdg-desktop-portal-gnome];
      config.common.default = "gnome";
    };
  };
}
