{pkgs, ...}: let
  gnomeExtensions = with pkgs.gnomeExtensions; [
    appindicator
    blur-my-shell
    vitals
    dash-to-dock
    kimpanel
    clipboard-history
    rounded-window-corners-reborn
    user-themes
  ];
in {
  # GNOME Tweaks and Extensions
  home.packages = [pkgs.gnome-tweaks] ++ gnomeExtensions;

  # dconf settings for GNOME
  dconf.enable = true;
  dconf.settings = {
    "org/gnome/shell" = {
      disable-user-extensions = false;
      enabled-extensions = map (ext: ext.extensionUuid) gnomeExtensions;
    };

    "org/gnome/desktop/interface" = {
      enable-animations = true;
      enable-hot-corners = true;
      show-battery-percentage = true;
      color-scheme = "prefer-dark";
      gtk-theme = "Adwaita";
      cursor-theme = "Bibata-Modern-Ice";
      monospace-font-name = "AdwaitaMono Nerd Font 11";
    };

    "org/gnome/desktop/wm/keybindings" = {
      show-desktop = ["<Super>d"];
      move-to-workspace-right = ["<Control><Alt>Right"];
      move-to-workspace-left = ["<Control><Alt>Left"];
      switch-to-workspace-1 = ["<Alt>1"];
      switch-to-workspace-2 = ["<Alt>2"];
      switch-to-workspace-3 = ["<Alt>3"];
      switch-to-workspace-4 = ["<Alt>4"];
      move-to-workspace-1 = ["<Shift><Alt>1"];
      move-to-workspace-2 = ["<Shift><Alt>2"];
      move-to-workspace-3 = ["<Shift><Alt>3"];
      move-to-workspace-4 = ["<Shift><Alt>4"];
      move-to-monitor-down = [];
      move-to-monitor-left = [];
      move-to-monitor-right = [];
      move-to-monitor-up = [];
    };
    # custom keybindings
    "org/gnome/settings-daemon/plugins/media-keys" = {
      custom-keybindings = [
        "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/"
        # add more custom entries if needed
        # e.g.,
        # "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/"
      ];
    };

    "org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0" = {
      binding = "<Alt>Return";
      command = "kgx";
      name = "Open Terminal";
    };

    "org/gnome/settings-daemon/plugins/power" = {
      sleep-inactive-ac-type = "nothing";
    };

    "org/gnome/shell/extensions/vitals" = {
      position-in-panel = 0;
      use-higher-precision = true;
      icon-style = 1;
      fixed-widths = false;
      hot-sensors = [
        "_memory_usage_"
        "__network-rx_max__"
        "_processor_usage_"
        "_gpu#1_average_power_"
      ];
    };

    "org/gnome/shell/extensions/dash-to-dock" = {
      transparency-mode = "FIXED";
      background-color = "rgb(119,118,123)";
      background-opacity = 0.2;
      dash-max-icon-size = 36;
      show-mounts-only-mounted = false;
      dock-position = "BOTTOM";
      dock-fixed = false;
      hot-keys = false;
    };

    "org/gnome/shell/extensions/blur-my-shell/panel" = {
      static-blur = false;
    };

    "org/gnome/shell/extensions/blur-my-shell/dash-to-dock" = {
      static-blur = false;
      override-background = true;
      brightness = 1.0;
    };

    "org/gnome/shell/extensions/kimpanel" = {
      font = "Microsoft YaHei 11";
    };

    "org/gnome/shell/extensions/rounded-window-corners-reborn" = {
      skip-libadwaita-app = false;
      tweak-kitty-terminal = true;
    };
  };
}
