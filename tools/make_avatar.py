#!/usr/bin/env python3
"""Procedural stylised head-and-shoulders avatar -> .glb with mouth and blink morph targets.

  python3 tools/make_avatar.py criminal out/criminal.glb

Written from scratch (no third-party art), so there is nothing to license and no real person's likeness.
Needs numpy only. Open the result in tools/glb_test.html.
"""
import json, struct, sys
import numpy as np

# ---------------- look (sRGB 0-255) ----------------
LOOKS = {
    "criminal": dict(name="Rhea", skin=(205, 154, 121), hair=(34, 24, 20), coat=(34, 40, 58), shirt=(238, 238, 242),
                     iris=(60, 40, 30), lips=(168, 84, 84), brow=0.0, bun=True),
}

def lin(c):
    c = np.array(c, float) / 255.0
    return [float(x) for x in np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)] + [1.0]

def smooth(t):
    t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)

# ---------------- head shape ----------------
RX, RY, RZ = 0.075, 0.098, 0.088
def taper(y):
    return 1 - 0.22 * smooth((-0.010 - y) / 0.090)
def surf_z(x, y):
    f = taper(y)
    inside = 1 - (x / (f * RX)) ** 2 - (y / RY) ** 2
    return f * RZ * np.sqrt(np.maximum(inside, 0))

# ---------------- mesh helpers ----------------
def sphere(rx, ry, rz, c=(0, 0, 0), nlat=40, nlon=56, tap=False, keep=None):
    th = np.linspace(0, np.pi, nlat + 1); ph = np.linspace(0, 2 * np.pi, nlon + 1)[:-1]
    T, P = np.meshgrid(th, ph, indexing="ij")
    y = ry * np.cos(T); f = taper(y) if tap else 1.0
    x = f * rx * np.sin(T) * np.sin(P); z = f * rz * np.sin(T) * np.cos(P)
    V = np.stack([x + c[0], y + c[1], z + c[2]], -1).reshape(-1, 3)
    F = []
    for i in range(nlat):
        for j in range(nlon):
            a = i * nlon + j; b = i * nlon + (j + 1) % nlon; c2 = (i + 1) * nlon + j; d = (i + 1) * nlon + (j + 1) % nlon
            F += [(a, c2, b), (b, c2, d)]
    F = np.array(F)
    F = orient(V, F, np.array(c))
    if keep is not None:
        k = np.array([keep(*v) for v in V - np.array(c) + np.array([0, 0, 0])])
        F = F[k[F].all(1)]
    return V, F

def orient(V, F, center):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    cen = V[F].mean(1) - center
    if (n * cen).sum(1).mean() < 0: F = F[:, [0, 2, 1]]
    return F

