let
  _kui04 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMN36UBmIorLNbb0i0dPUYQPQkwB1kWOHVgv7l6DuZcb";
  _users = [ _kui04 ];

  thinkbook = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAtj7APUSUfvyTWAGNYT0Amf7qS99lwA6vKEMpNIrn8X";

  vultr = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDCpz6d04JtnGhHu+xE+h+mANl14pKocGOLvYAnsOXBA";
  oracle = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGwafuzUALFT+paueoF1MH3Q0qrI9ubYv0HH4aBgALlc";

  proxy-vps = [
    vultr
    oracle
  ];
in
{
  "xray-server.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "hysteria-server.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "hysteria-server-cert.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "hysteria-server-key.age".publicKeys = [ thinkbook ] ++ proxy-vps;
}
