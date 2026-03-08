{
  inputs,
  pkgs,
  username,
  ...
}: {
  imports = [
    # include the results of the hardware scan
    ./hardware.nix

    # common
    ../../common/i18n.nix
    ../../common/networking.nix
    ../../common/audio.nix

    # services
    ../../services/flatpak.nix
    ../../services/gdm.nix
    ../../services/niri.nix
    ../../services/sunshine.nix
  ];

  # flakes
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  # nix settings and cachix
  nix.settings.trusted-users = [
    "root"
    username
  ];

  # allow unfree packages
  nixpkgs.config.allowUnfree = true;
  # overlays
  nixpkgs.overlays = [
    inputs.chinese-fonts.overlays.default
    (import ../../overlays/hmcl.nix)
    (import ../../overlays/pkgs-unstable.nix {inherit inputs;})
  ];

  # list packages installed in system profile
  environment.systemPackages = with pkgs; [
    nil
    neovim
    wget
    git
    cachix
    unzip
    zip
    fd
    file
    tree
    alejandra
    inputs.agenix.packages.${stdenv.hostPlatform.system}.default
  ];

  # adb
  programs.adb.enable = true;
  # obs
  programs.obs-studio.enable = true;
  programs.obs-studio.enableVirtualCamera = true;

  # define a user account. don't forget to set a password with 'passwd'.
  users.users.${username} = {
    isNormalUser = true;
    description = username;
    extraGroups = [
      "networkmanager"
      "wheel"
      "docker"
      "libvirtd"
      "adbusers"
    ];
  };

  # bootloader
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

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
      options = ["discard"]; # equivalent to swapon --discard
    }
  ];
  # this is needed for zswap lz4 algorithm
  boot.initrd.systemd.enable = true;
  boot.initrd.kernelModules = ["lz4"];
  boot.kernelParams = [
    "zswap.enabled=1" # enables zswap
    "zswap.compressor=lz4" # compression algorithm
    "zswap.max_pool_percent=20" # maximum percentage of RAM that zswap is allowed to use
    "zswap.shrinker_enabled=1" # whether to shrink the pool proactively on high memory pressure
    "zswap.pool=zsmalloc" # zswap backend to use
  ];

  # virtualization
  virtualisation.docker.enable = true;
  virtualisation.libvirtd.enable = true;

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

  # create_ap service tuned for 80 MHz 5 GHz operation
  services.create_ap = {
    enable = true;
    settings = {
      INTERNET_IFACE = "enp0s31f6";
      WIFI_IFACE = "wlp44s0";
      SSID = "my-ap";
      PASSPHRASE = "asdfghjkl";
      SHARE_METHOD = "nat";
      GATEWAY = "192.168.12.1";

      # Force a clean 80 MHz chunk on the high-power UNII-3 range.
      FREQ_BAND = "5";
      CHANNEL = "149";
      COUNTRY = "CN";

      WPA_VERSION = "3";
      DRIVER = "nl80211";

      # Enable every PHY mode the NIC supports to squeeze out peak throughput.
      IEEE80211N = "1";
      IEEE80211AC = "1";
      IEEE80211AX = "1";

      # Prefer 40 MHz HT with SGI and STBC so legacy HT clients stay fast.
      HT_CAPAB = "[HT40+][SHORT-GI-40][TX-STBC][RX-STBC1]";

      # Unlock 80 MHz VHT goodies, incl. beamforming for better range.
      VHT_CAPAB = "[MAX-MPDU-11454][SHORT-GI-80][TX-STBC][RX-STBC-1][SU-BEAMFORMEE][MU-BEAMFORMEE]";
    };
  };

  # This value determines the NixOS release from which the default
  # settings for stateful data, like file locations and database versions
  # on your system were taken. It's perfectly fine and recommended to leave
  # this value at the release version of the first install of this system.
  # Before changing this value read the documentation for this option
  # (e.g. man configuration.nix or on https://nixos.org/nixos/options.html).
  system.stateVersion = "25.05"; # Did you read the comment?
}
