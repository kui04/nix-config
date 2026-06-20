{inputs, ...}: final: prev: {
  unstable = import inputs.nixpkgs-unstable {
    inherit (final) config;
    inherit (final.stdenv.hostPlatform) system;

    # unstable package overlays
    overlays = [
      # inputs.opencode.overlays.default
    ];
  };
}
