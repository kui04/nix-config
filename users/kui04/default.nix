{
  config,
  lib,
  pkgs,
  username,
  ...
}:
let
  homeDirectory = "/home/${username}";
in
{
  imports = [
    ../.shared/flatpak.nix
    ../.shared/fcitx5.nix
    ../.shared/niri.nix
    ../.shared/stylix.nix
    ../.shared/pi.nix
  ];

  home = {
    inherit username;
    inherit homeDirectory;
    stateVersion = "25.05";

    packages = with pkgs; [
      chromium
      conda
      devenv
      entr
      ffmpeg-full
      gh
      gnome-system-monitor
      llm-agents.opencode
      lm_sensors
      mission-center
      qemu
      qtscrcpy
      ripgrep
      vlc
      # from unstable
      unstable.hmcl
      unstable.vscode
      unstable.zellij
      unstable.zed-editor
      unstable.helix
    ];
  };

  # xdg user dirs
  xdg.userDirs.enable = true;
  xdg.userDirs.setSessionVariables = true;

  services.flatpak.packages = [
    "com.getpostman.Postman"
    "com.github.gmg137.netease-cloud-music-gtk"
    "com.github.tchx84.Flatseal"
    "com.github.wwmm.easyeffects"
    "com.google.AndroidStudio"
    "com.google.Chrome"
    "com.moonlight_stream.Moonlight"
    "com.qq.QQ"
    "com.tencent.WeChat"
    "com.valvesoftware.Steam"
    "io.dbeaver.DBeaverCommunity"
    "io.github.giantpinkrobots.flatsweep"
    "md.obsidian.Obsidian"
    "net.agalwood.Motrix"
    "net.codelogistics.clicker"
    "net.lutris.Lutris"
    "org.gnome.font-viewer"
    "org.kde.okular"
    "org.libreoffice.LibreOffice"
    "org.localsend.localsend_app"
    "org.mozilla.firefox"
    "org.qbittorrent.qBittorrent"
    "org.telegram.desktop"
    "org.tigervnc.vncviewer"
  ];

  # bash shell
  programs.bash.enable = true;

  programs.bash.shellAliases = {
    nf = "nix flake new -t github:nix-community/nix-direnv";
    niri-socket = "export NIRI_SOCKET=$(find /run/user/$(id -u) -maxdepth 1 -name 'niri.*.sock' 2>/dev/null | head -n1)";
    reboot-to-win = "systemctl reboot --boot-loader-entry=auto-windows";
    # nixos-rebuild commands (flake)
    ug = "sudo nixos-rebuild switch --flake ~/.nix-config#thinkbook";
    up = "sudo nix flake update --flake ~/.nix-config";
    ut = "sudo nixos-rebuild test --flake ~/.nix-config#thinkbook";
    clean = "sudo nix-collect-garbage -d";
    # waydroid window size presets (20:9 phone, 16:10 tablet, 16:9 fhd)
    waydroid-phone = "waydroid-size 450 1000";
    waydroid-tablet = "waydroid-size 1280 800";
    waydroid-fhd = "waydroid-size 1920 1080";
  };

  # waydroid-size <width> <height>: set android resolution and restart session
  programs.bash.bashrcExtra = ''
    waydroid-size() {
      if [ $# -ne 2 ]; then
        echo "usage: waydroid-size <width> <height> (e.g. waydroid-size 450 1000)"
        return 1
      fi
      waydroid prop set persist.waydroid.width "$1" || return 1
      waydroid prop set persist.waydroid.height "$2" || return 1
      waydroid session stop
      setsid nohup waydroid session start > /tmp/waydroid-session.log 2>&1 < /dev/null & disown
      echo "waydroid size set to $1x$2, session restarting (log: /tmp/waydroid-session.log)"
    }
  '';

  # starship
  programs.starship.enable = true;
  programs.starship.enableBashIntegration = true;
  programs.starship.settings = fromTOML (builtins.readFile ../.config/starship.toml);

  # git config
  programs.git.enable = true;
  programs.git.settings.user.name = "kui04";
  programs.git.settings.user.email = "likuiandmc2004@gmail.com";

  # jj-vcs
  programs.jujutsu.enable = true;
  programs.jujutsu.settings.user.name = "kui04";
  programs.jujutsu.settings.user.email = "likuiandmc2004@gmail.com";

  # direnv
  programs.direnv.enable = true;
  programs.direnv.enableBashIntegration = true;

  # atuin
  programs.atuin.enable = true;
  programs.atuin.daemon.enable = true;
  programs.atuin.enableBashIntegration = true;

  # install this repo's pre-commit hook (nix-managed, idempotent)
  home.activation.installNixConfigGitHook = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    repo_root="${config.home.homeDirectory}/.nix-config"
    if [ -d "$repo_root/.git" ] && [ -f "$repo_root/hooks/pre-commit" ]; then
      mkdir -p "$repo_root/.git/hooks"
      ln -sf "$repo_root/hooks/pre-commit" "$repo_root/.git/hooks/pre-commit"
    fi
  '';
}
