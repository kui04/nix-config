{
  inputs = {
    # packages
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    # unstable packages
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # home-manager, used for managing user configuration
    home-manager.url = "github:nix-community/home-manager/release-25.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    # age-encrypted secrets
    agenix.url = "github:ryantm/agenix";
    agenix.inputs.nixpkgs.follows = "nixpkgs";

    # declarative flatpak manager
    nix-flatpak.url = "github:gmodena/nix-flatpak/?ref=latest";

    # theming framework
    stylix.url = "github:nix-community/stylix/release-25.11";
    stylix.inputs.nixpkgs.follows = "nixpkgs";

    # chinese fonts from windows iso
    chinese-fonts.url = "github:brsvh/chinese-fonts-overlay/main";
  };

  outputs = inputs @ {
    self,
    nixpkgs,
    home-manager,
    ...
  }: {
    formatter.x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.alejandra;

    nixosConfigurations.thinkbook = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = {
        inherit inputs;
        username = "kui04";
        hostname = "thinkbook";
      };

      modules = [
        ./hosts/thinkbook

        # agenix module for managing secrets
        inputs.agenix.nixosModules.default

        # home-manager module
        home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;

          home-manager.extraSpecialArgs = {
            inherit inputs;
            username = "kui04";
            hostname = "thinkbook";
          };
          home-manager.users."kui04".imports = [
            ./users/kui04

            inputs.nix-flatpak.homeManagerModules.nix-flatpak
            inputs.stylix.homeModules.stylix
          ];
        }
      ];
    };

    homeConfigurations.fkgfw = home-manager.lib.homeManagerConfiguration {
      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
      extraSpecialArgs = {
        username = "fkgfw";
        agenix = inputs.agenix;
      };
      modules = [
        ./users/fkgfw

        inputs.agenix.homeManagerModules.default
      ];
    };
  };
}
