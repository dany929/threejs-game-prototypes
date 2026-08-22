import * as THREE from "three";

export type IndustrialStaircaseRuntime = {
  group: THREE.Group;
  sockets: Record<string, THREE.Object3D>;
  colliders: THREE.Object3D[];
  destructionGroups: Record<string, THREE.Object3D[]>;
};

const STEP_COUNT = 15;
const SIDE_BOARD_COUNT = 20;
const RAIL_POST_COUNT = 5;
const RUN = 4.4;
const RISE = 3.55;
const WIDTH = 4.0;
const CHANNEL = 0.18;
const LANDING_LENGTH = 0.54;
const CYLINDER_SEGMENTS = 24;

function tubeBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material, name: string) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, direction.length(), CYLINDER_SEGMENTS), material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.explodeWithParent = true;
  return mesh;
}

function boxBetween(start: THREE.Vector3, end: THREE.Vector3, height: number, depth: number, material: THREE.Material, name: string) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(direction.length(), height, depth), material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.rotation.z = Math.atan2(direction.y, direction.x);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.explodeWithParent = true;
  return mesh;
}

function addBox(group: THREE.Group, name: string, size: THREE.Vector3, position: THREE.Vector3, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.explodeWithParent = true;
  group.add(mesh);
  return mesh;
}

