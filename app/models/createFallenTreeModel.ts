import * as THREE from "three";

export type FallenTreeRuntime = {
  group: THREE.Group;
  sockets: Record<string, THREE.Object3D>;
  collider: THREE.Object3D;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

const trunkPath = [
  new THREE.Vector3(-3.5, 0.28, 0),
  new THREE.Vector3(-2.1, 0.36, 0.08),
  new THREE.Vector3(-0.4, 0.43, -0.04),
  new THREE.Vector3(1.25, 0.37, 0.05),
  new THREE.Vector3(2.75, 0.3, -0.08),
  new THREE.Vector3(3.75, 0.22, 0.02),
];

function segmentBetween(start: THREE.Vector3, end: THREE.Vector3, startRadius: number, endRadius: number, material: THREE.Material, radialSegments = 8) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(endRadius, startRadius, direction.length(), radialSegments, 3), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createFallenTreeModel(scale = 1): FallenTreeRuntime {
  const group = new THREE.Group();
  group.name = "fallen-dead-tree";
  group.scale.setScalar(scale);
  const bark = new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.93 });
  const wetBark = new THREE.MeshStandardMaterial({ color: 0x48433e, roughness: 0.58 });
  const fracture = new THREE.MeshStandardMaterial({ color: 0x8a7655, roughness: 0.88 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x201d18, roughness: 1 });

  const trunk = new THREE.Group();
  trunk.name = "main-trunk";
  group.add(trunk);
  for (let index = 0; index < trunkPath.length - 1; index += 1) {
    const t = index / (trunkPath.length - 1);
    const piece = segmentBetween(trunkPath[index], trunkPath[index + 1], THREE.MathUtils.lerp(0.54, 0.25, t), THREE.MathUtils.lerp(0.48, 0.18, t), index % 2 ? wetBark : bark, 9);
    piece.name = `trunk-segment-${index}`;
    trunk.add(piece);
  }
  const exposedStrip = segmentBetween(new THREE.Vector3(-1.5, 0.77, -0.1), new THREE.Vector3(1.9, 0.58, -0.1), 0.11, 0.06, fracture, 6);
  exposedStrip.name = "exposed-wood-strip";
  trunk.add(exposedStrip);

  const rootCrown = new THREE.Group();
  rootCrown.name = "root-crown";
  rootCrown.position.copy(trunkPath[0]);
  group.add(rootCrown);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), soil);
  crown.scale.set(0.75, 1.12, 0.7);
  crown.castShadow = true;
  rootCrown.add(crown);
  const rootEnds = [[-0.95, 1.05, 0.18], [-0.72, 0.72, 0.75], [-0.66, 0.42, -0.84], [-0.95, -0.1, 0.58], [-0.76, -0.28, -0.55], [-0.42, 1.3, -0.48]] as const;
  rootEnds.forEach((values, index) => {
    const root = segmentBetween(new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(...values), 0.18, 0.035, index % 3 ? bark : soil, 7);
    root.name = `root-strand-${index}`;
    rootCrown.add(root);
  });

  const branchSpecs = [
    ["proximal-branch", [-2.2, 0.55, 0], [-2.38, 2.25, -0.2], 0.18],
    ["lower-branch-left", [0.2, 0.35, 0], [0.62, -0.18, 0.78], 0.12],
    ["lower-branch-right", [1.2, 0.34, 0], [1.68, -0.08, -0.65], 0.11],
    ["distal-fork-high", [2.7, 0.34, 0], [3.55, 1.14, 0.12], 0.13],
    ["distal-fork-low", [2.84, 0.27, 0], [3.74, -0.03, -0.32], 0.11],
  ] as const;
  const branchGroups: THREE.Object3D[] = [];
  branchSpecs.forEach(([id, atValues, endValues, radius]) => {
    const at = new THREE.Vector3(...atValues);
    const pivot = new THREE.Group();
    pivot.name = id;
    pivot.position.copy(at);
    pivot.userData.destructible = true;
    pivot.add(segmentBetween(new THREE.Vector3(), new THREE.Vector3(...endValues).sub(at), radius, 0.035, bark, 7));
    group.add(pivot);
    branchGroups.push(pivot);
  });

  const socketRoot = new THREE.Object3D();
  socketRoot.name = "socket-root-crown";
  socketRoot.position.copy(trunkPath[0]);
  group.add(socketRoot);
  const socketFork = new THREE.Object3D();
  socketFork.name = "socket-distal-fork";
  socketFork.position.copy(trunkPath[4]);
  group.add(socketFork);
  const collider = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 6.4, 4, 8), new THREE.MeshBasicMaterial({ visible: false }));
  collider.name = "collider-main-trunk";
  collider.position.set(0.05, 0.42, 0);
  collider.rotation.z = Math.PI * 0.5;
  collider.userData.collider = { type: "capsule", radius: 0.5, length: 6.4 };
  group.add(collider);
  group.userData.pipeline = { source: "img2threejs", assetId: "fallen-dead-tree", fidelity: "gameplay-first-procedural" };

  return { group, sockets: { rootCrown: socketRoot, distalFork: socketFork }, collider, destructionGroups: { trunk: [trunk], roots: [rootCrown], branches: branchGroups } };
}
