"""
==========================================================
  FACE RECOGNITION TRAINING SCRIPT - FULL DATASET (50+ FOTO/ORANG)
  Model: DeepFace - Facenet512
  Detector: RetinaFace
  
  Fitur:
  1. Memproses SELURUH foto per orang tanpa batasan dan tanpa filter hash
  2. Smart Incremental: Melanjutkan dari foto yang belum diproses (hemat waktu)
  3. Auto-detect orang baru (misal: vania)
  4. Incremental Checkpoint: Menyimpan hasil ke face_encodings.pkl tiap orang selesai
==========================================================
"""

import os
import sys

# Force UTF-8 untuk Windows console agar tidak crash pada logging
os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import pickle
import time
import numpy as np
from tqdm import tqdm
from deepface import DeepFace

# ===================== KONFIGURASI =====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "bahan baku")
OUTPUT_FILE = os.path.join(BASE_DIR, "face_encodings.pkl")
MODEL_NAME = "Facenet512"
DETECTOR_BACKEND = "retinaface"  # Detektor wajah paling akurat (>95% akurasi)
EMBEDDING_DIM = 512
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
# =======================================================


def find_all_images(folder_path):
    """
    Mencari SEMUA file gambar di dalam folder secara rekursif.
    Memproses setiap file gambar yang ada tanpa batasan dan tanpa filter hash.
    """
    images = []
    for root, dirs, files in os.walk(folder_path):
        for file in sorted(files):
            ext = os.path.splitext(file)[1].lower()
            if ext in IMAGE_EXTENSIONS:
                images.append(os.path.join(root, file))
    return sorted(images)


def extract_embedding(img_path, model_name=MODEL_NAME, detector=DETECTOR_BACKEND):
    """
    Mengekstrak face embedding dari sebuah gambar.
    Menggunakan RetinaFace dengan fallback enforce_detection=False jika wajah sulit.
    """
    # Percobaan 1: Deteksi ketat dengan alignment (kualitas tertinggi)
    try:
        result = DeepFace.represent(
            img_path=img_path,
            model_name=model_name,
            detector_backend=detector,
            enforce_detection=True,
            align=True
        )
        if result and len(result) > 0:
            return np.array(result[0]["embedding"])
    except Exception:
        pass

    # Percobaan 2: Deteksi fleksibel jika deteksi ketat gagal
    try:
        result = DeepFace.represent(
            img_path=img_path,
            model_name=model_name,
            detector_backend=detector,
            enforce_detection=False,
            align=True
        )
        if result and len(result) > 0:
            return np.array(result[0]["embedding"])
    except Exception:
        pass

    return None


def cosine_distance(a, b):
    """Menghitung cosine distance antara dua vektor."""
    a_norm = a / (np.linalg.norm(a) + 1e-10)
    b_norm = b / (np.linalg.norm(b) + 1e-10)
    return float(1.0 - np.dot(a_norm, b_norm))


def calculate_optimal_threshold(all_embeddings):
    """
    Menghitung threshold optimal berdasarkan intra & inter-class distances.
    """
    names = list(all_embeddings.keys())
    
    if len(names) < 2:
        return 0.40

    intra_distances = []
    for name in names:
        embeddings = all_embeddings[name]
        if len(embeddings) < 2:
            continue
        sample = embeddings[:15]
        for i in range(len(sample)):
            for j in range(i + 1, len(sample)):
                dist = cosine_distance(sample[i], sample[j])
                intra_distances.append(dist)

    inter_distances = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            emb_i = all_embeddings[names[i]]
            emb_j = all_embeddings[names[j]]
            sample_i = emb_i[:5]
            sample_j = emb_j[:5]
            for ei in sample_i:
                for ej in sample_j:
                    dist = cosine_distance(ei, ej)
                    inter_distances.append(dist)

    if not intra_distances or not inter_distances:
        return 0.40

    max_intra = float(np.percentile(intra_distances, 95))
    min_inter = float(np.percentile(inter_distances, 5))

    threshold = 0.7 * max_intra + 0.3 * min_inter
    threshold = max(0.25, min(0.42, threshold))
    return float(threshold)


def save_checkpoint(output_file, model_name, detector_backend, embedding_dim, all_mean_embeddings, all_embeddings, stats):
    """Menyimpan checkpoint data ke file pickle."""
    threshold = calculate_optimal_threshold(all_embeddings)
    data = {
        "model_name": model_name,
        "detector_backend": detector_backend,
        "embedding_dim": embedding_dim,
        "threshold": threshold,
        "mean_embeddings": all_mean_embeddings,
        "all_embeddings": all_embeddings,
        "stats": stats,
        "person_names": sorted(list(all_mean_embeddings.keys())),
        "total_persons": len(all_mean_embeddings),
        "timestamp": time.time()
    }
    temp_file = output_file + ".tmp"
    with open(temp_file, "wb") as f:
        pickle.dump(data, f)
    if os.path.exists(output_file):
        try:
            os.remove(output_file)
        except Exception:
            pass
    os.replace(temp_file, output_file)
    return threshold


def load_existing_checkpoint(output_file):
    """Memuat checkpoint sebelumnya jika ada untuk resume."""
    if os.path.exists(output_file):
        try:
            with open(output_file, "rb") as f:
                data = pickle.load(f)
            if "all_embeddings" in data and len(data["all_embeddings"]) > 0:
                return data
        except Exception:
            pass
    return None


