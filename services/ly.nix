{username, ...}: {
  config = {
    services.displayManager.ly.enable = true;

    services.displayManager.autoLogin.enable = true;
    services.displayManager.autoLogin.user = username;
  };
}