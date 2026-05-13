let
  _kui04 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMN36UBmIorLNbb0i0dPUYQPQkwB1kWOHVgv7l6DuZcb";
  _users = [ _kui04 ];

  thinkbook = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAtj7APUSUfvyTWAGNYT0Amf7qS99lwA6vKEMpNIrn8X";

  vultr = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDCpz6d04JtnGhHu+xE+h+mANl14pKocGOLvYAnsOXBA";
  oracle = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINnWtFuTpNE4XGhrIt5ZT3ESzdhMCmwcyL9HaEBoeIvl";

  proxy-vps = [ vultr oracle ];
in
{
  "xray-server.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "hysteria-server.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "hysteria-server-cert.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "hysteria-server-key.age".publicKeys = [ thinkbook ] ++ proxy-vps;
}
