{pkgs, ...}: {
  # polkit angent
  services.polkit-gnome.enable = true;
  services.network-manager-applet.enable = true;

  # packages for niri desktop environment
  home.packages = with pkgs; [
    wofi # app launcher
    mako # notification
    libnotify # library that sends desktop notifications to a notification daemon
    gnome-text-editor # text editor
    loupe # image viewer
    wl-clipboard # clipboard
    copyq # clipboard manager gui tool
    waybar # status bar
    swww # wallpaper
    waypaper # wallpaper setter
    pavucontrol # pulseaudio volume control panel
    brightnessctl # brightness control for laptops
    swaylock-effects # sway lock
    swayidle # sway idle
    xorg.xrdb # X resources database utility
  ];

  # scaling and rendering issues under Xwayland [https://github.com/Supreeeme/xwayland-satellite/issues/301]
  xresources.properties = {
    "Xft.dpi" = 192;
    "Xft.autohint" = 0;
    "Xft.lcdfilter" = "lcddefault";
    "Xft.hintstyle" = "hintfull";
    "Xft.hinting" = 1;
    "Xft.antialias" = 1;
    "Xft.rgba" = "rgb";
  };

  xdg.configFile."niri/".source = ../.config/niri;

  xdg.configFile."sunshine/sunshine.conf".text = ''
    locale = zh
    capture = kms
  '';
}
