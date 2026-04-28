{inputs, ...}: final: prev: {
  unstable = import inputs.nixpkgs-unstable {
    inherit (final) config;
    inherit (final.stdenv.hostPlatform) system;
    overlays = [
      (finalUnstable: prevUnstable: {
        opencode = prevUnstable.opencode.overrideAttrs (old: rec {
          version = "1.14.25";

          src = prevUnstable.fetchFromGitHub {
            owner = "anomalico";
            repo = "opencode";
            tag = "v${version}";
            hash = "sha256-v1aaq4HWAJ5wZm9bUeaRkyKr0iYjdOhigr/I31wwhEk=";
          };

          node_modules = old.node_modules.overrideAttrs (_: {
            outputHash = "sha256-r0UCWhxIB4q4Te+LpXNcfexjfmI4Th2swfWOL3cUp3g=";
          });
        });
      })
    ];
  };
}
