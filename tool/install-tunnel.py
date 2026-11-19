#!/usr/bin/env python3
"""Install a dedicated userspace-only Tailscale agent inside the game container.
Run as root only after approval. Does not enable Funnel or advertise any routes.
"""
import hashlib,io,os,platform,subprocess,tarfile,urllib.request
from pathlib import Path
version='1.104.7'
arch={'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine())
if os.geteuid()!=0 or arch is None:raise SystemExit('Root in the supported game container is required.')
destination=Path('/usr/local/lib/smart-bunny-tunnel')
if destination.exists():raise SystemExit('Dedicated install directory already exists; inspect it instead of overwriting.')
name=f'tailscale_{version}_{arch}.tgz'
base='https://pkgs.tailscale.com/stable/'
with urllib.request.urlopen(base+name+'.sha256',timeout=30) as response:expected=response.read(1024).decode().split()[0]
with urllib.request.urlopen(base+name,timeout=60) as response:archive=response.read(80*1024*1024+1)
if len(archive)>80*1024*1024 or hashlib.sha256(archive).hexdigest()!=expected:raise SystemExit('Official archive checksum did not match.')
with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as source:
 binaries={}
 for binary in ('tailscale','tailscaled'):
  member=source.getmember(f'tailscale_{version}_{arch}/{binary}')
  if not member.isfile() or member.size>100*1024*1024:raise SystemExit('Unexpected binary in archive.')
  binaries[binary]=source.extractfile(member).read()
destination.mkdir(mode=0o755)
for name,data in binaries.items():
 path=destination/name;path.write_bytes(data);path.chmod(0o755)
unit=Path('/etc/systemd/system/smart-bunny-tunnel.service')
if unit.exists():raise SystemExit('Dedicated service already exists; not replacing it.')
unit.write_text('''[Unit]
Description=Smart Bunny HTTPS tunnel agent (userspace only)
After=network-online.target
Wants=network-online.target
[Service]
User=smart-bunny-tunnel
DynamicUser=yes
StateDirectory=smart-bunny-tunnel
StateDirectoryMode=0700
RuntimeDirectory=smart-bunny-tunnel
RuntimeDirectoryMode=0700
ExecStart=/usr/local/lib/smart-bunny-tunnel/tailscaled --tun=userspace-networking --state=/var/lib/smart-bunny-tunnel/tailscaled.state --socket=/run/smart-bunny-tunnel/tailscaled.sock --port=0
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
''')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','smart-bunny-tunnel.service'],check=True)
print('Installed verified Tailscale '+version+' in a dedicated userspace service. Funnel is not enabled.')
