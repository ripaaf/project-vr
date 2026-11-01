"""Refine a UTSUSHI scan on the PC with LingBot-Map (a streaming 3D reconstruction model).

The headset sends the camera pictures it took while you scanned, each with where the camera was
(camera-to-world, metres, OpenCV axes: x right, y down, z ahead) and the scan box. LingBot-Map
rebuilds a dense, coloured point map from the pictures alone; its camera path is then matched to
the headset's real one (a similarity: scale, rotation, shift), which puts the result at real size
in the room, and only what is inside the box is kept. Output: a binary PLY in box coordinates
(origin at the middle of the box floor, y up), like the headset's own scans.

    python lingbot_refine.py --job <folder with frames/*.jpg, job.json> --model <lingbot-map.pt> --out <file.ply>

Runs in its own environment (PyTorch + CUDA + the lingbot-map package); see README.
"""
import argparse
import json
import os
import struct
import sys

import numpy as np
import torch


def umeyama(src, dst):
    """Similarity (s, R, t) with dst ≈ s R src + t (least squares)."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    U, D, Vt = np.linalg.svd(cov)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    var = (xs ** 2).sum() / len(src)
    s = np.trace(np.diag(D) @ S) / var
    t = mu_d - s * R @ mu_s
    return s, R, t


def write_ply(path, pts, cols):
    head = (
        "ply\nformat binary_little_endian 1.0\ncomment UTSUSHI scan (LingBot-Map)\n"
        f"element vertex {len(pts)}\nproperty float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    ).encode()
    rec = np.zeros(len(pts), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    rec["x"], rec["y"], rec["z"] = pts[:, 0], pts[:, 1], pts[:, 2]
    rec["r"], rec["g"], rec["b"] = cols[:, 0], cols[:, 1], cols[:, 2]
    with open(path, "wb") as f:
        f.write(head)
        f.write(rec.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--conf", type=float, default=1.5)
    args = ap.parse_args()

    job = json.load(open(os.path.join(args.job, "job.json")))
    # lingbot-map's own loaders and model (installed in this environment)
    sys.argv = [sys.argv[0]]
    import demo  # noqa: E402  (lingbot-map/demo.py: load_images, load_model, postprocess)

    class A:  # the options demo.load_model reads
        mode = "streaming"
        image_size = 518
        patch_size = 14
        enable_3d_rope = True
        max_frame_num = 1024
        num_scale_frames = 4
        kv_cache_sliding_window = 64
        use_sdpa = True  # no FlashInfer needed
        camera_num_iterations = 4
        model_path = args.model

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    images, paths, _ = demo.load_images(image_folder=os.path.join(args.job, "frames"), image_size=518, patch_size=14)
    model = demo.load_model(A, device)
    dtype = torch.bfloat16 if device.type == "cuda" and torch.cuda.get_device_capability()[0] >= 8 else torch.float16
    if device.type == "cuda" and getattr(model, "aggregator", None) is not None:
        model.aggregator = model.aggregator.to(dtype=dtype)
    with torch.no_grad(), torch.amp.autocast(device.type, dtype=dtype, enabled=device.type == "cuda"):
        pred = model.inference_streaming(images.to(device), num_scale_frames=A.num_scale_frames, keyframe_interval=1, output_device=torch.device("cpu"))
    pred, imgs = demo.postprocess(pred, pred.get("images", images))

    pts = pred["world_points"].float().numpy()  # (S, H, W, 3), model's world
    conf = pred["world_points_conf"].float().numpy()  # (S, H, W)
    w2c = pred["extrinsic"].float().numpy()  # (S, 3, 4)
    cols = (imgs.float().numpy().transpose(0, 2, 3, 1) * 255).clip(0, 255).astype(np.uint8)

    # the model's camera centres vs the headset's real ones → real size and place
    names = [os.path.basename(p) for p in paths]
    real = {f["name"]: np.array(f["c2w"], dtype=np.float64).reshape(4, 4) for f in job["frames"]}
    src, dst = [], []
    for i, n in enumerate(names):
        if n not in real:
            continue
        R, t = w2c[i][:, :3], w2c[i][:, 3]
        src.append(-R.T @ t)
        dst.append(real[n][:3, 3])
    s, R, t = umeyama(np.array(src), np.array(dst))

    keep = conf > args.conf
    P = pts[keep].reshape(-1, 3) @ (s * R).T + t  # in the room (world, metres)
    C = cols[keep].reshape(-1, 3)
    # into the box (origin at the floor's middle, y up), and only what is inside it
    box = np.array(job["box"]["w2box"], dtype=np.float64).reshape(4, 4)
    side = float(job["box"]["side"])
    L = P @ box[:3, :3].T + box[:3, 3]
    h = side / 2
    inside = (np.abs(L[:, 0]) <= h) & (np.abs(L[:, 2]) <= h) & (L[:, 1] >= 0.006) & (L[:, 1] <= side)
    L, C = L[inside], C[inside]
    # one point per 2 mm (dense, not wasteful)
    key = np.floor(L / 0.002).astype(np.int64)
    _, first = np.unique(key, axis=0, return_index=True)
    L, C = L[first], C[first]
    write_ply(args.out, L.astype(np.float32), C)
    print(json.dumps({"points": int(len(L)), "scale": float(s), "frames": len(names)}))


if __name__ == "__main__":
    main()
