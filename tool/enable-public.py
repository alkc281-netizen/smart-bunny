#!/usr/bin/env python3
"""Create the loopback-only external listener. The tunnel is enabled separately."""
import argparse,importlib.util,subprocess
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('origin');args=parser.parse_args()
backend=Path('/usr/local/lib/smart-bunny/bunny-server.py')
spec=importlib.util.spec_from_file_location('bunny',backend);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
origin=b.public_origin(args.origin)
unit=Path('/etc/systemd/system/smart-bunny-public.service')
if unit.exists():raise SystemExit('Existing public unit must be inspected; not overwriting it.')
unit.write_text(f'''[Unit]
Description=Smart Bunny external HTTPS origin (loopback only)
After=smart-bunny.service smart-bunny-tunnel.service
Requires=smart-bunny.service
[Service]
User=smart-bunny
DynamicUser=yes
StateDirectory=smart-bunny
StateDirectoryMode=0700
ExecStart=/usr/bin/python3 {backend} --bind 127.0.0.1 --port 8098 --public-origin {origin} --directory /srv/smart-bunny --database /var/lib/smart-bunny/progress.sqlite
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
''')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','smart-bunny-public.service'],check=True)
print('Loopback HTTPS origin prepared for '+origin+'. The LAN listener and database path are unchanged.')