export function createIndustrialStaircaseModel(scale = 1): IndustrialStaircaseRuntime {
  const group = new THREE.Group();
  group.name = "industrial-timber-staircase";
  group.scale.setScalar(scale);

  const timber = new THREE.MeshStandardMaterial({ color: 0x665241, roughness: 0.92, metalness: 0 });
  const timberDark = new THREE.MeshStandardMaterial({ color: 0x3b332b, roughness: 1, metalness: 0 });
  const painted = new THREE.MeshStandardMaterial({ color: 0x2f605d, roughness: 0.84, metalness: 0.01 });
  const paintWear = new THREE.MeshStandardMaterial({ color: 0x76634f, roughness: 0.9, metalness: 0 });
  const oxidizedMetal = new THREE.MeshStandardMaterial({ color: 0x65594d, roughness: 0.69, metalness: 0.48 });
  const fastenerMaterial = new THREE.MeshStandardMaterial({ color: 0x252a28, roughness: 0.62, metalness: 0.72 });

  const flight = new THREE.Group();
  flight.name = "stair-flight";
  group.add(flight);
  const sideEnclosure = new THREE.Group();
  sideEnclosure.name = "side-enclosure";
  group.add(sideEnclosure);
  const guardSystem = new THREE.Group();
  guardSystem.name = "guard-system";
  group.add(guardSystem);

  const stepDepth = RUN / STEP_COUNT + 0.055;
  const stepRise = RISE / STEP_COUNT;
  const laneWidth = (WIDTH - CHANNEL) * 0.5;
  const treadGeometry = new THREE.BoxGeometry(stepDepth, 0.12, laneWidth);
  const treads = new THREE.InstancedMesh(treadGeometry, painted, STEP_COUNT * 2);
  treads.name = "paired-painted-treads";
  treads.castShadow = true;
  treads.receiveShadow = true;
  treads.userData.instances = { system: "paired-step-lanes", count: STEP_COUNT * 2, clickableByInstance: true };
  const transform = new THREE.Object3D();
  for (let index = 0; index < STEP_COUNT; index += 1) {
    const x = -RUN * 0.5 + stepDepth * 0.5 + index * (RUN / STEP_COUNT);
    const y = 0.08 + (index + 1) * stepRise;
    for (let lane = 0; lane < 2; lane += 1) {
      transform.position.set(x, y, (lane === 0 ? -1 : 1) * (CHANNEL * 0.5 + laneWidth * 0.5));
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      treads.setMatrixAt(index * 2 + lane, transform.matrix);
    }
  }
  treads.instanceMatrix.needsUpdate = true;
  flight.add(treads);

  const noseGeometry = new THREE.BoxGeometry(0.08, 0.13, laneWidth - 0.05);
  const noses = new THREE.InstancedMesh(noseGeometry, paintWear, STEP_COUNT * 2);
  noses.name = "worn-tread-noses";
  noses.castShadow = true;
  noses.userData.instances = { system: "tread-nose-rhythm", count: STEP_COUNT * 2 };
  for (let index = 0; index < STEP_COUNT; index += 1) {
    const x = -RUN * 0.5 + 0.035 + index * (RUN / STEP_COUNT);
    const y = 0.085 + (index + 1) * stepRise;
    for (let lane = 0; lane < 2; lane += 1) {
      transform.position.set(x, y, (lane === 0 ? -1 : 1) * (CHANNEL * 0.5 + laneWidth * 0.5));
      transform.updateMatrix();
      noses.setMatrixAt(index * 2 + lane, transform.matrix);
    }
  }
  noses.instanceMatrix.needsUpdate = true;
  flight.add(noses);

  const riserGeometry = new THREE.BoxGeometry(0.11, stepRise, WIDTH - 0.16);
  const risers = new THREE.InstancedMesh(riserGeometry, timberDark, STEP_COUNT);
  risers.name = "shadowed-risers";
  for (let index = 0; index < STEP_COUNT; index += 1) {
    transform.position.set(-RUN * 0.5 + index * (RUN / STEP_COUNT), 0.08 + (index + 0.5) * stepRise, 0);
    transform.updateMatrix();
    risers.setMatrixAt(index, transform.matrix);
  }
  risers.instanceMatrix.needsUpdate = true;
  risers.castShadow = true;
  risers.receiveShadow = true;
  flight.add(risers);

  const boardWidth = RUN / SIDE_BOARD_COUNT - 0.022;
  const sideBoardGeometry = new THREE.BoxGeometry(boardWidth, 1, 0.16);
  const sideBoards = new THREE.InstancedMesh(sideBoardGeometry, timber, SIDE_BOARD_COUNT * 2);
  sideBoards.name = "vertical-side-boards";
  sideBoards.castShadow = true;
  sideBoards.receiveShadow = true;
  sideBoards.userData.instances = { system: "vertical-board-seams", count: SIDE_BOARD_COUNT * 2 };
  for (let index = 0; index < SIDE_BOARD_COUNT; index += 1) {
    const height = Math.max(0.3, ((index + 1) / SIDE_BOARD_COUNT) * RISE - 0.03);
    const x = -RUN * 0.5 + (index + 0.5) * (RUN / SIDE_BOARD_COUNT);
    for (let side = 0; side < 2; side += 1) {
      transform.position.set(x, height * 0.5, (side === 0 ? -1 : 1) * (WIDTH * 0.5 - 0.05));
      transform.scale.set(1, height, 1);
      transform.updateMatrix();
      sideBoards.setMatrixAt(index * 2 + side, transform.matrix);
    }
  }
  sideBoards.instanceMatrix.needsUpdate = true;
  sideEnclosure.add(sideBoards);

  const slopeStart = new THREE.Vector3(-RUN * 0.5 - 0.12, 0.24, 0);
  const slopeEnd = new THREE.Vector3(RUN * 0.5 + 0.12, RISE + 0.22, 0);
  for (const side of [-1, 1]) {
    const z = side * WIDTH * 0.5;
    sideEnclosure.add(boxBetween(slopeStart.clone().setZ(z), slopeEnd.clone().setZ(z), 0.24, 0.22, painted, `diagonal-painted-cap-${side < 0 ? "left" : "right"}`));
    sideEnclosure.add(boxBetween(
      slopeStart.clone().add(new THREE.Vector3(0, -0.1, 0)).setZ(z),
      slopeEnd.clone().add(new THREE.Vector3(0, -0.1, 0)).setZ(z),
      0.045,
      0.225,
      paintWear,
      `worn-cap-edge-${side < 0 ? "left" : "right"}`,
    ));
    addBox(sideEnclosure, `base-rail-${side < 0 ? "left" : "right"}`, new THREE.Vector3(RUN + 0.35, 0.2, 0.23), new THREE.Vector3(0, 0.1, z), timberDark);
    for (const [plateIndex, t] of [0.22, 0.48, 0.74].entries()) {
      const plate = addBox(
        sideEnclosure,
        `cap-joint-plate-${side < 0 ? "left" : "right"}-${plateIndex}`,
        new THREE.Vector3(0.17, 0.28, 0.045),
        slopeStart.clone().lerp(slopeEnd, t).setZ(z + side * 0.132),
        oxidizedMetal,
      );
      plate.rotation.z = Math.atan2(RISE, RUN);
      for (const boltOffset of [-0.045, 0.045]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, CYLINDER_SEGMENTS), fastenerMaterial);
        bolt.name = `cap-joint-bolt-${side < 0 ? "left" : "right"}-${plateIndex}-${boltOffset < 0 ? "low" : "high"}`;
        bolt.rotation.x = Math.PI * 0.5;
        bolt.position.copy(plate.position).add(new THREE.Vector3(0, boltOffset, side * 0.03));
        bolt.castShadow = true;
        sideEnclosure.add(bolt);
      }
    }
  }

  const underside = new THREE.Group();
  underside.name = "underside-supports";
  flight.add(underside);
  for (const z of [-WIDTH * 0.42, 0, WIDTH * 0.42]) {
    underside.add(boxBetween(
      new THREE.Vector3(-RUN * 0.5 + 0.12, 0.12, z),
      new THREE.Vector3(RUN * 0.5 - 0.06, RISE - 0.04, z),
      0.16,
      0.18,
      timberDark,
      `longitudinal-stringer-${z.toFixed(2)}`,
    ));
  }
  for (let index = 0; index < STEP_COUNT; index += 1) {
    const x = -RUN * 0.5 + (index + 0.5) * (RUN / STEP_COUNT);
    const y = 0.08 + (index + 1) * stepRise - 0.13;
    addBox(underside, `under-tread-${index}`, new THREE.Vector3(stepDepth * 0.72, 0.11, WIDTH - 0.2), new THREE.Vector3(x, y, 0), timberDark);
  }
  addBox(underside, "central-support-post", new THREE.Vector3(0.17, RISE * 0.5, 0.24), new THREE.Vector3(0.28, RISE * 0.25, 0), timberDark);

  const railHeight = 1.08;
  const railZ = [-WIDTH * 0.5, 0, WIDTH * 0.5];
  const railStartX = -RUN * 0.5 - 0.25;
  const railEndX = RUN * 0.5 + 0.28;
  railZ.forEach((z, railIndex) => {
    const lowerStart = new THREE.Vector3(railStartX, 0.44, z);
    const lowerEnd = new THREE.Vector3(railEndX, RISE + 0.44, z);
    const upperStart = lowerStart.clone().add(new THREE.Vector3(0, railHeight * 0.52, 0));
    const upperEnd = lowerEnd.clone().add(new THREE.Vector3(0, railHeight * 0.52, 0));
    guardSystem.add(tubeBetween(lowerStart, lowerEnd, 0.045, oxidizedMetal, `mid-rail-${railIndex}`));
    guardSystem.add(tubeBetween(upperStart, upperEnd, 0.057, oxidizedMetal, `handrail-${railIndex}`));
    for (let postIndex = 0; postIndex < RAIL_POST_COUNT; postIndex += 1) {
      const t = postIndex / (RAIL_POST_COUNT - 1);
      const x = THREE.MathUtils.lerp(railStartX + 0.15, railEndX - 0.12, t);
      const baseY = THREE.MathUtils.lerp(0.22, RISE + 0.22, t);
      const postStart = new THREE.Vector3(x, baseY, z);
      const postEnd = postStart.clone().add(new THREE.Vector3(0, railHeight, 0));
      guardSystem.add(tubeBetween(postStart, postEnd, 0.047, oxidizedMetal, `rail-post-${railIndex}-${postIndex}`));
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.055, CYLINDER_SEGMENTS), fastenerMaterial);
      collar.name = `post-collar-${railIndex}-${postIndex}`;
      collar.rotation.x = Math.PI * 0.5;
      collar.position.copy(postStart).add(new THREE.Vector3(0, 0.07, 0));
      collar.castShadow = true;
      guardSystem.add(collar);
    }
    const topPostStart = new THREE.Vector3(railEndX + 0.2, RISE + 0.15, z);
    const topPostEnd = topPostStart.clone().add(new THREE.Vector3(0, railHeight + 0.1, 0));
    guardSystem.add(tubeBetween(topPostStart, topPostEnd, 0.055, oxidizedMetal, `terminal-post-${railIndex}`));
    guardSystem.add(tubeBetween(upperEnd, new THREE.Vector3(railEndX + 0.42, upperEnd.y, z), 0.057, oxidizedMetal, `landing-return-${railIndex}`));
  });

  addBox(flight, "top-landing", new THREE.Vector3(LANDING_LENGTH, 0.18, WIDTH), new THREE.Vector3(RUN * 0.5 + 0.18, RISE + 0.04, 0), painted);
  addBox(flight, "center-channel", new THREE.Vector3(RUN, 0.04, CHANNEL), new THREE.Vector3(0, RISE * 0.52, 0), timberDark).rotation.z = Math.atan2(RISE, RUN);

  const bottomSocket = new THREE.Object3D();
  bottomSocket.name = "socket-stair-bottom";
  bottomSocket.position.set(-RUN * 0.5, 0, 0);
  group.add(bottomSocket);
  const topSocket = new THREE.Object3D();
  topSocket.name = "socket-stair-top";
  topSocket.position.set(RUN * 0.5 + 0.18, RISE + 0.14, 0);
  group.add(topSocket);

  const rampCollider = new THREE.Mesh(new THREE.BoxGeometry(RUN, 0.38, WIDTH - 0.18), new THREE.MeshBasicMaterial({ visible: false }));
  rampCollider.name = "collider-stair-ramp";
  rampCollider.position.set(0, RISE * 0.5, 0);
  rampCollider.rotation.z = Math.atan2(RISE, RUN);
  rampCollider.userData.collider = { type: "ramp", run: RUN, rise: RISE, width: WIDTH - 0.18 };
  group.add(rampCollider);

  const nodes = { flight, sideEnclosure, guardSystem };
  const sockets = { bottom: bottomSocket, top: topSocket };
  const colliders = [rampCollider];
  const destructionGroups = { flight: [flight], sideEnclosure: [sideEnclosure], guardSystem: [guardSystem] };
  group.userData.sculptRuntime = { nodes, meshes: { treads, noses, risers, sideBoards }, sockets, colliders, destructionGroups };
  group.userData.pipeline = { source: "img2threejs", assetId: "industrial-timber-staircase", fidelity: "multi-view-procedural" };

  return { group, sockets, colliders, destructionGroups };
}