def normals(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for k in range(3): np.add.at(n, F[:, k], fn)
    l = np.linalg.norm(n, axis=1, keepdims=True); l[l == 0] = 1
    return n / l

def loft(rings):  # list of (y, rx, rz); closed rings, caps at both ends
    N = 48; ph = np.linspace(0, 2 * np.pi, N + 1)[:-1]
    V = []; 
    for y, rx, rz in rings: V += [(rx * np.sin(p), y, rz * np.cos(p)) for p in ph]
    V = np.array(V); F = []
    for i in range(len(rings) - 1):
        for j in range(N):
            a = i * N + j; b = i * N + (j + 1) % N; c = (i + 1) * N + j; d = (i + 1) * N + (j + 1) % N
            F += [(a, c, b), (b, c, d)]
    top = len(V); V = np.vstack([V, [0, rings[0][0] + 0.004, 0], [0, rings[-1][0], 0]])
    for j in range(N): F.append((top, j, (j + 1) % N))
    base = (len(rings) - 1) * N
    for j in range(N): F.append((top + 1, base + (j + 1) % N, base + j))
    F = np.array(F); return V, orient(V, F, np.array([0, V[:, 1].mean(), 0]))

# ---------------- mouth ----------------
MOUTH_Y = -0.050
SHAPES = {  # half-width, half-height, centre drop
    "rest": (0.020, 0.0006, 0.0),
    "jawOpen": (0.018, 0.017, 0.0085),
    "viseme_aa": (0.019, 0.016, 0.0080),
    "viseme_O": (0.0115, 0.011, 0.0055),
    "viseme_U": (0.008, 0.006, 0.0030),
    "viseme_E": (0.025, 0.007, 0.0035),
    "viseme_I": (0.024, 0.0035, 0.0015),
    "mouthFunnel": (0.0095, 0.008, 0.0040),
    "mouthPucker": (0.007, 0.004, 0.0020),
}
def mouth_parts(w, h, drop):
    cy = MOUTH_Y - drop; S = 28; R = 4
    ph = np.linspace(0, 2 * np.pi, S + 1)[:-1]
    # interior fan
    zi = lambda x: surf_z(x, MOUTH_Y) + 0.0022
    V = [(0, cy, zi(0))]
    for r in range(1, R + 1):
        for p in ph:
            x = w * r / R * np.cos(p); y = cy + h * r / R * np.sin(p); V.append((x, y, zi(x)))
    Fi = [(0, 1 + j, 1 + (j + 1) % S) for j in range(S)]
    for r in range(1, R):
        for j in range(S):
            a = 1 + (r - 1) * S + j; b = 1 + (r - 1) * S + (j + 1) % S; c = 1 + r * S + j; d = 1 + r * S + (j + 1) % S
            Fi += [(a, c, b), (b, c, d)]
    Vi = np.array(V)
    # lips: strip between inner and outer ellipse
    ow, oh = w + 0.0035, h + 0.0048; L = []
    for p in ph:
        x = w * np.cos(p); y = cy + h * np.sin(p); L.append((x, y, zi(x) + 0.0014))
    for p in ph:
        x = ow * np.cos(p); y = cy + oh * np.sin(p); L.append((x, y, zi(x) + 0.0022))
    Fl = []
    for j in range(S):
        a = j; b = (j + 1) % S; c = S + j; d = S + (j + 1) % S
        Fl += [(a, b, c), (b, d, c)]
    # upper teeth: a thin white strip under the top edge of the opening (collapses to nothing when the mouth is shut)
    T = []; xs = np.linspace(-0.62 * w, 0.62 * w, 13)
    th = min(0.40 * h, 0.0042)
    for x in xs:
        top = cy + 0.92 * h * np.sqrt(max(1 - (x / w) ** 2, 0)); T += [(x, top, zi(x) + 0.0006), (x, top - th, zi(x) + 0.0006)]
    Ft = []
    for k in range(1, len(xs)):
        i = 2 * k; Ft += [(i - 2, i, i - 1), (i - 1, i, i + 1)]
    return Vi, np.array(Fi), np.array(L), np.array(Fl), np.array(T), np.array(Ft)

# ---------------- GLB writer ----------------
class Glb:
    def __init__(self): self.buf = bytearray(); self.bv = []; self.acc = []; self.mats = []; self.meshes = []; self.nodes = []
    def _view(self, data, target=None):
        while len(self.buf) % 4: self.buf.append(0)
        off = len(self.buf); self.buf += data.tobytes()
        v = dict(buffer=0, byteOffset=off, byteLength=data.nbytes)
        if target: v["target"] = target
        self.bv.append(v); return len(self.bv) - 1
    def accessor(self, a, kind, target=None, bounds=False):
        a = np.ascontiguousarray(a, dtype=np.uint32 if kind == "SCALAR" else np.float32)
        d = dict(bufferView=self._view(a, target), componentType=5125 if kind == "SCALAR" else 5126,
                 count=int(a.shape[0] if kind != "SCALAR" else a.size), type=kind)
        if bounds: d["min"] = [float(x) for x in a.min(0)]; d["max"] = [float(x) for x in a.max(0)]
        self.acc.append(d); return len(self.acc) - 1
    def material(self, name, rgb, rough=0.6):
        self.mats.append(dict(name=name, doubleSided=True, pbrMetallicRoughness=dict(baseColorFactor=lin(rgb), metallicFactor=0.0, roughnessFactor=rough)))
        return len(self.mats) - 1
    def mesh(self, name, V, F, mat, targets=None):
        V = np.asarray(V, np.float32); F = np.asarray(F, np.uint32); N = normals(V, F).astype(np.float32)
        prim = dict(attributes=dict(POSITION=self.accessor(V, "VEC3", 34962, True), NORMAL=self.accessor(N, "VEC3", 34962)),
                    indices=self.accessor(F.reshape(-1), "SCALAR", 34963), material=mat)
        m = dict(name=name, primitives=[prim])
        if targets:
            names = list(targets)
            prim["targets"] = [dict(POSITION=self.accessor(np.asarray(targets[n], np.float32) - V, "VEC3", None, True)) for n in names]
            m["extras"] = dict(targetNames=names); m["weights"] = [0.0] * len(names)
        self.meshes.append(m); return len(self.meshes) - 1
    def node(self, name, mesh=None, children=None, t=None):
        n = dict(name=name)
        if mesh is not None: n["mesh"] = mesh
        if children: n["children"] = children
        if t: n["translation"] = t
        self.nodes.append(n); return len(self.nodes) - 1
    def save(self, path, root):
        js = dict(asset=dict(version="2.0", generator="chambersai make_avatar.py"), scene=0, scenes=[dict(nodes=[root])], nodes=self.nodes,
                  meshes=self.meshes, materials=self.mats, accessors=self.acc, bufferViews=self.bv, buffers=[dict(byteLength=len(self.buf))])
        j = json.dumps(js).encode(); j += b" " * (-len(j) % 4)
        b = bytes(self.buf) + b"\0" * (-len(self.buf) % 4)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(b)))
            f.write(struct.pack("<II", len(j), 0x4E4F534A) + j); f.write(struct.pack("<II", len(b), 0x004E4942) + b)

