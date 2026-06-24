{ ... }: {
  config = {
    # enable flatpak
    services.flatpak.enable = true;
    # expose system fonts directory so Flatpak apps can find host fonts
    fonts.fontDir.enable = true;
  };
}
