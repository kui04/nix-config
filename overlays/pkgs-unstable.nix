{ inputs, ... }: final: prev: {
  unstable = import inputs.nixpkgs-unstable {
    inherit (final) config;
    inherit (final.stdenv.hostPlatform) system;

    # unstable package overlays
    overlays = [
      (import ./codegraph.nix)
      (import ./hmcl.nix)
    ];
  };
}
