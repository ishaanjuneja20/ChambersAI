#!/usr/bin/env bash
# Run on your Mac from the data folder:  bash deploy/push_data.sh ubuntu@YOUR_VM_IP path/to/ssh_key
# Copies only what the backend needs (chunks + bge-m3 vectors), not the 30 GB of raw data.
set -euo pipefail
HOST="$1"; KEY="${2:-$HOME/.ssh/id_rsa}"
ssh -i "$KEY" "$HOST" "sudo mkdir -p /opt/chambersai-data/corpus/chunks /opt/chambersai-data/corpus/embeddings && sudo chown -R \$USER /opt/chambersai-data"
rsync -avz -e "ssh -i $KEY" corpus/chunks/acts "$HOST:/opt/chambersai-data/corpus/chunks/"
rsync -avz -e "ssh -i $KEY" corpus/embeddings/bge-m3 "$HOST:/opt/chambersai-data/corpus/embeddings/"
