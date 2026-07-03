{
  inputs,
  pkgs,
  lib,
  username,
  ...
}:
{
  imports = [
    # include the results of the hardware scan
    ./hardware.nix

    # common
    ../../common/i18n.nix
    ../../common/networking.nix
    ../../common/audio.nix

    # services
    ../../services/xdg-portal.nix
    ../../services/flatpak.nix
    ../../services/ly.nix
    ../../services/niri.nix
    ../../services/sunshine.nix
  ];

  # flakes
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  # nix settings
  nix.settings.trusted-users = [
    "root"
    username
  ];

  # cuda cache
  nix.settings = {
    substituters = [
      "https://cache.nixos-cuda.org"
    ];
    trusted-public-keys = [
      "cache.nixos-cuda.org:74DUi4Ye579gUqzH4ziL9IyiJBlDpMRn9MBN8oNan9M="
    ];
  };

  # allow unfree packages
  nixpkgs.config.allowUnfree = true;
  # overlays
  nixpkgs.overlays = [
    inputs.chinese-fonts.overlays.default
    inputs.llm-agents.overlays.default
    (import ../../overlays/pkgs-unstable.nix { inherit inputs; })
  ];

  # list packages installed in system profile
  environment.systemPackages = with pkgs; [
    alejandra
    android-tools
    busybox
    cachix
    dnsmasq # needed for the default libvirt network
    fd
    file
    git
    gnumake
    inputs.agenix.packages.${stdenv.hostPlatform.system}.default
    inputs.boo.packages.${stdenv.hostPlatform.system}.default
    neovim
    nil
    pciutils
    tree
    unzip
    wget
    zip
    gpu-screen-recorder-gtk
  ];

  # obs
  programs.obs-studio.enable = true;
  programs.obs-studio.enableVirtualCamera = true;
  # for promptless recording on both cli and gui
  programs.gpu-screen-recorder.enable = true;
  # nix-ld
  programs.nix-ld.dev.enable = true;

  # define a user account. don't forget to set a password with 'passwd'.
  users.users.${username} = {
    isNormalUser = true;
    description = username;
    extraGroups = [
      "networkmanager"
      "wheel"
      "docker"
      "libvirtd"
    ];
  };

  # thermald
  services.thermald.enable = true;

  # boot related
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.extraModprobeConfig = ''
    options rtw89_pci disable_aspm_l1=y disable_aspm_l1ss=y
  '';

  # systemd
  systemd.user.extraConfig = ''
    DefaultTimeoutStartSec=30s
    DefaultTimeoutStopSec=30s
  '';

  # zswap
  swapDevices = [
    {
      device = "/var/lib/swapfile";
      size = 16 * 1024; # 16 GB
      options = [ "discard" ]; # equivalent to swapon --discard
    }
  ];
  # this is needed for zswap lz4 algorithm
  boot.initrd.systemd.enable = true;
  boot.initrd.kernelModules = [ "lz4" ];
  boot.kernelParams = [
    "zswap.enabled=1" # enables zswap
    "zswap.compressor=lz4" # compression algorithm
    "zswap.max_pool_percent=20" # maximum percentage of RAM that zswap is allowed to use
    "zswap.shrinker_enabled=1" # whether to shrink the pool proactively on high memory pressure
    "zswap.pool=zsmalloc" # zswap backend to use
  ];

  # docker
  virtualisation.docker.enable = true;

  # nvidia-container-toolkit for GPU passthrough in docker
  hardware.nvidia-container-toolkit.enable = true;

  # libvirtd
  virtualisation.libvirtd = {
    enable = true;
    # shared folders
    qemu.vhostUserPackages = with pkgs; [ virtiofsd ];
  };
  # virt-manager
  programs.virt-manager.enable = true;
  # spice guest vdagent daemon
  services.spice-vdagentd.enable = true;

  # allow it through firewall filter
  networking.firewall.trustedInterfaces = [ "virbr0" ];

  # graphics
  hardware.graphics.enable = true;
  hardware.graphics.extraPackages = with pkgs; [
    # Required for modern Intel GPUs (Xe iGPU and ARC)
    intel-media-driver # VA-API (iHD) userspace
    vpl-gpu-rt # oneVPL (QSV) runtime
    intel-compute-runtime # OpenCL (NEO) + Level Zero for Arc/Xe
  ];
  environment.sessionVariables = {
    LIBVA_DRIVER_NAME = "iHD"; # Prefer the modern iHD backend
    # Force GTK to use the GL renderer, and related issue: https://gitlab.freedesktop.org/mesa/mesa/-/work_items/13319
    GSK_RENDERER = "gl";
  };
  services.xserver.videoDrivers = [
    "modesetting"
    "nvidia"
  ];
  hardware.nvidia.open = false;
  hardware.nvidia.prime = {
    offload.enable = true;
    offload.enableOffloadCmd = true;
    # sync.enable = true;

    intelBusId = "PCI:0:2:0";
    nvidiaBusId = "PCI:1:0:0";
  };

  # nvidia prime switcher
  services.switcherooControl.enable = true;

  # enable CUPS to print documents.
  services.printing.enable = true;

  # enable touchpad support (enabled default in most desktopManager).
  services.libinput.enable = true;

  # enable the OpenSSH daemon.
  services.openssh.enable = true;

  # create_ap service for 5 GHz Wi-Fi 6 hotspot
  services.create_ap = {
    enable = true;
    settings = {
      INTERNET_IFACE = "enp0s31f6";
      WIFI_IFACE = "wlp44s0";
      SSID = "my-ap";
      PASSPHRASE = "asdfghjkl";
      FREQ_BAND = "5";
      CHANNEL = "149";
      COUNTRY = "CN";
      WPA_VERSION = "2";
      IEEE80211N = "1";
      IEEE80211AC = "1";
      IEEE80211AX = "1";
      HT_CAPAB = "[HT40+][SHORT-GI-40][TX-STBC][RX-STBC1]";
      VHT_CAPAB = "[MAX-MPDU-11454][SHORT-GI-80][TX-STBC][RX-STBC-1][SU-BEAMFORMEE][MU-BEAMFORMEE]";
    };
  };

  # systemd services
  systemd.services.NetworkManager-wait-online.enable = false;

  # create_ap: don't auto-start, start manually with: sudo systemctl start create_ap
  systemd.services.create_ap.wantedBy = lib.mkForce [ ];

  # This value determines the NixOS release from which the default
  # settings for stateful data, like file locations and database versions
  # on your system were taken. It's perfectly fine and recommended to leave
  # this value at the release version of the first install of this system.
  # Before changing this value read the documentation for this option
  # (e.g. man configuration.nix or on https://nixos.org/nixos/options.html).
  system.stateVersion = "25.05"; # Did you read the comment?
}
