{pkgs, ...}: {
  config = {
    services.desktopManager.gnome.enable = true;

    # trim default GNOME apps
    services.gnome.games.enable = false;
    environment.gnome.excludePackages = with pkgs; [
      geary
      simple-scan
      totem
      gnome-connections
      gnome-tour
      gnome-calendar
      gnome-contacts
      gnome-characters
      gnome-music
      gnome-maps
      gnome-weather
    ];
    # only add udev package when GNOME is enabled (systray icons, etc.)

    services.udev.packages = with pkgs; [gnome-settings-daemon];
    # this is conflicted with services.gnome.gcr-ssh-agent.enable
    programs.ssh.startAgent = false;
  };
}