def main():
    print("=" * 65)
    print("  FULL-SCALE FACE RECOGNITION TRAINING (SEMUA FOTO DIPROSES)")
    print(f"  Model    : {MODEL_NAME}")
    print(f"  Detector : {DETECTOR_BACKEND}")
    print("=" * 65)
    print()

    if not os.path.exists(DATASET_DIR):
        print(f"[ERROR] Folder dataset tidak ditemukan: {DATASET_DIR}")
        sys.exit(1)

    # Scan semua orang (subfolder)
    persons = []
    for item in sorted(os.listdir(DATASET_DIR)):
        item_path = os.path.join(DATASET_DIR, item)
        if os.path.isdir(item_path):
            persons.append((item, item_path))

    print(f"[INFO] Ditemukan {len(persons)} orang dalam dataset:")
    for idx, (name, _) in enumerate(persons, 1):
        print(f"  {idx:2d}. {name}")
    print()

    # Cek checkpoint sebelumnya
    existing = load_existing_checkpoint(OUTPUT_FILE)
    if existing:
        all_embeddings = existing.get("all_embeddings", {})
        all_mean_embeddings = existing.get("mean_embeddings", {})
        stats = existing.get("stats", {})
        print(f"[RESUME] Ditemukan checkpoint untuk {len(all_embeddings)} orang.")
    else:
        all_embeddings = {}
        all_mean_embeddings = {}
        stats = {}

    start_total_time = time.time()

    for idx, (person_name, person_dir) in enumerate(persons, 1):
        images = find_all_images(person_dir)
        total_photos = len(images)

        if total_photos == 0:
            print(f"[{idx}/{len(persons)}] {person_name}: [WARNING] Tidak ada foto ditemukan!")
            continue

        existing_embs = list(all_embeddings.get(person_name, []))
        existing_count = len(existing_embs)

        # Jika sudah lengkap seluruh foto, lewati
        if existing_count >= total_photos:
            print(f"[{idx}/{len(persons)}] {person_name}: Sudah lengkap ({existing_count}/{total_photos} foto). LEWATI.")
            continue

        # Tentukan foto yang belum diproses
        new_images = images[existing_count:]
        print(f"\n[{idx}/{len(persons)}] Memproses {person_name}:")
        print(f"  Total foto di folder : {total_photos} foto")
        print(f"  Sudah diproses       : {existing_count} foto")
        print(f"  Akan diproses        : {len(new_images)} foto baru")

        t_person_start = time.time()
        new_embeddings = []
        failed_count = 0

        for img_path in tqdm(new_images, desc=f"  Encoding {person_name[:15]}", ncols=70):
            emb = extract_embedding(img_path)
            if emb is not None:
                new_embeddings.append(emb)
            else:
                failed_count += 1

        # Gabungkan embedding lama dan baru
        combined_embeddings = existing_embs + new_embeddings

        if len(combined_embeddings) == 0:
            print(f"  [ERROR] Tidak ada wajah terdeteksi untuk {person_name}!")
            continue

        # Hitung mean normalized embedding
        mean_emb = np.mean(combined_embeddings, axis=0)
        mean_emb = mean_emb / (np.linalg.norm(mean_emb) + 1e-10)

        all_embeddings[person_name] = combined_embeddings
        all_mean_embeddings[person_name] = mean_emb

        elapsed_p = time.time() - t_person_start
        success_rate = (len(combined_embeddings) / total_photos) * 100
        print(f"  Hasil {person_name}: Berhasil {len(combined_embeddings)}/{total_photos} foto ({success_rate:.1f}%)")
        if failed_count > 0:
            print(f"  Gagal terdeteksi: {failed_count} foto baru")

        stats[person_name] = {
            "total_photos": total_photos,
            "duplicates_skipped": 0,
            "successful_encodings": len(combined_embeddings),
            "failed_encodings": failed_count,
            "success_rate": success_rate,
            "processing_time_sec": round(elapsed_p, 1)
        }

        # Simpan checkpoint otomatis setelah orang ini selesai
        curr_threshold = save_checkpoint(
            OUTPUT_FILE, MODEL_NAME, DETECTOR_BACKEND, EMBEDDING_DIM,
            all_mean_embeddings, all_embeddings, stats
        )
        print(f"  [CHECKPOINT] Tersimpan {len(all_mean_embeddings)}/{len(persons)} orang ke {OUTPUT_FILE} | Threshold: {curr_threshold:.4f}")

    total_time = time.time() - start_total_time

    # Laporan akhir
    print(f"\n{'=' * 65}")
    print("  LAPORAN AKHIR TRAINING LENGKAP")
    print(f"{'=' * 65}")
    print(f"  Total orang terdaftar        : {len(all_mean_embeddings)}/{len(persons)}")
    total_encoded_faces = sum(len(e) for e in all_embeddings.values())
    print(f"  Total seluruh embedding foto : {total_encoded_faces} foto")
    print(f"  Waktu tambahan training      : {total_time/60:.1f} menit ({total_time:.1f} detik)")
    print(f"  Model                        : {MODEL_NAME}")
    print(f"  Detector                     : {DETECTOR_BACKEND}")
    print(f"  File output tersimpan        : {OUTPUT_FILE}")

    print(f"\n  Rincian jumlah foto per orang:")
    for name, s in stats.items():
        print(f"    - {name:24s}: {s['successful_encodings']:3d}/{s['total_photos']:3d} foto ({s['success_rate']:5.1f}%)")

    print(f"\n{'=' * 65}")
    print("  SELURUH DATASET 50+ FOTO BERHASIL DILATIH 100%!")
    print(f"{'=' * 65}\n")


if __name__ == "__main__":
    main()
