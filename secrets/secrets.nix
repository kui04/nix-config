let
  kui04 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMN36UBmIorLNbb0i0dPUYQPQkwB1kWOHVgv7l6DuZcb";
  fkgfw = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMUYcop/zmlO5TtBnEj/TwNGGNcVKbn/lj5ZVOtSUIvS";
  users = [kui04 fkgfw];

  thinkbook = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAtj7APUSUfvyTWAGNYT0Amf7qS99lwA6vKEMpNIrn8X";
  vps-proxy = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILi2Bktx8pqRLdFl72bS46DBA0reajHtKKsHgZpLGDo";
  systems = [thinkbook vps-proxy];
in {
  "xray-server.age".publicKeys = [fkgfw vps-proxy];
  "xray-client.age".publicKeys = [thinkbook];
}
