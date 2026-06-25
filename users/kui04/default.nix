{
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
      entr
      ffmpeg-full
      gnome-system-monitor
      lm_sensors
      mission-center
      qemu
      qtscrcpy
      ripgrep
      vlc
      # from unstable
      unstable.antigravity
      unstable.hmcl
      unstable.ollama-cuda
      unstable.opencode
      unstable.vscode
      unstable.zellij
      unstable.zed-editor
    ];
  };

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
  ];

  # bash shell
  programs.fastfetch.enable = true;
  programs.bash.enable = true;
  programs.bash.initExtra = "fastfetch -l windows";
  programs.bash.shellAliases = {
    clean = "sudo nix-collect-garbage -d";
    nv = "nvidia-offload";
    nf = "nix flake new -t github:nix-community/nix-direnv";
    po = "NIRI_SOCKET=$(find /run/user/$(id -u) -name 'niri.*.sock' -type s 2>/dev/null | head -1) niri msg action power-on-monitors";
    reboot-to-win = "systemctl reboot --boot-loader-entry=auto-windows";
    ug = "sudo nixos-rebuild switch --flake ~/.nix-config#thinkbook";
    up = "sudo nix flake update --flake ~/.nix-config";
    ut = "sudo nixos-rebuild test --flake ~/.nix-config#thinkbook";
  };

  # starship
  programs.starship.enable = true;
  programs.starship.enableBashIntegration = true;
  programs.starship.settings = builtins.fromTOML (builtins.readFile ../.config/starship.toml);

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
}
