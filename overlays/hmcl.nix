final: prev: {
  hmcl = prev.hmcl.override {
    minecraftJdks = [
      # JavaFX runtime (main HMCL launcher runtime)
      (prev.jdk.override {enableJavaFX = true;})
      # For MC 1.12.2 and below
      prev.jdk8
      # For MC 1.17+
      prev.jdk17
      # For MC 1.21+
      prev.jdk21
    ];
  };
}
