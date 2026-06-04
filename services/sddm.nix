{username, ...}: {
  config = {
    services.displayManager.sddm.enable = true;
    services.displayManager.sddm.wayland.enable = true;

    # autologin
    services.displayManager.autoLogin.enable = true;
    services.displayManager.autoLogin.user = username;
  };
}
