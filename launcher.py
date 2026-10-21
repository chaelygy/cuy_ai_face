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

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_JS_PATH = os.path.join(BASE_DIR, "static", "app.js")
ROOT_APP_JS_PATH = os.path.join(BASE_DIR, "app.js")
CLOUDFLARED_EXE = os.path.join(BASE_DIR, "cloudflared.exe")

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex(('127.0.0.1', port)) == 0

def copy_to_clipboard(text):
    try:
        process = subprocess.Popen('clip', stdin=subprocess.PIPE, shell=True)
        process.communicate(input=text.strip().encode('utf-8'))
        return True
    except Exception:
        return False

def get_current_appjs_url():
    if not os.path.exists(APP_JS_PATH):
        return None
    try:
        with open(APP_JS_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
        match = re.search(r"const\s+CLOUD_BACKEND_URL\s*=\s*['\"]([^'\"]+)['\"]", content)
        return match.group(1) if match else None
    except Exception:
        return None

def update_appjs_and_push(new_url):
    old_url = get_current_appjs_url()
    if old_url == new_url:
        print("[Cloudflare Sync] URL tunnel sudah sesuai di static/app.js.")
        return

    print(f"\n[Cloudflare Sync] Memperbarui URL di static/app.js...")
    print(f"  * URL Lama: {old_url}")
    print(f"  * URL Baru: {new_url}")

    try:
        if os.path.exists(APP_JS_PATH):
            with open(APP_JS_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
            updated_content = re.sub(
                r"const\s+CLOUD_BACKEND_URL\s*=\s*['\"][^'\"]+['\"];",
                f"const CLOUD_BACKEND_URL = '{new_url}';",
                content
            )
            with open(APP_JS_PATH, 'w', encoding='utf-8') as f:
                f.write(updated_content)

        if os.path.exists(ROOT_APP_JS_PATH):
            with open(ROOT_APP_JS_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
            updated_content = re.sub(
                r"const\s+CLOUD_BACKEND_URL\s*=\s*['\"][^'\"]+['\"];",
                f"const CLOUD_BACKEND_URL = '{new_url}';",
                content
            )
            with open(ROOT_APP_JS_PATH, 'w', encoding='utf-8') as f:
                f.write(updated_content)

        print("[Cloudflare Sync] [OK] Berhasil memperbarui target URL di frontend!")
    except Exception as e:
        print(f"[Cloudflare Sync] Catatan: {e}")

def main():
    os.system("color 0D" if os.name == "nt" else "")
    print("=" * 68)
    print("       CUY.AI // ROYAL AMETHYST FACIAL INTELLIGENCE PLATFORM")
    print("       DeepFace Facenet512 • RetinaFace • Neural Biometric HUD")
    print("=" * 68)

    processes = []

    def cleanup(sig=None, frame=None):
        print("\n\n[INFO] Menghentikan semua proses server CUY AI...")
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    # 1. Start Python Flask app if not already running on port 5000
    p_app = None
    if is_port_in_use(5000):
        print("\n[1/2] Port 5000 sudah aktif. Menggunakan server yang sedang berjalan.")
    else:
        print("\n[1/2] Menyalakan Backend CUY AI (app.py)...")
        p_app = subprocess.Popen(
            [sys.executable, "app.py"],
            cwd=BASE_DIR
        )
        processes.append(p_app)
        
        print("      Memuat neural weights & pre-warming DeepFace...")
        for i in range(40):
            if is_port_in_use(5000):
                print("      [OK] CUY AI Backend aktif di port 5000!")
                break
            time.sleep(1)

    # Otomatis buka web di browser
    try:
        print("      [BROWSER] Membuka antarmuka CUY AI di: http://localhost:5000")
        webbrowser.open("http://localhost:5000")
    except Exception:
        pass

    # 2. Start Cloudflare Tunnel jika tersedia
    if not os.path.exists(CLOUDFLARED_EXE):
        print(f"\n[INFO] cloudflared.exe tidak ditemukan di {CLOUDFLARED_EXE}.")
        print("Server tetap berjalan di http://localhost:5000")
    else:
        print("\n[2/2] Membuka Cloudflare Tunnel ke internet...")
        p_tunnel = subprocess.Popen(
            [CLOUDFLARED_EXE, "tunnel", "--url", "http://localhost:5000"],
            cwd=BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        processes.append(p_tunnel)

        detected_url = None
        url_regex = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

        # Read output to detect URL
        for _ in range(80):
            line = p_tunnel.stdout.readline()
            if not line:
                break
            match = url_regex.search(line)
            if match:
                detected_url = match.group(0)
                break

        if detected_url:
            copy_to_clipboard(detected_url)
            print("\n" + "=" * 68)
            print("  [ONLINE] SERVER CUY AI BERHASIL TERHUBUNG SECARA PUBLIK!")
            print("=" * 68)
            print(f"  * URL Publik Tunnel : {detected_url}")
            print("  * Clipboard         : URL berhasil disalin otomatis! (Tinggal Ctrl+V)")
            print("=" * 68)

            t = threading.Thread(target=update_appjs_and_push, args=(detected_url,))
            t.daemon = True
            t.start()
        else:
            print("\n[INFO] Menunggu sambungan tunnel Cloudflare...")

    print("\n[INFO] Server CUY AI sedang berjalan aktif.")
    print("[INFO] Tekan Ctrl + C di jendela ini untuk menghentikan server.\n")

    # Keep alive loop
    try:
        while True:
            time.sleep(1)
            if p_app and p_app.poll() is not None:
                print("\n[WARN] Proses app.py berhenti.")
                break
    except KeyboardInterrupt:
        cleanup()

if __name__ == "__main__":
    main()
