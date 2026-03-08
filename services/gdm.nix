{username, ...}: {
  config = {
    services.displayManager.gdm.enable = true;

    services.displayManager.autoLogin.enable = false;
    services.displayManager.autoLogin.user = username;

    # workaround for GNOME autologin issues
    systemd.services."getty@tty1".enable = false;
    systemd.services."autovt@tty1".enable = false;
  };
}
