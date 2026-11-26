# zellij-mcp-server (https://github.com/kui04/zellij-mcp-server) is not in
# nixpkgs, so build the latest release tag from source.
final: prev: {
  zellij-mcp-server = final.callPackage (
    {
      lib,
      rustPlatform,
      fetchFromGitHub,
    }:
    let
      version = "0.1.1";
    in
    rustPlatform.buildRustPackage {
      pname = "zellij-mcp-server";
      inherit version;

      src = fetchFromGitHub {
        owner = "kui04";
        repo = "zellij-mcp-server";
        tag = "v${version}";
        hash = "sha256-qkvNqyoniFEXAwjUOOPmx6Ydoh2XJD8VF81xP/TIXTo=";
      };

      cargoHash = "sha256-PczBg1pIY68+RPkiK0Dlz9kYq+njqrc3Y2P+wDOpJ/U=";

      # The e2e suite drives a real `zellij 0.46.1` session and needs a
      # terminal, which the build sandbox lacks. Run the unit and fixture
      # suites only; upstream CI does the same on non-Linux runners.
      cargoTestFlags = [
        "--lib"
        "--test"
        "core_tests"
        "--test"
        "orchestrator_tests"
      ];

      meta = {
        description = "Asynchronous Zellij-backed terminal orchestration MCP server over stdio";
        homepage = "https://github.com/kui04/zellij-mcp-server";
        mainProgram = "zellij-mcp-server";
        platforms = lib.platforms.unix;
        # upstream does not ship a license file yet
      };
    }
  ) { };
}
