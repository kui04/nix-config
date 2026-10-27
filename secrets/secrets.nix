let
  _kui04 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMN36UBmIorLNbb0i0dPUYQPQkwB1kWOHVgv7l6DuZcb";
  _users = [ _kui04 ];

  thinkbook = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAtj7APUSUfvyTWAGNYT0Amf7qS99lwA6vKEMpNIrn8X";

  vultr = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH2LUjG9oOQsscE/PrppVg5zqQYVJj0W/AnEN13U8Y3L";
  oracle = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGwafuzUALFT+paueoF1MH3Q0qrI9ubYv0HH4aBgALlc";

  proxy-vps = [
    vultr
    oracle
  ];
in
{
  "sing-box-server.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "sing-box-cert.age".publicKeys = [ thinkbook ] ++ proxy-vps;
  "sing-box-key.age".publicKeys = [ thinkbook ] ++ proxy-vps;
}
