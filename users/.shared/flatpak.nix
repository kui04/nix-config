{
  config,
  lib,
  pkgs,
  ...
}: let
  homeDirectory = config.home.homeDirectory;
in {
  home.file = {
    # flatpak font/icon fixes
    # ".local/share/fonts".source = mkOutOfStoreSymlink "/run/current-system/sw/share/X11/fonts";
    # ".icons".source = "${pkgs.bibata-cursors}/share/icons";
  };

  # temporarily fix nix-flatpak icon issue
  xdg.systemDirs.data = [
    "/var/lib/flatpak/exports/share"
    "${homeDirectory}/.local/share/flatpak/exports/share"
  ];

  # flatpak shared settings
  services.flatpak.update.auto.enable = false;
  services.flatpak.uninstallUnmanaged = true;

  services.flatpak.overrides = {
    global = {
      Context = {
        filesystems = [
          # fix flaptak fonts issue
          "${homeDirectory}/.local/share/fonts:ro"
          "${homeDirectory}/.icons:ro"
          "/nix/store:ro"
          "/run/current-system/sw/share/X11/fonts:ro"
          "${pkgs.bibata-cursors}/share/icons:ro"
        ];
      };
    };

    "com.valvesoftware.Steam" = {
      Environment = {
        GDK_BACKEND = "x11";
        XDG_SESSION_TYPE = "x11";
        __NV_PRIME_RENDER_OFFLOAD = "1";
        __GLX_VENDOR_LIBRARY_NAME = "nvidia";
        __GL_THREADED_OPTIMIZATIONS = "0";
      };
    };
  };
}
