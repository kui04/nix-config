{
  pkgs,
  username,
  ...
}: let
  homeDirectory = "/home/${username}";
in {
  imports = [
    ../.shared/flatpak.nix
    ../.shared/fcitx5.nix
    ../.shared/niri.nix
    ../.shared/stylix.nix
  ];

  home = {
    inherit username;
    inherit homeDirectory;
    stateVersion = "25.05";

    packages = with pkgs; [
      entr
      conda
      virt-manager
      qemu
      vlc
      qtscrcpy
      mission-center
      ripgrep
      lm_sensors
      ffmpeg-full
      # from unstable
      unstable.hmcl
      unstable.vscode
      unstable.zed-editor
      unstable.antigravity
      unstable.opencode
    ];
  };

  services.flatpak.packages = [
    "com.qq.QQ"
    "com.tencent.WeChat"
    "com.getpostman.Postman"
    "com.github.tchx84.Flatseal"
    "com.moonlight_stream.Moonlight"
    "com.valvesoftware.Steam"
    "com.google.AndroidStudio"
    "com.google.Chrome"
    "com.usebottles.bottles"
    "com.github.wwmm.easyeffects"
    "md.obsidian.Obsidian"
    "io.dbeaver.DBeaverCommunity"
    "io.github.giantpinkrobots.flatsweep"
    "io.github.qier222.YesPlayMusic"
    "org.kde.okular"
    "org.localsend.localsend_app"
    "org.telegram.desktop"
    "org.mozilla.firefox"
    "org.qbittorrent.qBittorrent"
    "org.gnome.font-viewer"
    "org.libreoffice.LibreOffice"
    "net.codelogistics.clicker"
    "net.agalwood.Motrix"
  ];

  # bash shell
  programs.bash.enable = true;
  programs.bash.shellAliases = {
    nv = "nvidia-offload";
    nf = "nix flake new -t github:nix-community/nix-direnv";
    up = "sudo nixos-rebuild switch --flake ~/.nix-config#thinkbook";
    ug = "sudo nix flake update --flake ~/.nix-config && flatpak --user update -y";
    ut = "sudo nixos-rebuild test --flake ~/.nix-config#thinkbook";
    reboot-to-win = "systemctl reboot --boot-loader-entry=auto-windows";
    clean = "sudo nix-collect-garbage -d";
  };

  # git config
  programs.git.enable = true;
  programs.git.settings.user.name = "kui04";
  programs.git.settings.user.email = "likuiandmc2004@gmail.com";

  # direnv
  programs.direnv.enable = true;
  programs.direnv.enableBashIntegration = true;
}
