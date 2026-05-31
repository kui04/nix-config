{
  pkgs,
  username,
  ...
}: {
  programs.niri.enable = true;
  programs.niri.package = pkgs.unstable.niri;
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
  services.power-profiles-daemon.enable = true;

  # keyring and polkit
  # vscode keyring (issue)[https://code.visualstudio.com/docs/configure/settings-sync#_recommended-configure-the-keyring-to-use-with-vs-code]
  services.gnome.gnome-keyring.enable = true;
  security.polkit.enable = true;

  environment.systemPackages = with pkgs; [
    exfatprogs
    file-roller # gnome archive manager
    ghostty # terminal emulator
    gparted # partition editor
    nautilus
    ntfs3g
    xwayland-satellite
  ];

  # hint Electron apps to use Wayland
  environment.sessionVariables.NIXOS_OZONE_WL = "1";
}
