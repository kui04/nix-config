{inputs, ...}: final: prev: {
  unstable = import inputs.nixpkgs-unstable {
    inherit (final) config;
    inherit (final.stdenv.hostPlatform) system;
    overlays = [
      (finalUnstable: prevUnstable: {
        opencode = prevUnstable.opencode.overrideAttrs (old: rec {
          version = "1.14.31";

          src = prevUnstable.fetchFromGitHub {
            owner = "anomalico";
            repo = "opencode";
            tag = "v${version}";
            hash = "sha256-VHznPS2OuJ8urQqGK3K0ysQLCk+O8JV7/UCDdFyqafQ=";
          };

          node_modules = old.node_modules.overrideAttrs (_: {
            outputHash = "sha256-f/cWCr6Oqnq21u9+UyhwE5PGqE9X5K+NtjEGbZ4ORPg=";
          });
        });
      })
    ];
  };
}
