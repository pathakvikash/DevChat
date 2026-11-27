"use client";
// three is imported here only; Model3D.tsx loads this file lazily.
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { binaryStlTriangles, stlGuard } from "@/lib/generativeUi/appData";

type State = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function Model3DInner({ url, onFallback }: { url: string; onFallback: (reason: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!hasWebGL()) {
      onFallback("3D preview needs WebGL, which is not available here.");
      return;
    }
    let disposed = false;
    let raf = 0;
    const ac = new AbortController();
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material | null = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      try {
        const res = await fetch(url, { credentials: "include", signal: ac.signal });
        if (!res.ok) throw new Error(`Could not load the model (${res.status})`);
        const declared = Number(res.headers.get("content-length"));
        const early = Number.isFinite(declared) && declared > 0 ? stlGuard(declared) : null;
        if (early) throw new Error(early);
        const buf = await res.arrayBuffer();
        const refusal = stlGuard(buf.byteLength, binaryStlTriangles(buf));
        if (refusal) throw new Error(refusal);
        if (disposed) return;

        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        } catch {
          onFallback("3D preview needs WebGL, which is not available here.");
          return;
        }
        geometry = new STLLoader().parse(buf);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const center = box.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z);
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 1e-6);

        material = new THREE.MeshStandardMaterial({ color: 0x9aa4b5, metalness: 0.1, roughness: 0.6 });
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(geometry, material));
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        key.position.set(1, 1.5, 2);
        scene.add(key);

        const camera = new THREE.PerspectiveCamera(45, 1, radius / 100, radius * 100);
        const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.1;
        camera.position.set(dist * 0.6, dist * 0.45, dist * 0.8);
        camera.lookAt(0, 0, 0);

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.style.display = "block";
        el.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = !reduce;
        controls.autoRotate = !reduce;
        controls.autoRotateSpeed = 1.2;
        controls.addEventListener("start", () => { if (controls) controls.autoRotate = false; });

        const draw = () => renderer!.render(scene, camera);
        const fit = () => {
          const w = el.clientWidth || 1;
          const h = el.clientHeight || 1;
          renderer!.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          draw();
        };
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(el);
        if (reduce) {
          controls.addEventListener("change", draw);
        } else {
          const loop = () => {
            raf = requestAnimationFrame(loop);
            controls!.update();
            draw();
          };
          loop();
        }
        setState({ kind: "ready" });
      } catch (e) {
        if (disposed || (e as Error).name === "AbortError") return;
        setState({ kind: "error", message: (e as Error).message || "Could not load the model" });
      }
    })();

    return () => {
      disposed = true;
      ac.abort();
      cancelAnimationFrame(raf);
      ro?.disconnect();
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };
    // onFallback is a stable setter wrapper in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reduce]);

  return (
    <div className="relative w-full h-72 rounded-[var(--glass-radius-sm)] overflow-hidden glass">
      <div ref={host} className="absolute inset-0" role="img" aria-label="3D model preview, drag to rotate" />
      {state.kind === "loading" && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">Loading model…</p>
      )}
      {state.kind === "error" && (
        <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-red-400">{state.message}</p>
      )}
    </div>
  );
}
