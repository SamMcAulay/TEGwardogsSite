// The sky-island diorama: a toon-shaded floating island at sunset, a black helicopter that a missile
// launcher shoots down into the tower, on a loop. Ported from the approved mockup
// (.superpowers/brainstorm/…/scene-v5.html). Loaded only in the browser, after first paint.
import * as T from 'three';
import type { Story } from '@/lib/scene/story';

export interface World {
  /** Advance the picture by dt seconds for the current story; reports when the missile hits. */
  frame(dt: number, story: Story): { missileHit: boolean };
  setOffset(x: number, y: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

interface Bit {
  obj: T.Group;
  v: T.Vector3;
  life: number;
  max: number;
  size: number;
  spin: T.Vector3 | null;
}

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;
const box = (w: number, h: number, d: number) => new T.BoxGeometry(w, h, d);

export function createWorld(canvas: HTMLCanvasElement): World {
  const R = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  R.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  R.shadowMap.enabled = true;
  R.shadowMap.type = T.PCFShadowMap;
  const S = new T.Scene();
  const C = new T.PerspectiveCamera(36, 1, 1, 500);
  let view = { w: 1, h: 1 };

  /* Toon look: 3-step shading plus inverted-hull outlines of even thickness, to match the cards' edges. */
  const grad = new T.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, T.RedFormat);
  grad.minFilter = grad.magFilter = T.NearestFilter;
  grad.needsUpdate = true;
  const EDGE = new T.MeshBasicMaterial({ color: 0x07060a, side: T.BackSide });
  const mats = new Map<string, T.MeshToonMaterial>();
  const mat = (c: number, em?: number) => {
    const k = `${c}|${em ?? ''}`;
    if (!mats.has(k)) mats.set(k, new T.MeshToonMaterial({ color: c, gradientMap: grad, emissive: em ?? 0 }));
    return mats.get(k)!;
  };
  function part(geo: T.BufferGeometry, color: number, { t = 0.22, em, shadow = true }: { t?: number; em?: number; shadow?: boolean } = {}) {
    geo.computeBoundingBox();
    const s = new T.Vector3();
    geo.boundingBox!.getSize(s);
    const g = new T.Group();
    const m = new T.Mesh(geo, mat(color, em));
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    if (t) {
      const o = new T.Mesh(geo, EDGE);
      o.scale.set((s.x + 2 * t) / (s.x || 1), (s.y + 2 * t) / (s.y || 1), (s.z + 2 * t) / (s.z || 1));
      g.add(o);
    }
    return g;
  }
  function at<O extends T.Object3D>(o: O, x: number, y: number, z: number, p: T.Object3D = S): O {
    o.position.set(x, y, z);
    p.add(o);
    return o;
  }

  /* Warm sunset light. Intensities are physical (three ≥ r155), so the mockup's values × π. */
  const sun = new T.DirectionalLight(0xffd9b8, 1.1 * Math.PI);
  sun.position.set(30, 60, 25);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 150 });
  sun.shadow.mapSize.set(1024, 1024);
  S.add(sun);
  S.add(new T.HemisphereLight(0xffb59a, 0x3a2a66, 0.6 * Math.PI));

  /* The floating island */
  const world = new T.Group();
  S.add(world);
  at(part(new T.CylinderGeometry(24, 22, 3, 10), 0x5a4466, { t: 0.35 }), 0, -1.5, 0, world);
  at(part(new T.ConeGeometry(22, 24, 10).rotateX(Math.PI), 0x3a2f45, { t: 0.35 }), 0, -15, 0, world);
  for (const [x, y, z, r] of [[-12, -9, 4, 3], [10, -12, -6, 2.6], [2, -21, 10, 2], [-6, -16, -11, 2.2]])
    at(part(new T.DodecahedronGeometry(r, 0), 0x4a3a57), x, y, z, world);
  at(part(new T.CylinderGeometry(24, 24, 1, 10), 0x5d7a45, { t: 0.3 }), 0, 0.5, 0, world);
  at(part(new T.CylinderGeometry(16.5, 16.5, 0.3, 40), 0x2b2533, { t: 0 }), 0, 1.15, 0, world);
  at(part(new T.CylinderGeometry(12.5, 12.5, 0.4, 40), 0x6b8a50, { t: 0 }), 0, 1.25, 0, world);
  [[-18, 8], [17, 12], [-6, -20], [19, -9]].forEach(([x, z], i) => {
    const h = part(new T.DodecahedronGeometry(3.4 + (i % 2), 0), 0x52703d);
    h.scale.y = 0.6;
    at(h, x, 1.5, z, world);
  });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2,
      r = 19 + (i % 3) * 1.4,
      tr = new T.Group();
    at(part(new T.CylinderGeometry(0.3, 0.4, 1.4, 5), 0x5a3d2b, { t: 0.12 }), 0, 0.7, 0, tr);
    at(part(new T.ConeGeometry(1.5, 3.6, 6), [0x3f6b3a, 0x4f7e3f, 0x2f5a35][i % 3], { t: 0.18 }), 0, 3, 0, tr);
    tr.scale.setScalar(0.8 + (i % 4) * 0.15);
    at(tr, Math.cos(a) * r, 1, Math.sin(a) * r, world);
  }
  const blocks = [[-7, -3, 5, 6, 5, 0xd9cbbb], [-2, 5, 4, 4, 6, 0xb3aabd], [6, 5, 5, 5, 4, 0xe29b62], [-8, 6, 3, 3, 3, 0x8a7c99], [8, -7, 4, 7, 4, 0xb3aabd]];
  for (const [x, z, w, h, d, c] of blocks) {
    at(part(box(w, h, d), c), x, 1.45 + h / 2, z, world);
    at(part(box(w + 0.5, 0.5, d + 0.5), 0x4a3f57), x, 1.45 + h + 0.25, z, world);
    for (let k = 0; k < Math.floor(h / 2); k++)
      at(part(box(0.7, 0.7, 0.1), 0xffd36b, { t: 0, em: 0x7a5a10, shadow: false }), x - w / 4, 2.6 + k * 1.8, z + d / 2 + 0.05, world);
  }
  const TW = { x: 3, z: -3, h: 14 };
  at(part(box(5, TW.h, 5), 0xd9cbbb), TW.x, 1.45 + TW.h / 2, TW.z, world);
  for (let k = 0; k < 6; k++)
    for (const j of [-1, 1]) at(part(box(0.8, 0.9, 0.1), 0xffd36b, { t: 0, em: 0x7a5a10, shadow: false }), TW.x + j * 1.2, 3.2 + k * 2, TW.z + 2.55, world);
  const cap = at(part(box(5.6, 0.7, 5.6), 0x4a3f57), TW.x, 1.45 + TW.h + 0.35, TW.z, world);
  const TOP = V(TW.x, 1.45 + TW.h + 1.2, TW.z);
  const flags: T.Group[] = [];
  for (const [x, y, z, c] of [[-7, 7.95, -3, 0xff6b6b], [6, 5.95, 5, 0x5aa8ff], [-2, 7.95, 5, 0x8be36b]]) {
    at(part(box(0.18, 3.2, 0.18), 0x2b2533, { t: 0.08 }), x, y + 1.6, z, world);
    const f = at(new T.Group(), x, y + 2.6, z, world);
    at(part(box(1.8, 1, 0.08), c, { t: 0.1 }), 0.95, 0, 0, f);
    flags.push(f);
  }
  const jeep = new T.Group();
  at(part(box(2.6, 0.9, 1.5), 0x8a9a5b), 0, 0.9, 0, jeep);
  at(part(box(1.2, 0.7, 1.3), 0x6f7d48), -0.3, 1.7, 0, jeep);
  for (const [x, z] of [[-0.9, 0.7], [0.9, 0.7], [-0.9, -0.7], [0.9, -0.7]])
    at(part(new T.CylinderGeometry(0.4, 0.4, 0.3, 8).rotateX(Math.PI / 2), 0x1a161f, { t: 0.08 }), x, 0.45, z, jeep);
  world.add(jeep);

  /* Clouds: some drifting under the island, some far behind it */
  const clouds = new T.Group();
  S.add(clouds);
  const cloud = (sc: number, c: number) => {
    const g = new T.Group();
    for (const [x, y, z, r] of [[0, 0, 0, 2.2], [2.2, -0.3, 0.4, 1.7], [-2.1, -0.4, -0.2, 1.6], [0.6, 0.9, -0.5, 1.5], [-0.8, -0.5, 1.2, 1.3]])
      at(part(new T.IcosahedronGeometry(r, 1), c, { t: 0.22, shadow: false }), x, y, z, g);
    g.scale.setScalar(sc);
    return g;
  };
  [[30, -14, 1.6], [38, -22, 2], [22, -26, 1.8], [44, -10, 1.4], [28, -30, 2.2], [48, -18, 1.7]].forEach(([r, y, sc], i) => {
    const a = (i / 6) * Math.PI * 2;
    at(cloud(sc, [0xe9e2f5, 0xd7cbef][i % 2]), Math.cos(a) * r, y, Math.sin(a) * r, clouds);
  });
  [[100, 6, 4], [120, -4, 5], [110, 16, 3.5], [130, 0, 5.5], [95, -12, 4.5], [125, 10, 4]].forEach(([r, y, sc], i) => {
    const a = -2.4 + i * 0.45;
    at(cloud(sc, [0xc9b6e6, 0xe8b4c4][i % 2]), Math.cos(a) * r, y, Math.sin(a) * r);
  });

  /* The reason it crashes: a launcher on the green that tracks the helicopter */
  const LP = V(-9, 1.45, -8);
  at(part(new T.CylinderGeometry(1.6, 1.9, 1, 8), 0x5a6b3a), LP.x, LP.y + 0.5, LP.z, world);
  const head = at(new T.Group(), LP.x, LP.y + 1.8, LP.z, world);
  at(part(box(2.2, 1, 1.2), 0x6f7d48), 0, 0, 0, head);
  for (const x of [-0.45, 0.45]) at(part(new T.CylinderGeometry(0.32, 0.32, 3.2, 8).rotateX(Math.PI / 2), 0x4a5630, { t: 0.1 }), x, 0.5, 0.6, head);

  /* Black helicopter, facing +x */
  const BLK = 0x2a2832,
    BLK2 = 0x1d1b22;
  const heli = new T.Group();
  heli.rotation.order = 'YXZ';
  const body = part(new T.SphereGeometry(1.5, 10, 8), BLK);
  body.scale.set(1.7, 1, 1.05);
  heli.add(body);
  at(part(new T.SphereGeometry(0.9, 8, 6), 0x7fb6d8, { t: 0.14 }), 1.4, 0.35, 0, heli);
  at(part(box(4.2, 0.55, 0.55), BLK2), -3.6, 0.2, 0, heli);
  const tail = at(new T.Group(), -5.5, 0.9, 0, heli);
  at(part(box(0.9, 1.6, 0.2), BLK2), 0, 0, 0, tail);
  const trot = at(new T.Group(), 0, 0, 0.3, tail);
  at(part(box(0.2, 2, 0.12), 0x5a5866, { t: 0.06 }), 0, 0, 0, trot);
  for (const z of [-0.9, 0.9]) {
    at(part(box(3.6, 0.18, 0.18), BLK2, { t: 0.08 }), 0, -1.55, z, heli);
    at(part(box(0.15, 0.6, 0.15), BLK2, { t: 0.06 }), 0.6, -1.2, z, heli);
    at(part(box(0.15, 0.6, 0.15), BLK2, { t: 0.06 }), -0.8, -1.2, z, heli);
  }
  at(part(box(0.3, 0.6, 0.3), BLK2, { t: 0.08 }), 0, 1.3, 0, heli);
  const rotor = at(new T.Group(), 0, 1.65, 0, heli);
  at(part(box(10, 0.12, 0.5), 0x45434f, { t: 0.08 }), 0, 0, 0, rotor);
  at(part(box(0.5, 0.12, 10), 0x45434f, { t: 0.08 }), 0, 0, 0, rotor);
  S.add(heli);
  /* the tail that gets shot off falls on its own */
  const tailBit: Bit = { obj: new T.Group(), v: V(), life: 0, max: 0, size: 1, spin: null };
  at(part(box(0.9, 1.6, 0.2), BLK2), 0, 0, 0, tailBit.obj);
  at(part(box(0.2, 2, 0.12), 0x5a5866, { t: 0.06 }), 0, 0, 0.3, tailBit.obj);
  tailBit.obj.visible = false;
  S.add(tailBit.obj);

  /* Missile, built along +z so lookAt aims it */
  const missile = new T.Group();
  at(part(new T.CylinderGeometry(0.22, 0.22, 1.8, 8).rotateX(Math.PI / 2), 0xe8e1d3, { t: 0.08 }), 0, 0, 0, missile);
  at(part(new T.ConeGeometry(0.22, 0.5, 8).rotateX(Math.PI / 2), 0xff6b6b, { t: 0.06 }), 0, 0, 1.15, missile);
  missile.visible = false;
  S.add(missile);

  /* Particles */
  const fireG = new T.IcosahedronGeometry(1, 0),
    smokeG = new T.DodecahedronGeometry(1, 0);
  const pool = (n: number, geo: T.BufferGeometry, colors: number[], t: number): Bit[] =>
    Array.from({ length: n }, (_, i) => {
      const obj = part(geo, colors[i % colors.length], { t, shadow: false });
      obj.visible = false;
      S.add(obj);
      return { obj, v: V(), life: 0, max: 0, size: 1, spin: null };
    });
  const fire = pool(30, fireG, [0xffc93c, 0xff7a2f, 0xfff1bf, 0xff5a1f], 0.12);
  const smoke = pool(50, smokeG, [0x4a4256, 0x5d5668, 0x3a3445], 0.12);
  const trail = pool(36, smokeG, [0xd9d4e0, 0xb3aabd], 0.08);
  const debris = pool(10, box(1, 0.7, 0.9), [0xd9cbbb, 0x4a3f57], 0.1);
  const puffs = [...fire, ...smoke, ...trail];
  function emit(arr: Bit[], pos: T.Vector3, v: T.Vector3, life: number, size: number) {
    const p = arr.find((q) => !q.obj.visible);
    if (!p) return;
    p.obj.visible = true;
    p.obj.position.copy(pos);
    p.v.copy(v);
    p.life = p.max = life;
    p.size = size;
    p.obj.scale.setScalar(0.01);
    p.obj.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }
  const burst = (pos: T.Vector3, n: number, spd: number, sz: number) => {
    for (let i = 0; i < n; i++) emit(fire, pos, V(rnd(spd), spd * 0.4 + Math.random() * spd, rnd(spd)), 0.6 + Math.random() * 0.6, sz * (0.6 + Math.random() * 0.8));
  };

  /* Flight path: a circle the helicopter flies in on */
  const R0 = 27,
    H0 = 14;
  const circle = (ft: number) => {
    const r = R0 + (Math.max(0, 2 - ft) / 2) * 45,
      a = -1.1 + ft * 0.42;
    return { p: V(Math.cos(a) * r, H0, Math.sin(a) * r), a };
  };

  let time = 0,
    ft = 0,
    spin = 0,
    shake = 0,
    phase: Story['phase'] | null = null;
  const p0 = V();
  const mouse = { x: 0, y: 0 },
    cam = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    mouse.x = e.clientX / window.innerWidth - 0.5;
    mouse.y = e.clientY / window.innerHeight - 0.5;
  };
  window.addEventListener('pointermove', onMove);

  function enter(next: Story['phase']) {
    if (next === 'fly') {
      heli.visible = tail.visible = cap.visible = true;
      tailBit.obj.visible = false;
      debris.forEach((d) => (d.obj.visible = false));
      spin = 0;
      ft = 0;
    }
    if (next === 'missile') {
      head.updateMatrixWorld();
      missile.visible = true;
      missile.position.copy(head.localToWorld(V(0, 0.5, 2.4)));
      burst(missile.position, 6, 3, 0.7);
    }
    if (next === 'falling') {
      missile.visible = false;
      heli.updateMatrixWorld();
      const tp = heli.localToWorld(V(-5.2, 0.9, 0));
      burst(tp, 14, 6, 1.2);
      shake = 0.35;
      tail.visible = false;
      tailBit.obj.visible = true;
      tailBit.obj.position.copy(tp);
      tailBit.v.set(rnd(3), 2, rnd(3));
      tailBit.obj.rotation.set(0, heli.rotation.y, 0);
      p0.copy(heli.position);
    }
    if (next === 'burning') {
      shake = 0.6;
      cap.visible = false;
      burst(TOP, 24, 10, 2);
      for (const d of debris) {
        d.obj.visible = true;
        d.obj.position.copy(TOP);
        d.v.set(rnd(10), 6 + Math.random() * 9, rnd(10));
        d.spin = V(rnd(6), rnd(6), rnd(6));
        d.obj.scale.setScalar(0.7 + Math.random() * 0.8);
      }
    }
    phase = next;
  }

  function frame(dt: number, story: Story) {
    if (story.phase !== phase) enter(story.phase);
    time += dt;
    let missileHit = false;
    const st = story.t;
    const flying = story.phase === 'fly' || story.phase === 'missile';
    rotor.rotation.y += dt * (story.phase === 'burning' ? 0 : 28);
    trot.rotation.z += dt * 40;
    if (flying) {
      ft += dt;
      const { p, a } = circle(ft);
      heli.position.copy(p);
      heli.rotation.set(-0.22, -(a + Math.PI / 2), -0.1);
    }
    if (story.phase !== 'burning') head.lookAt(heli.position);
    if (story.phase === 'missile') {
      const to = heli.position.clone().sub(missile.position),
        d = to.length();
      missile.position.addScaledVector(to.normalize(), dt * Math.min(34, 8 + st * 30));
      missile.lookAt(heli.position);
      if (Math.random() < 0.9) emit(trail, missile.position, V(rnd(0.3), 0.4, rnd(0.3)), 1.4, 0.45 + Math.random() * 0.25);
      missileHit = d < 1.8;
    }
    if (story.phase === 'falling') {
      const s = Math.min(1, Math.pow(st / 3.4, 1.4)),
        p1 = p0.clone().lerp(TOP, 0.35).add(V(0, 4, 0));
      heli.position.copy(
        p0
          .clone()
          .multiplyScalar((1 - s) * (1 - s))
          .add(p1.multiplyScalar(2 * s * (1 - s)))
          .add(TOP.clone().multiplyScalar(s * s)),
      );
      spin += dt * (5 + s * 7);
      heli.rotation.set(-0.3 - s * 0.35, spin, -0.25);
      if (Math.random() < 0.8) emit(smoke, heli.position.clone().add(V(rnd(0.5), 0, rnd(0.5))), V(rnd(0.5), 1.2, rnd(0.5)), 2.6, 0.9 + Math.random());
      if (Math.random() < 0.45) emit(fire, heli.position, V(rnd(1), 1, rnd(1)), 0.5, 0.8);
    }
    if (story.phase === 'burning') {
      heli.position.copy(TOP).add(V(0.4, -0.3, 0.2));
      heli.rotation.set(0.9, spin, 0.6);
      if (st < 6.5) {
        if (Math.random() < 0.85) emit(smoke, TOP.clone().add(V(rnd(1.5), 0, rnd(1.5))), V(rnd(0.7) + 0.5, 2 + Math.random(), rnd(0.7)), 3.4, 1.4 + Math.random() * 1.2);
        if (Math.random() < 0.5) emit(fire, TOP.clone().add(V(rnd(1.4), 0, rnd(1.4))), V(rnd(0.6), 2.2, rnd(0.6)), 0.6, 0.9 + Math.random() * 0.6);
      }
      heli.visible = st < 7.2;
    }
    /* falling tail and debris: gravity, then settle on the island */
    for (const d of [tailBit, ...debris]) {
      if (!d.obj.visible) continue;
      d.v.y -= 30 * dt;
      d.obj.position.addScaledVector(d.v, dt);
      if (d.spin) {
        d.obj.rotation.x += d.spin.x * dt;
        d.obj.rotation.y += d.spin.y * dt;
      } else d.obj.rotation.z += dt * 4;
      if (d.obj.position.y < 1.7 && Math.hypot(d.obj.position.x, d.obj.position.z) < 23) {
        d.obj.position.y = 1.7;
        d.v.set(0, 0, 0);
        d.spin?.set(0, 0, 0);
      }
    }
    for (const p of puffs) {
      if (!p.obj.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.obj.visible = false;
        continue;
      }
      const k = 1 - p.life / p.max,
        grow = fire.includes(p) ? 1 : 1 + k * 1.4;
      p.obj.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 1.5);
      p.obj.scale.setScalar(p.size * Math.sin(Math.min(1, k * 1.15) * Math.PI) * grow);
      p.obj.rotation.x += dt;
    }
    const ja = time * 0.3;
    jeep.position.set(Math.cos(ja) * 14.5, 1.3, Math.sin(ja) * 14.5);
    jeep.rotation.y = -ja - Math.PI / 2;
    flags.forEach((f, i) => (f.rotation.y = Math.sin(time * 2.4 + i) * 0.3));
    clouds.rotation.y = time * 0.012;
    world.position.y = Math.sin(time * 0.4) * 0.25;
    /* camera: essentially still, a slow drift, a small mouse nudge, a small shake on hits */
    cam.x += (mouse.x - cam.x) * 0.03;
    cam.y += (mouse.y - cam.y) * 0.03;
    shake *= Math.pow(0.03, dt);
    const ca = 0.75 + Math.sin(time * 0.05) * 0.06 + cam.x * 0.06;
    C.position.set(Math.cos(ca) * 72 + rnd(shake), 36 - cam.y * 3 + rnd(shake), Math.sin(ca) * 72);
    C.lookAt(0, 4, 0);
    R.render(S, C);
    return { missileHit };
  }

  return {
    frame,
    setOffset(x, y) {
      C.setViewOffset(view.w, view.h, x, y, view.w, view.h);
    },
    resize(w, h) {
      view = { w, h };
      R.setSize(w, h, false);
      C.aspect = w / h;
      C.updateProjectionMatrix();
    },
    dispose() {
      window.removeEventListener('pointermove', onMove);
      S.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      mats.forEach((m) => m.dispose());
      EDGE.dispose();
      grad.dispose();
      R.dispose();
    },
  };
}
