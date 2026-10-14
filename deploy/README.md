# Deploy the backend on Oracle Cloud (Always Free)

The frontend (a Hugging Face **Static** Space or anything else) calls this API over HTTPS. The Gemini key lives only on the
server. Console labels change, so treat the names below as a guide.

## 1. Create the machine (Oracle console)
1. Compute > Instances > Create instance. Image: **Ubuntu 22.04**. Shape: **Ampere (VM.Standard.A1.Flex)** with as much of the
   free allowance as the console offers (aim for 2+ OCPU and 12+ GB RAM; bge-m3 needs ~3 GB). "Out of capacity" is common: retry
   later or in another availability domain.
2. Upload your **public** SSH key (or let Oracle generate one and download the private key). Keep a public IP.
3. After it is created: Networking > your VCN > Security List > **add ingress rules** for TCP **80** and **443** from 0.0.0.0/0.
4. Idle machines can be reclaimed (very low CPU, network and memory for 7 days). Keep it used, and keep a backup of the setup.

## 2. A free HTTPS name
The frontend is on https, so the API must be https too. Make a free name at duckdns.org pointing at the VM's public IP
(for example `chambersai.duckdns.org`). Caddy (below) then fetches and renews the certificate by itself.

## 3. On the VM (`ssh -i key ubuntu@VM_IP`)
```bash
sudo apt update && sudo apt install -y python3-venv git curl debian-keyring debian-archive-keyring apt-transport-https gpg
# Ubuntu images on Oracle block ports with iptables rules; open 80/443:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt install -y iptables-persistent && sudo netfilter-persistent save
# Caddy (official packages)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
# Code
sudo mkdir -p /opt/chambersai && sudo chown ubuntu /opt/chambersai
git clone -b deploy/oracle https://github.com/ishaanjuneja20/ChambersAI.git /opt/chambersai   # private repo: use a token or deploy key
cd /opt/chambersai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

## 4. Send the data (from your Mac, in the data folder)
```bash
bash deploy/push_data.sh ubuntu@VM_IP ~/.ssh/your_key      # needs the repo's deploy/ folder copied next to the data
```
It copies `corpus/chunks/acts` and `corpus/embeddings/bge-m3` only (about 20 MB).

## 5. Configure and start (on the VM)
```bash
sudo cp /opt/chambersai/deploy/.env.example /etc/chambersai.env && sudo chmod 600 /etc/chambersai.env
sudo nano /etc/chambersai.env          # put the real GEMINI_API_KEY and your frontend's https address
sudo cp /opt/chambersai/deploy/chambersai.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now chambersai
sudo cp /opt/chambersai/deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile   # your duckdns name
sudo systemctl restart caddy
```
The first start downloads bge-m3 (about 2.3 GB) and takes a few minutes. Watch with `journalctl -u chambersai -f`.

## 6. Test
```bash
curl https://YOURNAME.duckdns.org/health
curl -s https://YOURNAME.duckdns.org/ask -H 'Content-Type: application/json' \
  -d '{"lawyer":"criminal","question":"what is the punishment for murder?"}'
```

## Rules that still apply
- The Gemini key is only in `/etc/chambersai.env` (mode 600). Never in git, never in the frontend.
- Question text is not logged by the app; do not turn on request-body logging.
- `CHAMBERS_ALLOWED_ORIGINS` must list the real frontend address only.
- Update: `cd /opt/chambersai && git pull && sudo systemctl restart chambersai`.