# ---------------- build ----------------
def build(look, path):
    g = Glb(); L = LOOKS[look]
    skin, hair = g.material("skin", L["skin"], 0.7), g.material("hair", L["hair"], 0.45)
    coat, shirt = g.material("coat", L["coat"], 0.8), g.material("shirt", L["shirt"], 0.8)
    white, iris = g.material("eye_white", (244, 244, 247), 0.3), g.material("iris", L["iris"], 0.3)
    lipm, inner = g.material("lips", L["lips"], 0.5), g.material("mouth_inside", (46, 14, 18), 0.9)

    # head with jaw morph targets
    hv, hf = sphere(RX, RY, RZ, tap=True, nlat=44, nlon=64)
    wj = smooth((-0.028 - hv[:, 1]) / 0.035)
    jaw = lambda d: np.stack([np.zeros(len(hv)), -d * wj, -0.2 * d * wj], 1)
    head_t = {n: hv + jaw(s[1] * 1.15) for n, s in SHAPES.items() if n != "rest"}
    parts = [g.node("Face", g.mesh("Face", hv, hf, skin, head_t))]

    # mouth
    Vi, Fi, Ll, Fl, Tv, Tf = mouth_parts(*SHAPES["rest"])
    ti, tl, tt = {}, {}, {}
    for n, s in SHAPES.items():
        if n == "rest": continue
        a, _, b, _, c3, _ = mouth_parts(*s); ti[n], tl[n], tt[n] = a, b, c3
    parts.append(g.node("MouthInside", g.mesh("MouthInside", Vi, Fi, inner, ti)))
    parts.append(g.node("Lips", g.mesh("Lips", Ll, Fl, lipm, tl)))
    parts.append(g.node("Teeth", g.mesh("Teeth", Tv, Tf, white, tt)))

    # eyes, lids, brows, nose, ears
    for side, sx in (("Left", 1), ("Right", -1)):
        c = np.array([sx * 0.032, 0.012, 0.0668])
        v, f = sphere(0.0152, 0.0152, 0.0152, c, 18, 28); parts.append(g.node("Eye" + side, g.mesh("Eye" + side, v, f, white)))
        v, f = sphere(0.0094, 0.0094, 0.0030, c + [0, 0, 0.0142], 12, 20); parts.append(g.node("Iris" + side, g.mesh("Iris" + side, v, f, iris)))
        lv, lf = sphere(0.0186, 0.0186, 0.0186, c, 16, 24)
        collapsed = lv.copy(); collapsed[:, 1] = np.maximum(collapsed[:, 1], c[1] + 0.0058)
        parts.append(g.node("Lid" + side, g.mesh("Lid" + side, collapsed, lf, skin, {"eyeBlink" + side: lv})))
        xs = np.linspace(0.014, 0.052, 9); ys = 0.042 + 0.006 * np.sin(np.pi * np.linspace(0, 1, 9) * 0.85)
        bv, bf = [], []
        for k, (x, y) in enumerate(zip(xs, ys)):
            z = surf_z(x, y) + 0.0025; bv += [(sx * x, y + 0.0020, z), (sx * x, y - 0.0020, z)]
            if k: i = 2 * k; bf += [(i - 2, i, i - 1), (i - 1, i, i + 1)]
        parts.append(g.node("Brow" + side, g.mesh("Brow" + side, bv, bf, hair)))
        v, f = sphere(0.007, 0.018, 0.012, [sx * 0.0765, -0.002, -0.004], 10, 14); parts.append(g.node("Ear" + side, g.mesh("Ear" + side, v, f, skin)))
    v, f = sphere(0.0085, 0.011, 0.009, [0, -0.015, surf_z(0, -0.015) + 0.002], 14, 20); parts.append(g.node("Nose", g.mesh("Nose", v, f, skin)))

    # hair: cap over top/back (same taper as head), plus a bun
    def keep(x, y, z):
        hl = 0.030 + 0.036 * np.cos(np.clip(abs(x) / RX, 0, 1) * np.pi / 2) ** 1.5
        return (z < -0.010 and y > -0.050) or (y > hl)
    v, f = sphere(RX * 1.07, RY * 1.06, RZ * 1.08, [0, 0.005, -0.006], 170, 230, tap=True, keep=keep)
    parts.append(g.node("Hair", g.mesh("Hair", v, f, hair)))
    if L["bun"]:
        v, f = sphere(0.036, 0.036, 0.034, [0, 0.030, -0.108], 18, 26); parts.append(g.node("Bun", g.mesh("Bun", v, f, hair)))

    geo = g.node("HeadGeo", children=parts, t=[0, 0.07, 0])
    head = g.node("Head", children=[geo], t=[0, -0.07, 0])

    # neck, torso, shirt
    ys = np.linspace(-0.04, -0.125, 6)
    nv, nf = loft([(y, 0.036, 0.036) for y in ys]); neck = g.node("Neck", g.mesh("Neck", nv, nf, skin))
    prof = [(-0.108, .045, .045), (-0.125, .075, .055), (-0.145, .14, .075), (-0.175, .185, .095), (-0.22, .195, .10), (-0.30, .19, .10), (-0.40, .18, .095)]
    yy = np.arange(-0.108, -0.4001, -0.012)
    rings = [(y, np.interp(-y, [-p[0] for p in prof], [p[1] for p in prof]), np.interp(-y, [-p[0] for p in prof], [p[2] for p in prof])) for y in yy]
    tv, tf = loft(rings); torso = g.node("Torso", g.mesh("Torso", tv, tf, coat))
    def tz(x, y):
        rx = np.interp(-y, [-p[0] for p in prof], [p[1] for p in prof]); rz = np.interp(-y, [-p[0] for p in prof], [p[2] for p in prof])
        return rz * np.sqrt(max(1 - (x / rx) ** 2, 0)) + 0.0022
    sv, sf = [], []; rowsN, cols = 12, 7
    for r in range(rowsN + 1):
        t = r / rowsN; y = -0.112 - 0.135 * t; hw = 0.038 * (1 - t) + 0.001
        for c in range(cols):
            x = -hw + 2 * hw * c / (cols - 1); sv.append((x, y, tz(x, y)))
    for r in range(rowsN):
        for c in range(cols - 1):
            a = r * cols + c; sf += [(a, a + 1, a + cols), (a + 1, a + cols + 1, a + cols)]
    shirt_n = g.node("Shirt", g.mesh("Shirt", sv, sf, shirt))
    root = g.node(L["name"], children=[torso, neck, shirt_n, head])
    g.save(path, root); return path

if __name__ == "__main__":
    look = sys.argv[1] if len(sys.argv) > 1 else "criminal"
    out = sys.argv[2] if len(sys.argv) > 2 else f"{look}.glb"
    build(look, out); import os; print(out, os.path.getsize(out) // 1024, "KB")
