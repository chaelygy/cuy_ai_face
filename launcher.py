"""
==========================================================
  CUY AI - SMART AUTO LAUNCHER
  Royal Amethyst Facial Intelligence Platform
  Menjalankan: Backend Flask + Cloudflare Tunnel + Auto Browser
==========================================================
"""

import os
import sys
import time
import re
import socket
import subprocess
import threading
import signal
import webbrowser
import urllib.request

# Pastikan output tidak di-buffer
os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_JS_PATH = os.path.join(BASE_DIR, "static", "app.js")
ROOT_APP_JS_PATH = os.path.join(BASE_DIR, "app.js")
CLOUDFLARED_EXE = os.path.join(BASE_DIR, "cloudflared.exe")
PORT = 5001

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.8)
        return s.connect_ex(('127.0.0.1', port)) == 0

def check_server_health(port=PORT):
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/health",
            headers={"User-Agent": "CUY-AI-Launcher/1.0"}
        )
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            return resp.status == 200
    except Exception:
        return False

def kill_process_on_port(port):
    """Membunuh proses zombie yang menempati port target di Windows."""
    if os.name != 'nt':
        return
    try:
        cmd = f'powershell -Command "(Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue).OwningProcess"'
        out = subprocess.check_output(cmd, shell=True, text=True).strip()
        if out:
            pids = set(out.split())
            for pid in pids:
                if pid and pid.isdigit() and int(pid) != os.getpid():
                    print(f"      [CLEANUP] Menghentikan proses lama di port {port} (PID: {pid})...", flush=True)
                    subprocess.run(["taskkill", "/F", "/T", "/PID", pid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1.0)
    except Exception:
        pass

def kill_process_tree(p):
    """Menghentikan proses beserta seluruh child sub-process."""
    if not p:
        return
    try:
        if os.name == 'nt':
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            p.terminate()
    except Exception:
        pass

def copy_to_clipboard(text):
    try:
        process = subprocess.Popen('clip', stdin=subprocess.PIPE, shell=True)
        process.communicate(input=text.strip().encode('utf-8'))
        return True
    except Exception:
        return False

def get_current_appjs_url():
    target = APP_JS_PATH if os.path.exists(APP_JS_PATH) else ROOT_APP_JS_PATH
    if not os.path.exists(target):
        return None
    try:
        with open(target, 'r', encoding='utf-8') as f:
            content = f.read()
        match = re.search(r"const\s+CLOUD_BACKEND_URL\s*=\s*['\"]([^'\"]+)['\"]", content)
        return match.group(1) if match else None
    except Exception:
        return None

def update_appjs_and_push(new_url):
    old_url = get_current_appjs_url()
    if old_url == new_url:
        print("[Cloudflare Sync] URL tunnel sudah sesuai di frontend.", flush=True)
        return

    print(f"\n[Cloudflare Sync] Memperbarui target URL di frontend...", flush=True)
    print(f"  * URL Lama : {old_url}", flush=True)
    print(f"  * URL Baru : {new_url}", flush=True)

    files_updated = False
    for p in (APP_JS_PATH, ROOT_APP_JS_PATH):
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    content = f.read()
                updated = re.sub(
                    r"const\s+CLOUD_BACKEND_URL\s*=\s*['\"][^'\"]+['\"];",
                    f"const CLOUD_BACKEND_URL = '{new_url}';",
                    content
                )
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(updated)
                files_updated = True
            except Exception as e:
                print(f"[Cloudflare Sync] Gagal update {os.path.basename(p)}: {e}", flush=True)

    if files_updated:
        print("[Cloudflare Sync] [OK] Berhasil memperbarui file app.js!", flush=True)

    # Sinkronisasi ke Git repo jika repo git tersedia (agar Vercel auto-redeploy)
    if os.path.exists(os.path.join(BASE_DIR, ".git")):
        try:
            print("[Cloudflare Sync] Memeriksa sync ke GitHub/Vercel...", flush=True)
            subprocess.run(["git", "add", "app.js", "static/app.js"], cwd=BASE_DIR, capture_output=True, timeout=8)
            res = subprocess.run(
                ["git", "commit", "-m", f"Auto-sync Cloudflare tunnel URL: {new_url}"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=8
            )
            if res.returncode == 0:
                print("[Cloudflare Sync] Pushing update ke Git remote...", flush=True)
                push_res = subprocess.run(["git", "push"], cwd=BASE_DIR, capture_output=True, text=True, timeout=15)
                if push_res.returncode == 0:
                    print("[Cloudflare Sync] [OK] Berhasil di-push! Vercel akan otomatis reload.", flush=True)
                else:
                    print("[Cloudflare Sync] Catatan: push dilewati atau butuh verifikasi.", flush=True)
        except Exception:
            pass

def main():
    if os.name == "nt":
        try:
            os.system("color 0D")
        except Exception:
            pass

    print("=" * 68, flush=True)
    print("       CUY.AI // ROYAL AMETHYST FACIAL INTELLIGENCE PLATFORM", flush=True)
    print("       DeepFace Facenet512 • RetinaFace • Neural Biometric HUD", flush=True)
    print("=" * 68, flush=True)

    processes = []

    def cleanup(sig=None, frame=None):
        print("\n\n[INFO] Menghentikan semua proses server CUY AI...", flush=True)
        for p in processes:
            kill_process_tree(p)
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    # 1. Start Python Flask app if not already running & healthy
    p_app = None
    if is_port_in_use(PORT):
        if check_server_health(PORT):
            print(f"\n[1/2] Port {PORT} sudah aktif dan merespon normal.", flush=True)
            print("      Menggunakan instance backend yang sedang berjalan.", flush=True)
        else:
            print(f"\n[1/2] Port {PORT} terdeteksi aktif tapi tidak merespon health check.", flush=True)
            kill_process_on_port(PORT)
            time.sleep(1)

    if not is_port_in_use(PORT):
        print(f"\n[1/2] Menyalakan Backend CUY AI di port {PORT}...", flush=True)
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PORT"] = str(PORT)

        p_app = subprocess.Popen(
            [sys.executable, "-u", "app.py"],
            cwd=BASE_DIR,
            env=env
        )
        processes.append(p_app)

        print("      Memuat neural weights & pre-warming DeepFace Facenet512...", flush=True)
        started = False
        for _ in range(45):
            if p_app.poll() is not None:
                print(f"\n[ERROR] Backend app.py berhenti mendadak dengan return code {p_app.poll()}!", flush=True)
                cleanup()
                return

            if is_port_in_use(PORT) and check_server_health(PORT):
                print(f"      [OK] CUY AI Backend aktif & sehat di port {PORT}!", flush=True)
                started = True
                break
            time.sleep(1.0)

        if not started and is_port_in_use(PORT):
            print(f"      [OK] CUY AI Backend merespon di port {PORT}!", flush=True)

    # 2. Buka browser lokal
    local_url = f"http://localhost:{PORT}"
    try:
        print(f"      [BROWSER] Membuka antarmuka CUY AI di: {local_url}", flush=True)
        webbrowser.open(local_url)
    except Exception:
        pass

    # 3. Start Cloudflare Tunnel jika file executable tersedia
    if not os.path.exists(CLOUDFLARED_EXE):
        print(f"\n[INFO] cloudflared.exe tidak ditemukan di {CLOUDFLARED_EXE}.", flush=True)
        print(f"Server tetap berjalan lokal di {local_url}", flush=True)
    else:
        print(f"\n[2/2] Membuka Cloudflare Tunnel ke internet untuk port {PORT}...", flush=True)
        p_tunnel = subprocess.Popen(
            [CLOUDFLARED_EXE, "tunnel", "--url", f"http://localhost:{PORT}"],
            cwd=BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        processes.append(p_tunnel)

        url_regex = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
        tunnel_url = [None]
        url_event = threading.Event()

        # Thread kontinu pembaca stdout untuk mencegah deadlock pipa OS
        def pipe_reader():
            try:
                for line in iter(p_tunnel.stdout.readline, ''):
                    if not line:
                        break
                    if not url_event.is_set():
                        m = url_regex.search(line)
                        if m:
                            tunnel_url[0] = m.group(0)
                            url_event.set()
            except Exception:
                pass

        reader_thread = threading.Thread(target=pipe_reader, daemon=True)
        reader_thread.start()

        # Tunggu sampai URL terdeteksi maksimal 25 detik
        if url_event.wait(timeout=25.0):
            detected = tunnel_url[0]
            copy_to_clipboard(detected)
            print("\n" + "=" * 68, flush=True)
            print("  [ONLINE] SERVER CUY AI BERHASIL TERHUBUNG SECARA PUBLIK!", flush=True)
            print("=" * 68, flush=True)
            print(f"  * URL Publik Tunnel : {detected}", flush=True)
            print(f"  * URL Lokal         : {local_url}", flush=True)
            print("  * Clipboard         : URL publik otomatis disalin! (Tinggal Ctrl+V)", flush=True)
            print("=" * 68, flush=True)

            t_sync = threading.Thread(target=update_appjs_and_push, args=(detected,), daemon=True)
            t_sync.start()
        else:
            print(f"\n[INFO] Tunnel Cloudflare masih berproses. Akses lokal siap di {local_url}", flush=True)

    print("\n[INFO] Server CUY AI sedang berjalan aktif.")
    print("[INFO] Tekan Ctrl + C di jendela ini untuk menghentikan server kapan saja.\n", flush=True)

    # Keep alive loop
    try:
        while True:
            time.sleep(1.0)
            if p_app and p_app.poll() is not None:
                print(f"\n[WARN] Proses app.py berhenti (Code: {p_app.poll()}).", flush=True)
                break
    except KeyboardInterrupt:
        cleanup()

if __name__ == "__main__":
    main()
