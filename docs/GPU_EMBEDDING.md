# Embedding the judgments on a Windows GPU PC (RTX 5070)

Folder to upload: `for_gpu_pc.zip` (made on the Mac from the RAG Datasets folder). Unzip it somewhere short, e.g. `C:\for_gpu_pc`.

## 1. One-time setup (PowerShell)
1. Install Python 3.11 from python.org and tick **Add python.exe to PATH**. Check the GPU driver: `nvidia-smi` should list the card (RTX 50-series needs a recent driver, 570 or newer).
2. In PowerShell:
```
cd C:\for_gpu_pc
python -m venv venv
venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install sentence-transformers numpy
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```
The last line must print `True` and the card name. If `Activate.ps1` is blocked, run `Set-ExecutionPolicy -Scope Process Bypass` first, or use `venv\Scripts\activate.bat` in cmd. A "no kernel image" error means an old PyTorch build: re-run the torch install line with `--upgrade --force-reinstall`.

## 2. Benchmark (a few minutes, also downloads the 2.3 GB model once)
```
python tools\build_judgment_chunks.py --root . --years 1950 --out-dir C:\for_gpu_pc\bench
```
Look at the last "1950: ... chunks written ... s elapsed" line. Chunks per second = chunks / seconds. All 1950-2026 is about 1.28 million chunks, so hours = 1,280,000 / (chunks per second) / 3600.

## 3. Real run (resumable: Ctrl+C and re-run the same command to continue)
```
python tools\build_judgment_cards.py --root .
python tools\build_judgment_chunks.py --root .
```
Cards take minutes. Chunks take hours. Keep the PC awake (disable sleep and idle disconnect).

## 4. Bring back
Zip `corpus\judgments_index` (3-4 GB) and download it to the Mac data folder at `corpus/judgments_index`.
