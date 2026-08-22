import * as THREE from "three";

export const guideCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(7, 0.15, -0.6),
    new THREE.Vector3(14, 2.15, -2.8),
    new THREE.Vector3(21, 2.3, -5.2),
    new THREE.Vector3(28, 0.1, -4.2),
    new THREE.Vector3(34, -0.75, -1.2),
    new THREE.Vector3(39, -1.05, 2.7),
    new THREE.Vector3(46, 0.25, 5.2),
    new THREE.Vector3(54, 0.45, 2.3),
    new THREE.Vector3(61, 0.65, 0.1),
  ],
  false,
  "centripetal",
  0.5,
);

export const routeLength = guideCurve.getLength();
export const gapStart = routeLength * 0.565;
export const gapEnd = gapStart + 3.5;
export const checkpointDistance = gapStart - 3.1;

export function sampleRoute(distance: number) {
  const clampedDistance = THREE.MathUtils.clamp(distance, 0, routeLength);
  const u = clampedDistance / routeLength;
  const point = guideCurve.getPointAt(u);
  const tangent = guideCurve.getTangentAt(u).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return { point, tangent, side };
}

export function hasGround(distance: number) {
  return distance <= gapStart || distance >= gapEnd;
}

export const streamSurfaceHeight = Math.min(
  sampleRoute(gapStart).point.y,
  sampleRoute(gapEnd).point.y,
) - 1.45;

export function createStreamGeometry(width = 18, length = gapEnd - gapStart + 1.6) {
  const acrossSegments = 48;
  const alongSegments = 12;
  const midpoint = sampleRoute((gapStart + gapEnd) * 0.5);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let along = 0; along <= alongSegments; along += 1) {
    const v = along / alongSegments;
    for (let across = 0; across <= acrossSegments; across += 1) {
      const u = across / acrossSegments;
      const point = midpoint.point.clone()
        .addScaledVector(midpoint.side, (u - 0.5) * width)
        .addScaledVector(midpoint.tangent, (v - 0.5) * length);
      positions.push(point.x, streamSurfaceHeight, point.z);
      uvs.push(u, v);
    }
  }

  const row = acrossSegments + 1;
  for (let along = 0; along < alongSegments; along += 1) {
    for (let across = 0; across < acrossSegments; across += 1) {
      const current = along * row + across;
      const next = current + row;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createRouteMesh(
  startDistance: number,
  endDistance: number,
  width: number,
  depth: number,
  material: THREE.Material,
) {
  const steps = Math.max(4, Math.ceil((endDistance - startDistance) * 2));
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const distance = THREE.MathUtils.lerp(startDistance, endDistance, index / steps);
    const { point, side } = sampleRoute(distance);
    const left = point.clone().addScaledVector(side, width * 0.5);
    const right = point.clone().addScaledVector(side, -width * 0.5);
    positions.push(
      left.x, left.y, left.z,
      right.x, right.y, right.z,
      left.x, left.y - depth, left.z,
      right.x, right.y - depth, right.z,
    );
    if (index === steps) continue;
    const base = index * 4;
    const next = base + 4;
    indices.push(
      base, next, next + 1, base, next + 1, base + 1,
      base, base + 2, next + 2, base, next + 2, next,
      base + 1, next + 1, next + 3, base + 1, next + 3, base + 3,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function seededRandom(seed = 48611) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
