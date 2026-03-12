let
  _kui04 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMN36UBmIorLNbb0i0dPUYQPQkwB1kWOHVgv7l6DuZcb";
  _users = [_kui04];

  thinkbook = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAtj7APUSUfvyTWAGNYT0Amf7qS99lwA6vKEMpNIrn8X";
  vps-proxy = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILi2Bktx8pqRLdFl72bS46DBA0reajHtKKsHgZpLGDo";
  _hosts = [thinkbook vps-proxy];
in {
  "xray-server.age".publicKeys = [vps-proxy];
  "hysteria-server.age".publicKeys = [vps-proxy];
  "hysteria-server-cert.age".publicKeys = [vps-proxy];
  "hysteria-server-key.age".publicKeys = [vps-proxy];
  "mihomo-client.age".publicKeys = [thinkbook];
}
