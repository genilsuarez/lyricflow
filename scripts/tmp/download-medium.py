from huggingface_hub import snapshot_download
path = snapshot_download("Systran/faster-whisper-medium", local_dir_use_symlinks=False)
print(f"Downloaded to: {path}")
