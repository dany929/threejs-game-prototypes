"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createFallenTreeModel } from "./models/createFallenTreeModel";
import { createIndustrialStaircaseModel } from "./models/createIndustrialStaircaseModel";
import { checkpointDistance, createRouteMesh, createStreamGeometry, gapEnd, gapStart, hasGround, routeLength, sampleRoute, seededRandom, streamSurfaceHeight } from "./game/level";

type Action = "left" | "right" | "jump";

function cylinderBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, direction.length(), 7), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

export default function GameScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef(new Set<string>());
  const pointersRef = useRef(new Map<number, Action>());
  const inputRef = useRef({ left: false, right: false, jump: false, jumpQueued: false });
  const resetRef = useRef<(fullRestart?: boolean) => void>(() => undefined);
  const [completed, setCompleted] = useState(false);
  const [started, setStarted] = useState(false);
  const [deaths, setDeaths] = useState(0);
  const [webglError, setWebglError] = useState(false);

  const refreshInput = useCallback(() => {
    const keys = keyboardRef.current;
    const actions = [...pointersRef.current.values()];
    const left = keys.has("ArrowLeft") || keys.has("KeyA") || actions.includes("left");
    const right = keys.has("ArrowRight") || keys.has("KeyD") || actions.includes("right");
    const jump = keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW") || actions.includes("jump");
    if (jump && !inputRef.current.jump) inputRef.current.jumpQueued = true;
    Object.assign(inputRef.current, { left, right, jump });
  }, []);

  const clearInput = useCallback(() => {
    keyboardRef.current.clear();
    pointersRef.current.clear();
    Object.assign(inputRef.current, { left: false, right: false, jump: false, jumpQueued: false });
  }, []);

  const pointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, action: Action) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, action);
    refreshInput();
    setStarted(true);
  }, [refreshInput]);

  const pointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    pointersRef.current.delete(event.pointerId);
    refreshInput();
  }, [refreshInput]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x23312d);
    scene.fog = new THREE.FogExp2(0x25332f, 0.021);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 110);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      queueMicrotask(() => setWebglError(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "Трёхмерная игровая сцена: лесная тропа, ручей и промышленная лестница");
    container.appendChild(renderer.domElement);

    const world = new THREE.Group();
    scene.add(world);
    scene.add(new THREE.HemisphereLight(0xc1d3ca, 0x18201d, 1.72));
    const keyLight = new THREE.DirectionalLight(0xd5e5dc, 3.25);
    keyLight.position.set(18, 20, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    world.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x7f9c93, 1.15);
    fillLight.position.set(-18, 9, -14);
    world.add(fillLight);

    const outerGroundMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3b34, roughness: 1, flatShading: true });
    const bankMaterial = new THREE.MeshStandardMaterial({ color: 0x293a32, roughness: 1, flatShading: true });
    const trailMaterial = new THREE.MeshStandardMaterial({ color: 0x4b584e, roughness: 0.96, flatShading: true });
    [[0, gapStart], [gapEnd, routeLength]].forEach(([start, end]) => {
      const outerGround = createRouteMesh(start, end, 35, 4.6, outerGroundMaterial);
      outerGround.position.y = -0.14;
      outerGround.receiveShadow = true;
      world.add(outerGround);
      const bank = createRouteMesh(start, end, 9.5, 3.8, bankMaterial);
      bank.receiveShadow = true;
      world.add(bank);
      const trail = createRouteMesh(start, end, 2.65, 0.08, trailMaterial);
      trail.position.y = 0.025;
      trail.receiveShadow = true;
      world.add(trail);
    });

    const streamGeometry = createStreamGeometry(34);
    const streamUniforms = { uTime: { value: 0 } };
    const streamMaterial = new THREE.ShaderMaterial({
      uniforms: streamUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vUv = uv;
          vec3 moved = position;
          float broadWave = sin(position.x * 0.72 + position.z * 0.46 + uTime * 1.35) * 0.045;
          float smallWave = sin(position.x * -1.55 + position.z * 1.92 - uTime * 2.1) * 0.022;
          vWave = broadWave + smallWave;
          moved.y += vWave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          float flowA = sin(vUv.x * 58.0 - uTime * 3.1 + sin(vUv.y * 13.0) * 2.0);
          float flowB = sin(vUv.x * 31.0 - uTime * 1.8 - vUv.y * 17.0);
          float highlights = smoothstep(0.72, 1.0, flowA * 0.62 + flowB * 0.38);
          float bankFoam = smoothstep(0.12, 0.015, min(vUv.y, 1.0 - vUv.y));
          float depthTone = 0.72 + 0.18 * sin(vUv.y * 3.14159);
          vec3 deep = vec3(0.055, 0.13, 0.14);
          vec3 shallow = vec3(0.16, 0.29, 0.28);
          vec3 color = mix(deep, shallow, depthTone + vWave * 2.0);
          color += vec3(0.28, 0.42, 0.39) * highlights * 0.42;
          color = mix(color, vec3(0.55, 0.65, 0.60), bankFoam * 0.38);
          gl_FragColor = vec4(color, 0.78 + highlights * 0.12);
        }
      `,
    });
    const stream = new THREE.Mesh(streamGeometry, streamMaterial);
    stream.renderOrder = 2;
    world.add(stream);

    const streamBedMaterial = new THREE.MeshStandardMaterial({ color: 0x25322d, roughness: 1, flatShading: true });
    const streamBed = new THREE.Mesh(streamGeometry.clone(), streamBedMaterial);
    streamBed.position.y = -0.38;
    streamBed.receiveShadow = true;
    world.add(streamBed);

    const random = seededRandom();
    const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x35453e, roughness: 1, flatShading: true });
    const farTreeMaterial = new THREE.MeshStandardMaterial({ color: 0x43564f, roughness: 1, flatShading: true });
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.38, 1, 7);
    const nearTrees = new THREE.InstancedMesh(trunkGeometry, treeMaterial, 76);
    nearTrees.castShadow = true;
    nearTrees.receiveShadow = true;
    nearTrees.frustumCulled = false;
    const treeTransform = new THREE.Object3D();
    for (let index = 0; index < 76; index += 1) {
      const distance = random() * routeLength;
      if (distance > gapStart - 1 && distance < gapEnd + 1) continue;
      const route = sampleRoute(distance);
      const sign = random() > 0.5 ? 1 : -1;
      const offset = sign * (3.2 + random() * 7.8);
      const base = route.point.clone().addScaledVector(route.side, offset);
      const height = 6.5 + random() * 9;
      treeTransform.position.copy(base).add(new THREE.Vector3(0, height * 0.5 - 0.3, 0));
      treeTransform.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.11);
      treeTransform.scale.set(0.75 + random() * 0.7, height, 0.75 + random() * 0.7);
      treeTransform.updateMatrix();
      nearTrees.setMatrixAt(index, treeTransform.matrix);
      if (index % 3 === 0) {
        const branchStart = base.clone().add(new THREE.Vector3(0, height * (0.46 + random() * 0.22), 0));
        const branchEnd = branchStart.clone().addScaledVector(route.side, sign * (1.4 + random() * 1.9)).add(new THREE.Vector3(0, 1.2 + random() * 2.3, 0));
        const branch = cylinderBetween(branchStart, branchEnd, 0.09, treeMaterial);
        branch.castShadow = Math.abs(offset) < 6;
        world.add(branch);
      }
    }
    nearTrees.instanceMatrix.needsUpdate = true;
    world.add(nearTrees);

    const distantTrees = new THREE.InstancedMesh(trunkGeometry, farTreeMaterial, 148);
    distantTrees.receiveShadow = true;
    distantTrees.frustumCulled = false;
    for (let index = 0; index < 148; index += 1) {
      const distance = random() * routeLength;
      const route = sampleRoute(distance);
      const sign = random() > 0.5 ? 1 : -1;
      const offset = sign * (10.5 + random() * 14.5);
      const height = 9 + random() * 13;
      treeTransform.position.copy(route.point).addScaledVector(route.side, offset).add(new THREE.Vector3(0, height * 0.5 - 0.8, 0));
      treeTransform.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.075);
      treeTransform.scale.set(0.72 + random() * 0.9, height, 0.72 + random() * 0.9);
      treeTransform.updateMatrix();
      distantTrees.setMatrixAt(index, treeTransform.matrix);
    }
    distantTrees.instanceMatrix.needsUpdate = true;
    world.add(distantTrees);

    const undergrowthMaterial = new THREE.MeshStandardMaterial({ color: 0x496054, roughness: 1, flatShading: true });
    const undergrowth = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 1.05, 5), undergrowthMaterial, 190);
    undergrowth.frustumCulled = false;
    for (let index = 0; index < 190; index += 1) {
      const distance = random() * routeLength;
      if (!hasGround(distance)) continue;
      const route = sampleRoute(distance);
      const sign = random() > 0.5 ? 1 : -1;
      const offset = sign * (1.6 + random() * 8.8);
      const scale = 0.45 + random() * 1.15;
      treeTransform.position.copy(route.point).addScaledVector(route.side, offset).add(new THREE.Vector3(0, 0.45 * scale, 0));
      treeTransform.rotation.set((random() - 0.5) * 0.16, random() * Math.PI, (random() - 0.5) * 0.18);
      treeTransform.scale.set(0.7 + random() * 0.65, scale, 0.7 + random() * 0.65);
      treeTransform.updateMatrix();
      undergrowth.setMatrixAt(index, treeTransform.matrix);
    }
    undergrowth.instanceMatrix.needsUpdate = true;
    world.add(undergrowth);

    const fallenRoute = sampleRoute(routeLength * 0.38);
    const fallenTree = createFallenTreeModel(0.82).group;
    fallenTree.position.copy(fallenRoute.point).addScaledVector(fallenRoute.side, -2.35);
    fallenTree.rotation.y = Math.atan2(fallenRoute.tangent.x, fallenRoute.tangent.z) + Math.PI * 0.5;
    world.add(fallenTree);

    const staircaseRoute = sampleRoute(routeLength * 0.72);
    const staircase = createIndustrialStaircaseModel(0.78).group;
    staircase.position.copy(staircaseRoute.point).addScaledVector(staircaseRoute.side, -5.4);
    staircase.position.y -= 0.12;
    staircase.rotation.y = Math.atan2(staircaseRoute.tangent.x, staircaseRoute.tangent.z) - Math.PI * 0.5;
    world.add(staircase);

    const rockGeometry = new THREE.DodecahedronGeometry(0.45, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x46564e, roughness: 1, flatShading: true });
    for (let index = 0; index < 52; index += 1) {
      const distance = random() * routeLength;
      if (!hasGround(distance)) continue;
      const route = sampleRoute(distance);
      const rock = new THREE.Mesh(rockGeometry, rockMaterial);
      rock.position.copy(route.point).addScaledVector(route.side, (random() > 0.5 ? 1 : -1) * (1.2 + random() * 3));
      rock.position.y += 0.18;
      rock.scale.set(0.35 + random(), 0.25 + random() * 0.55, 0.45 + random());
      rock.rotation.set(random(), random(), random());
      rock.castShadow = true;
      world.add(rock);
    }

    const streamRoute = sampleRoute((gapStart + gapEnd) * 0.5);
    for (let index = 0; index < 22; index += 1) {
      const streamRock = new THREE.Mesh(rockGeometry, rockMaterial);
      streamRock.position.copy(streamRoute.point)
        .addScaledVector(streamRoute.side, -15 + index * 1.42 + (random() - 0.5) * 0.65)
        .addScaledVector(streamRoute.tangent, (random() - 0.5) * 2.3);
      streamRock.position.y = streamSurfaceHeight - 0.08 + random() * 0.22;
      streamRock.scale.set(0.35 + random() * 0.65, 0.25 + random() * 0.35, 0.45 + random() * 0.7);
      streamRock.rotation.set(random(), random(), random());
      streamRock.castShadow = true;
      world.add(streamRock);
    }

    const stumpMaterial = new THREE.MeshStandardMaterial({ color: 0x3a332b, roughness: 0.98, flatShading: true });
    for (let index = 0; index < 18; index += 1) {
      const distance = 3 + random() * (routeLength - 6);
      if (!hasGround(distance)) continue;
      const route = sampleRoute(distance);
      const sign = random() > 0.5 ? 1 : -1;
      const stumpHeight = 0.65 + random() * 1.35;
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, stumpHeight, 6), stumpMaterial);
      stump.position.copy(route.point).addScaledVector(route.side, sign * (2.2 + random() * 6.5));
      stump.position.y += stumpHeight * 0.5;
      stump.rotation.z = (random() - 0.5) * 0.24;
      stump.castShadow = true;
      world.add(stump);
    }

    const mistCanvas = document.createElement("canvas");
    mistCanvas.width = 64;
    mistCanvas.height = 64;
    const mistContext = mistCanvas.getContext("2d");
    if (mistContext) {
      const gradient = mistContext.createRadialGradient(32, 32, 2, 32, 32, 31);
      gradient.addColorStop(0, "rgba(205, 224, 214, 0.58)");
      gradient.addColorStop(1, "rgba(205, 224, 214, 0)");
      mistContext.fillStyle = gradient;
      mistContext.fillRect(0, 0, 64, 64);
    }
    const mistTexture = new THREE.CanvasTexture(mistCanvas);
    const mistCount = 70;
    const mistPositions = new Float32Array(mistCount * 3);
    for (let index = 0; index < mistCount; index += 1) {
      const point = streamRoute.point.clone()
        .addScaledVector(streamRoute.side, -16 + random() * 32)
        .addScaledVector(streamRoute.tangent, (random() - 0.5) * 8);
      mistPositions[index * 3] = point.x;
      mistPositions[index * 3 + 1] = streamSurfaceHeight + 0.25 + random() * 2.1;
      mistPositions[index * 3 + 2] = point.z;
    }
    const mistGeometry = new THREE.BufferGeometry();
    mistGeometry.setAttribute("position", new THREE.BufferAttribute(mistPositions, 3));
    const mist = new THREE.Points(mistGeometry, new THREE.PointsMaterial({ map: mistTexture, color: 0xc7d9d0, size: 2.2, transparent: true, opacity: 0.16, depthWrite: false, sizeAttenuation: true }));
    mist.renderOrder = 3;
    world.add(mist);

    const exitRoute = sampleRoute(routeLength - 1);
    const exitGlow = new THREE.PointLight(0xa9c5b6, 14, 13, 2);
    exitGlow.position.copy(exitRoute.point).add(new THREE.Vector3(0, 3.3, 0));
    world.add(exitGlow);

    const rainCount = 420;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let index = 0; index < rainCount; index += 1) {
      rainPositions[index * 3] = -8 + random() * 78;
      rainPositions[index * 3 + 1] = -3 + random() * 22;
      rainPositions[index * 3 + 2] = -14 + random() * 28;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rain = new THREE.Points(rainGeometry, new THREE.PointsMaterial({ color: 0xb4c5bd, size: 0.035, transparent: true, opacity: 0.38 }));
    world.add(rain);

    const player = new THREE.Group();
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x080b0a, roughness: 0.88 });
    const torsoPivot = new THREE.Group();
    torsoPivot.position.y = 0.9;
    torsoPivot.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.62, 4, 8), playerMaterial));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), playerMaterial);
    head.position.y = 0.72;
    torsoPivot.add(head);
    player.add(torsoPivot);
    const limbGeometry = new THREE.CylinderGeometry(0.065, 0.08, 0.58, 7);
    const leftLeg = new THREE.Mesh(limbGeometry, playerMaterial);
    const rightLeg = new THREE.Mesh(limbGeometry, playerMaterial);
    leftLeg.position.set(-0.11, 0.29, 0);
    rightLeg.position.set(0.11, 0.29, 0);
    player.add(leftLeg, rightLeg);
    world.add(player);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x030504, transparent: true, opacity: 0.38, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), shadowMaterial);
    shadow.rotation.x = -Math.PI * 0.5;
    world.add(shadow);

    const start = sampleRoute(0.8);
    const state = { distance: 0.8, height: start.point.y, speed: 0, verticalSpeed: 0, grounded: true, coyote: 0.12, jumpBuffer: 0, checkpoint: 0.8, finished: false, facing: 1 };
    const cameraLook = start.point.clone().add(new THREE.Vector3(0, 1.2, 0));
    camera.position.copy(start.point).addScaledVector(start.side, 9).addScaledVector(start.tangent, -2.5).add(new THREE.Vector3(0, 4.2, 0));

    const resetPlayer = (countDeath = false, fullRestart = false) => {
      if (fullRestart) { state.checkpoint = 0.8; setDeaths(0); }
      const route = sampleRoute(state.checkpoint);
      Object.assign(state, { distance: state.checkpoint, height: route.point.y, speed: 0, verticalSpeed: 0, grounded: true, coyote: 0.12, jumpBuffer: 0, finished: false });
      inputRef.current.jumpQueued = false;
      setCompleted(false);
      if (countDeath) setDeaths((value) => value + 1);
    };
    resetRef.current = (fullRestart = true) => resetPlayer(false, fullRestart);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.fov = camera.aspect < 0.75 ? 48 : 38;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
      renderer.setSize(width, height, false);
    };
    resize();
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyA", "KeyD", "KeyW", "KeyR"].includes(event.code)) event.preventDefault();
      if (event.code === "KeyR") resetPlayer(false, false);
      else if (!event.repeat) keyboardRef.current.add(event.code);
      refreshInput();
      setStarted(true);
    };
    const onKeyUp = (event: KeyboardEvent) => { keyboardRef.current.delete(event.code); refreshInput(); };
    const onVisibility = () => { if (document.hidden) clearInput(); };
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", onVisibility);

    const fixedStep = 1 / 120;
    let lastTime = performance.now() / 1000;
    let accumulator = 0;
    let animationFrame = 0;
    let runPhase = 0;
    const simulate = (dt: number) => {
      const input = inputRef.current;
      if (input.jumpQueued) { state.jumpBuffer = 0.14; input.jumpQueued = false; }
      else state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
      const direction = Number(input.right) - Number(input.left);
      if (direction) state.facing = direction;
      state.speed = THREE.MathUtils.damp(state.speed, direction * 5.2, state.grounded ? 7.5 : 3.1, dt);
      if (!direction && state.grounded) state.speed = THREE.MathUtils.damp(state.speed, 0, 10, dt);
      state.coyote = state.grounded ? 0.12 : Math.max(0, state.coyote - dt);
      if (state.jumpBuffer > 0 && state.coyote > 0) {
        state.verticalSpeed = 7.45; state.grounded = false; state.coyote = 0; state.jumpBuffer = 0;
      }
      if (!input.jump && state.verticalSpeed > 3.35) state.verticalSpeed = 3.35;
      const previousHeight = state.height;
      state.distance = THREE.MathUtils.clamp(state.distance + state.speed * dt, 0.25, routeLength);
      const route = sampleRoute(state.distance);
      if (state.grounded && hasGround(state.distance)) { state.height = route.point.y; state.verticalSpeed = 0; }
      else {
        state.grounded = false;
        state.verticalSpeed -= 20.8 * dt;
        state.height += state.verticalSpeed * dt;
        if (hasGround(state.distance) && state.verticalSpeed <= 0 && previousHeight >= route.point.y - 0.1 && state.height <= route.point.y) {
          state.height = route.point.y; state.verticalSpeed = 0; state.grounded = true;
        }
      }
      if (state.distance > checkpointDistance && state.distance < gapStart - 0.25) state.checkpoint = checkpointDistance;
      const aboveStream = state.distance > gapStart && state.distance < gapEnd;
      if ((aboveStream && state.height < streamSurfaceHeight + 0.12) || state.height < route.point.y - 7) resetPlayer(true, false);
      if (state.distance > routeLength - 1.2 && !state.finished) { state.finished = true; setCompleted(true); }
      runPhase += Math.abs(state.speed) * dt * 2.8;
      const speedRatio = Math.min(1, Math.abs(state.speed) / 5.2);
      leftLeg.rotation.x = state.grounded ? Math.sin(runPhase) * 0.58 * speedRatio : -0.3;
      rightLeg.rotation.x = state.grounded ? -Math.sin(runPhase) * 0.58 * speedRatio : 0.36;
      torsoPivot.rotation.x = THREE.MathUtils.damp(torsoPivot.rotation.x, state.grounded ? -0.08 * speedRatio : 0.05, 7, dt);
      player.position.copy(route.point); player.position.y = state.height;
      player.rotation.y = Math.atan2(route.tangent.x, route.tangent.z) + (state.facing < 0 ? Math.PI : 0);
      shadow.visible = hasGround(state.distance) && state.height - route.point.y < 3;
      shadow.position.copy(route.point); shadow.position.y += 0.035;
      shadowMaterial.opacity = THREE.MathUtils.clamp(0.42 - (state.height - route.point.y) * 0.12, 0.08, 0.42);
    };
    const render = (timeMs: number) => {
      const now = timeMs / 1000;
      const frameDelta = Math.min(0.05, Math.max(0, now - lastTime));
      lastTime = now;
      if (!document.hidden) {
        accumulator = Math.min(accumulator + frameDelta, 0.1);
        while (accumulator >= fixedStep) { simulate(fixedStep); accumulator -= fixedStep; }
      }
      const route = sampleRoute(state.distance);
      const jumpLift = Math.max(0, state.height - route.point.y) * 0.24;
      const desiredCamera = route.point.clone().addScaledVector(route.side, 8.6).addScaledVector(route.tangent, -2.4).add(new THREE.Vector3(0, 4.1 + jumpLift, 0));
      camera.position.lerp(desiredCamera, 1 - Math.exp(-frameDelta * 2.8));
      const desiredLook = route.point.clone().addScaledVector(route.tangent, 2.1).add(new THREE.Vector3(0, 1.05 + jumpLift * 0.35, 0));
      cameraLook.lerp(desiredLook, 1 - Math.exp(-frameDelta * 3.6));
      camera.lookAt(cameraLook);
      const positions = rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < rainCount; index += 1) {
        let y = positions.getY(index) - frameDelta * 6;
        if (y < -5) y = 18;
        positions.setY(index, y);
      }
      positions.needsUpdate = true;
      mist.rotation.y = Math.sin(now * 0.08) * 0.025;
      streamUniforms.uTime.value = now;
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearInput);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInput();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      mistTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [clearInput, refreshInput]);

  return (
    <main className="game-shell">
      <div ref={containerRef} className="game-canvas" />
      <header className="game-header"><div><p className="eyebrow">Прототип 05 · направляемое 3D</p><h1>Лесной ручей</h1></div><button className="reset-button" type="button" onClick={() => resetRef.current(true)}>Начать заново</button></header>
      {!started && <section className="intro-card" aria-label="Управление"><p>Следуй по тропе и перепрыгни холодный ручей.</p><span>← → / A D — вдоль маршрута · Пробел — прыжок</span></section>}
      {webglError && <section className="webgl-card" role="alert"><p className="eyebrow">Не удалось запустить 3D</p><h2>Браузер не предоставил WebGL</h2><p>Открой прототип в обычной вкладке Chrome, Safari или Firefox с включённым аппаратным ускорением.</p></section>}
      {completed && <section className="completion-card" role="status"><p className="eyebrow">Секция завершена</p><h2>Ты перебрался через ручей</h2><p>{deaths === 0 ? "Чистое прохождение." : `Попыток после падения: ${deaths + 1}.`}</p><button type="button" onClick={() => resetRef.current(true)}>Пройти ещё раз</button></section>}
      <div className="touch-controls" aria-label="Сенсорное управление"><div className="move-controls"><button type="button" aria-label="Назад по маршруту" onPointerDown={(event) => pointerDown(event, "left")} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}>←</button><button type="button" aria-label="Вперёд по маршруту" onPointerDown={(event) => pointerDown(event, "right")} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}>→</button></div><button className="jump-button" type="button" aria-label="Прыгнуть" onPointerDown={(event) => pointerDown(event, "jump")} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}>↑<span>Прыжок</span></button></div>
    </main>
  );
}
