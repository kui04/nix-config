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
      unstable.zellij
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
    "net.lutris.Lutris"
  ];

  # bash shell
  programs.fastfetch.enable = true;
  programs.bash.enable = true;
  programs.bash.initExtra = "fastfetch -l windows";
  programs.bash.shellAliases = {
    nv = "nvidia-offload";
    nf = "nix flake new -t github:nix-community/nix-direnv";
    ug = "sudo nixos-rebuild switch --flake ~/.nix-config#thinkbook && flatpak --user update -y";
    up = "sudo nix flake update --flake ~/.nix-config";
    ut = "sudo nixos-rebuild test --flake ~/.nix-config#thinkbook";
    reboot-to-win = "systemctl reboot --boot-loader-entry=auto-windows";
    clean = "sudo nix-collect-garbage -d";
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
