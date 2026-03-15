{
  pkgs,
  username,
  ...
}: {
  programs.niri.enable = true;
  users.users.${username}.extraGroups = ["input"];

  programs.niri.useNautilus = true;
  programs.nautilus-open-any-terminal = {
    enable = true;
    terminal = "ghostty";
  };
  # nautilus trash and mounts backend
  services.gvfs.enable = true;
  services.udisks2.enable = true;

  services.blueman.enable = true;
  services.cpupower-gui.enable = true;
  services.power-profiles-daemon.enable = true;

  # keyring and polkit
  # vscode keyring (issue)[https://code.visualstudio.com/docs/configure/settings-sync#_recommended-configure-the-keyring-to-use-with-vs-code]
  services.gnome.gnome-keyring.enable = true;
  security.polkit.enable = true;

  environment.systemPackages = with pkgs; [
    xwayland-satellite
    gparted # partition editor
    exfatprogs
    ntfs3g
    nautilus
    file-roller # gnome archive manager
    ghostty
  ];

  # hint Electron apps to use Wayland
  environment.sessionVariables.NIXOS_OZONE_WL = "1";

  # xdg portals for niri
  xdg.portal = {
    enable = true;
    xdgOpenUsePortal = true;
    extraPortals = with pkgs; [
      xdg-desktop-portal-gtk
      # recommended by upstream, required for screencast support
      # https://github.com/YaLTeR/niri/wiki/Important-Software#portals
      xdg-desktop-portal-gnome
    ];
  };
}
