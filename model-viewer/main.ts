import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

type DisplayMode = "material" | "clay" | "normal" | "depth" | "orientation" | "wireframe";
type CameraView = "perspective" | "front" | "back" | "left" | "right" | "top";

type RegistryAsset = {
  id: string;
  name: string;
  description?: string;
  obj: string;
  mtl?: string;
  up?: "Y" | "Z";
  fallbackPreview?: string;
};

type AuditCheck = {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "warn" | "fail";
};

type AuditReport = {
  version: 1;
  generatedAt: string;
  source: { obj: string; mtl?: string };
  score: number;
  decision: "continue" | "inspect" | "stop";
  metrics: {
    positions: number;
    textureCoordinates: number;
    normals: number;
    polygons: number;
    triangles: number;
    objects: number;
    materialSlots: number;
    openEdges: number;
    nonManifoldEdges: number;
    degenerateTriangles: number;
    invertedWindingTriangles: number;
    duplicateFaces: number;
    invalidIndices: number;
    missingUvCorners: number;
    missingNormalCorners: number;
    weldedPositionRatio: number;
    bounds: { x: number; y: number; z: number };
  };
  checks: AuditCheck[];
  problemEdges: Array<{ kind: "open" | "non-manifold"; a: [number, number, number]; b: [number, number, number] }>;
};

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const assetSelect = document.querySelector<HTMLSelectElement>("#asset-select")!;
const objInput = document.querySelector<HTMLInputElement>("#obj-url")!;
const mtlInput = document.querySelector<HTMLInputElement>("#mtl-url")!;
const zUpInput = document.querySelector<HTMLInputElement>("#z-up")!;
const loadButton = document.querySelector<HTMLButtonElement>("#load-button")!;
const resetSourceButton = document.querySelector<HTMLButtonElement>("#reset-source")!;
const fitButton = document.querySelector<HTMLButtonElement>("#fit-button")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download-report")!;
const renderState = document.querySelector<HTMLSpanElement>("#render-state")!;
const modelName = document.querySelector<HTMLSpanElement>("#model-name")!;
const fallback = document.querySelector<HTMLDivElement>("#webgl-fallback")!;
const fallbackImage = document.querySelector<HTMLImageElement>("#fallback-image")!;
const fallbackMessage = document.querySelector<HTMLParagraphElement>("#fallback-message")!;
const metricsElement = document.querySelector<HTMLDivElement>("#metrics")!;
const checksElement = document.querySelector<HTMLDivElement>("#checks")!;
const summaryElement = document.querySelector<HTMLDivElement>("#summary-score")!;
const exposureInput = document.querySelector<HTMLInputElement>("#exposure")!;
const exposureValue = document.querySelector<HTMLOutputElement>("#exposure-value")!;
const lightAngleInput = document.querySelector<HTMLInputElement>("#light-angle")!;
const lightValue = document.querySelector<HTMLOutputElement>("#light-value")!;
const gridInput = document.querySelector<HTMLInputElement>("#grid-toggle")!;
const axesInput = document.querySelector<HTMLInputElement>("#axes-toggle")!;
const shadowInput = document.querySelector<HTMLInputElement>("#shadow-toggle")!;
const rotateInput = document.querySelector<HTMLInputElement>("#rotate-toggle")!;

let registry: RegistryAsset[] = [];
let currentReport: AuditReport | null = null;
let currentModel: THREE.Group | null = null;
let topologyOverlay: THREE.LineSegments | null = null;
let displayMode: DisplayMode = "material";
let webglAvailable = true;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let animationFrame = 0;
const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151a19);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
camera.position.set(8, 6, 8);

const root = new THREE.Group();
scene.add(root);

const hemisphere = new THREE.HemisphereLight(0xd7e4de, 0x28312e, 1.35);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(7, 9, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.bias = -0.00015;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9dbdaf, 1.25);
fillLight.position.set(-6, 3, -5);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xb8d4ff, 1.1);
rimLight.position.set(-3, 7, 8);
scene.add(rimLight);

const grid = new THREE.GridHelper(20, 20, 0x64716c, 0x303936);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.44;
scene.add(grid);
const axes = new THREE.AxesHelper(2.5);
axes.visible = false;
scene.add(axes);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.22 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.position.y = -0.002;
scene.add(floor);

const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xaeb8b2, roughness: 0.52, metalness: 0.0 });
const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide });
const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xbbe8d5, wireframe: true, side: THREE.DoubleSide });
const orientationMaterial = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    void main() {
      vec3 front = vec3(0.24, 0.72, 0.48);
      vec3 back = vec3(0.92, 0.22, 0.18);
      float facingLight = 0.55 + 0.45 * abs(vNormal.z);
      gl_FragColor = vec4((gl_FrontFacing ? front : back) * facingLight, 1.0);
    }
  `,
});

function resolveUrl(value: string, base = document.baseURI) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const githubBlob = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (githubBlob) {
    const [, owner, repo, branch, path] = githubBlob;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }
  return new URL(trimmed, base).href;
}

function sourceDirectory(url: string) {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

function setStatus(label: string, kind: "loading" | "ready" | "error" = "loading") {
  renderState.textContent = label;
  renderState.classList.toggle("is-ready", kind === "ready");
  renderState.classList.toggle("is-error", kind === "error");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    for (const value of Object.values(entry)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    if (![clayMaterial, normalMaterial, depthMaterial, wireMaterial, orientationMaterial].includes(entry)) entry.dispose();
  }
}

function clearModel() {
  if (!currentModel) return;
  root.remove(currentModel);
  currentModel.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const original = originalMaterials.get(object);
    if (original) disposeMaterial(original);
  });
  originalMaterials.clear();
  currentModel = null;
  if (topologyOverlay) {
    root.remove(topologyOverlay);
    topologyOverlay.geometry.dispose();
    (topologyOverlay.material as THREE.Material).dispose();
    topologyOverlay = null;
  }
}

function applyDisplayMode(mode: DisplayMode) {
  displayMode = mode;
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  if (!currentModel) return;
  currentModel.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const original = originalMaterials.get(object);
    if (mode === "material" && original) object.material = original;
    if (mode === "clay") object.material = clayMaterial;
    if (mode === "normal") object.material = normalMaterial;
    if (mode === "depth") object.material = depthMaterial;
    if (mode === "orientation") object.material = orientationMaterial;
    if (mode === "wireframe") object.material = wireMaterial;
  });
  if (topologyOverlay) topologyOverlay.visible = mode === "orientation";
}

function setView(view: CameraView) {
  if (!currentModel || !controls) return;
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  const box = new THREE.Box3().setFromObject(currentModel);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const distance = Math.max(1, sphere.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.45)));
  const direction: Record<CameraView, THREE.Vector3> = {
    perspective: new THREE.Vector3(1, 0.72, 1),
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    top: new THREE.Vector3(0.001, 1, 0.001),
  };
  camera.position.copy(sphere.center).add(direction[view].normalize().multiplyScalar(distance * 1.08));
  camera.near = Math.max(0.001, distance / 500);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
}

function fitModel() {
  setView("perspective");
}

function parseIndex(raw: string | undefined, count: number) {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value === 0) return NaN;
  return value > 0 ? value - 1 : count + value;
}

function auditObj(text: string, source: { obj: string; mtl?: string }): AuditReport {
  const positions: Array<[number, number, number]> = [];
  const uvs: Array<[number, number]> = [];
  const normals: Array<[number, number, number]> = [];
  const faces: Array<{ object: string; material: string; corners: Array<{ v: number | null; vt: number | null; vn: number | null }> }> = [];
  const objects = new Set<string>();
  const materials = new Set<string>();
  let objectName = "default";
  let materialName = "default";
  let invalidIndices = 0;
  let missingUvCorners = 0;
  let missingNormalCorners = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) positions.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    if (parts[0] === "vt" && parts.length >= 3) uvs.push([Number(parts[1]), Number(parts[2])]);
    if (parts[0] === "vn" && parts.length >= 4) normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    if ((parts[0] === "o" || parts[0] === "g") && parts[1]) {
      objectName = parts.slice(1).join(" ");
      objects.add(objectName);
    }
    if (parts[0] === "usemtl" && parts[1]) {
      materialName = parts.slice(1).join(" ");
      materials.add(materialName);
    }
    if (parts[0] !== "f" || parts.length < 4) continue;
    const corners = parts.slice(1).map((token) => {
      const [vRaw, vtRaw, vnRaw] = token.split("/");
      const v = parseIndex(vRaw, positions.length);
      const vt = parseIndex(vtRaw, uvs.length);
      const vn = parseIndex(vnRaw, normals.length);
      if (v === null || !Number.isFinite(v) || v < 0 || v >= positions.length) invalidIndices += 1;
      if (vt === null) missingUvCorners += 1;
      else if (!Number.isFinite(vt) || vt < 0 || vt >= uvs.length) invalidIndices += 1;
      if (vn === null) missingNormalCorners += 1;
      else if (!Number.isFinite(vn) || vn < 0 || vn >= normals.length) invalidIndices += 1;
      return { v, vt, vn };
    });
    faces.push({ object: objectName, material: materialName, corners });
  }

  const edgeUses = new Map<string, { count: number; a: number; b: number }>();
  const faceKeys = new Set<string>();
  let duplicateFaces = 0;
  let triangles = 0;
  let degenerateTriangles = 0;
  let invertedWindingTriangles = 0;
  let cornerCount = 0;

  for (const face of faces) {
    const valid = face.corners.map((corner) => corner.v).filter((value): value is number => value !== null && Number.isFinite(value));
    cornerCount += face.corners.length;
    const faceKey = `${face.object}|${[...valid].sort((a, b) => a - b).join(",")}`;
    if (faceKeys.has(faceKey)) duplicateFaces += 1;
    faceKeys.add(faceKey);
    for (let index = 0; index < valid.length; index += 1) {
      const a = valid[index];
      const b = valid[(index + 1) % valid.length];
      const key = `${face.object}|${Math.min(a, b)}|${Math.max(a, b)}`;
      const entry = edgeUses.get(key) ?? { count: 0, a, b };
      entry.count += 1;
      edgeUses.set(key, entry);
    }
    for (let index = 1; index < valid.length - 1; index += 1) {
      triangles += 1;
      const [a, b, c] = [positions[valid[0]], positions[valid[index]], positions[valid[index + 1]]];
      if (!a || !b || !c) continue;
      const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const geometricNormal = ab.cross(ac);
      if (geometricNormal.lengthSq() < 1e-16) {
        degenerateTriangles += 1;
        continue;
      }
      const triangleCorners = [face.corners[0], face.corners[index], face.corners[index + 1]];
      if (triangleCorners.every((corner) => corner.vn !== null && Number.isFinite(corner.vn) && normals[corner.vn!])) {
        const averageNormal = triangleCorners.reduce(
          (sum, corner) => sum.add(new THREE.Vector3(...normals[corner.vn!])),
          new THREE.Vector3(),
        );
        if (averageNormal.lengthSq() > 1e-16 && geometricNormal.dot(averageNormal) < 0) invertedWindingTriangles += 1;
      }
    }
  }

  const problemEdges: AuditReport["problemEdges"] = [];
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const edge of edgeUses.values()) {
    if (edge.count === 1) openEdges += 1;
    if (edge.count > 2) nonManifoldEdges += 1;
    if (edge.count !== 2 && positions[edge.a] && positions[edge.b]) {
      problemEdges.push({ kind: edge.count === 1 ? "open" : "non-manifold", a: positions[edge.a], b: positions[edge.b] });
    }
  }

  let invalidNormals = 0;
  for (const normal of normals) {
    const length = Math.hypot(...normal);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 0.002) invalidNormals += 1;
  }
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const position of positions) {
    min.min(new THREE.Vector3(...position));
    max.max(new THREE.Vector3(...position));
  }
  const size = max.clone().sub(min);
  const checks: AuditCheck[] = [
    { id: "indices", label: "Индексы OBJ", detail: invalidIndices ? `${invalidIndices} некорректных ссылок` : "все ссылки находятся в допустимых пределах", status: invalidIndices ? "fail" : "pass" },
    { id: "manifold", label: "Замкнутая топология", detail: `${openEdges} открытых · ${nonManifoldEdges} неманифолдных рёбер`, status: nonManifoldEdges ? "fail" : openEdges ? "warn" : "pass" },
    { id: "degenerate", label: "Площадь граней", detail: `${degenerateTriangles} вырожденных треугольников`, status: degenerateTriangles ? "fail" : "pass" },
    { id: "duplicates", label: "Повторы граней", detail: `${duplicateFaces} точных повторов`, status: duplicateFaces ? "warn" : "pass" },
    { id: "normals", label: "Пользовательские нормали", detail: normals.length ? `${invalidNormals} нормалей вне допуска` : "поток нормалей отсутствует", status: !normals.length || invalidNormals ? "warn" : "pass" },
    { id: "winding", label: "Ориентация граней", detail: invertedWindingTriangles ? `${invertedWindingTriangles} треугольников расходятся с нормалями` : "порядок вершин согласован с нормалями", status: invertedWindingTriangles ? "fail" : "pass" },
    { id: "uv", label: "UV-развёртка", detail: missingUvCorners ? `${missingUvCorners} углов без UV` : "каждый угол грани имеет UV", status: missingUvCorners ? "warn" : "pass" },
    { id: "materials", label: "Материальные слоты", detail: `${materials.size} материалов`, status: materials.size ? "pass" : "warn" },
  ];
  const penalty = checks.reduce((total, check) => total + (check.status === "fail" ? 18 : check.status === "warn" ? 5 : 0), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source,
    score,
    decision: checks.some((check) => check.status === "fail") ? "stop" : checks.some((check) => check.status === "warn") ? "inspect" : "continue",
    metrics: {
      positions: positions.length,
      textureCoordinates: uvs.length,
      normals: normals.length,
      polygons: faces.length,
      triangles,
      objects: objects.size || 1,
      materialSlots: materials.size,
      openEdges,
      nonManifoldEdges,
      degenerateTriangles,
      invertedWindingTriangles,
      duplicateFaces,
      invalidIndices,
      missingUvCorners,
      missingNormalCorners,
      weldedPositionRatio: cornerCount ? Math.max(0, 1 - positions.length / cornerCount) : 0,
      bounds: { x: size.x, y: size.y, z: size.z },
    },
    checks,
    problemEdges: problemEdges.slice(0, 10000),
  };
}

function renderReport(report: AuditReport) {
  const decisionLabel = report.decision === "continue" ? "структура прошла автоматические проверки" : report.decision === "inspect" ? "нужен визуальный осмотр предупреждений" : "найдены блокирующие ошибки";
  summaryElement.innerHTML = `<strong>${report.score}/100</strong><span>${decisionLabel}</span>`;
  const metrics = [
    [report.metrics.positions, "позиций"],
    [report.metrics.polygons, "полигонов"],
    [report.metrics.triangles, "треугольников"],
    [report.metrics.objects, "объектов"],
    [report.metrics.materialSlots, "материалов"],
    [`${formatNumber(report.metrics.bounds.x)}×${formatNumber(report.metrics.bounds.y)}×${formatNumber(report.metrics.bounds.z)}`, "границы"],
  ];
  metricsElement.innerHTML = metrics.map(([value, label]) => `<div class="metric"><strong>${typeof value === "number" ? formatNumber(value) : value}</strong><span>${label}</span></div>`).join("");
  checksElement.innerHTML = report.checks.map((check) => `<div class="check ${check.status === "pass" ? "" : check.status}"><strong>${check.label}</strong><span>${check.detail}</span></div>`).join("");
  downloadButton.disabled = false;
}

function createProblemEdgeOverlay(report: AuditReport) {
  if (!report.problemEdges.length) return null;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const edge of report.problemEdges) {
    positions.push(...edge.a, ...edge.b);
    const color = edge.kind === "open" ? [1, 0.64, 0.12] : [1, 0.12, 0.08];
    colors.push(...color, ...color);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.96 });
  const overlay = new THREE.LineSegments(geometry, material);
  overlay.renderOrder = 20;
  overlay.visible = displayMode === "orientation";
  return overlay;
}

async function loadModel(source: { obj: string; mtl?: string; zUp: boolean; name?: string; fallbackPreview?: string }) {
  const objUrl = resolveUrl(source.obj);
  const mtlUrl = source.mtl ? resolveUrl(source.mtl) : "";
  if (!objUrl) throw new Error("Укажите ссылку на OBJ");
  setStatus("Загрузка", "loading");
  modelName.textContent = source.name ?? objUrl.split("/").pop() ?? "OBJ";
  fallbackImage.src = source.fallbackPreview ? resolveUrl(source.fallbackPreview) : "";
  clearModel();

  const objResponse = await fetch(objUrl, { mode: "cors" });
  if (!objResponse.ok) throw new Error(`OBJ не загружен: HTTP ${objResponse.status}`);
  const objText = await objResponse.text();
  const report = auditObj(objText, { obj: objUrl, mtl: mtlUrl || undefined });
  currentReport = report;
  renderReport(report);

  if (!webglAvailable) {
    fallback.hidden = false;
    fallbackMessage.textContent = "Графический контекст недоступен. OBJ разобран, и автоматический отчёт сформирован без интерактивного рендера.";
    setStatus("Только отчёт", "error");
    return;
  }

  const objLoader = new OBJLoader();
  if (mtlUrl) {
    const mtlResponse = await fetch(mtlUrl, { mode: "cors" });
    if (!mtlResponse.ok) throw new Error(`MTL не загружен: HTTP ${mtlResponse.status}`);
    const mtlText = await mtlResponse.text();
    const materials = new MTLLoader().parse(mtlText, sourceDirectory(mtlUrl));
    materials.preload();
    objLoader.setMaterials(materials);
  }
  const model = objLoader.parse(objText);
  model.rotation.x = source.zUp ? -Math.PI / 2 : 0;
  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialCenter = initialBounds.getCenter(new THREE.Vector3());
  model.position.sub(initialCenter);
  model.updateMatrixWorld(true);
  const centeredBounds = new THREE.Box3().setFromObject(model);
  model.position.y -= centeredBounds.min.y;
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    originalMaterials.set(object, object.material);
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  currentModel = model;
  root.add(model);
  topologyOverlay = createProblemEdgeOverlay(report);
  if (topologyOverlay) model.add(topologyOverlay);
  applyDisplayMode(displayMode);
  fitModel();
  setStatus("Готово", "ready");

  const url = new URL(window.location.href);
  url.searchParams.set("obj", objUrl);
  if (mtlUrl) url.searchParams.set("mtl", mtlUrl); else url.searchParams.delete("mtl");
  url.searchParams.set("up", source.zUp ? "z" : "y");
  window.history.replaceState(null, "", url);
}

function initializeRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = Number(exposureInput.value);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
  } catch (error) {
    webglAvailable = false;
    fallback.hidden = false;
    fallbackMessage.textContent = error instanceof Error ? error.message : "Не удалось создать WebGL-контекст";
    setStatus("WebGL недоступен", "error");
  }
}

function resizeRenderer() {
  if (!renderer) return;
  const container = canvas.parentElement!;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  animationFrame = requestAnimationFrame(animate);
  if (!renderer || !controls) return;
  if (rotateInput.checked && currentModel) currentModel.rotation.y += 0.0035;
  controls.update();
  renderer.render(scene, camera);
}

async function loadRegistry() {
  const response = await fetch(new URL("models/registry.json", document.baseURI));
  if (!response.ok) throw new Error("Не удалось загрузить реестр моделей");
  registry = await response.json() as RegistryAsset[];
  assetSelect.innerHTML = registry.map((asset) => `<option value="${asset.id}">${asset.name}</option>`).join("");
  const params = new URLSearchParams(window.location.search);
  const obj = params.get("obj");
  if (obj) {
    objInput.value = obj;
    mtlInput.value = params.get("mtl") ?? "";
    zUpInput.checked = params.get("up") !== "y";
    await loadModel({ obj, mtl: mtlInput.value || undefined, zUp: zUpInput.checked });
    return;
  }
  const first = registry[0];
  if (!first) throw new Error("Реестр моделей пуст");
  objInput.value = resolveUrl(first.obj);
  mtlInput.value = first.mtl ? resolveUrl(first.mtl) : "";
  zUpInput.checked = first.up !== "Y";
  await loadModel({ obj: first.obj, mtl: first.mtl, zUp: zUpInput.checked, name: first.name, fallbackPreview: first.fallbackPreview });
}

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => applyDisplayMode(button.dataset.mode as DisplayMode)));
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view as CameraView)));
fitButton.addEventListener("click", fitModel);
loadButton.addEventListener("click", () => loadModel({ obj: objInput.value, mtl: mtlInput.value || undefined, zUp: zUpInput.checked }).catch(showError));
resetSourceButton.addEventListener("click", () => {
  const asset = registry.find((entry) => entry.id === assetSelect.value) ?? registry[0];
  if (!asset) return;
  objInput.value = resolveUrl(asset.obj);
  mtlInput.value = asset.mtl ? resolveUrl(asset.mtl) : "";
  zUpInput.checked = asset.up !== "Y";
});
assetSelect.addEventListener("change", () => {
  const asset = registry.find((entry) => entry.id === assetSelect.value);
  if (!asset) return;
  objInput.value = resolveUrl(asset.obj);
  mtlInput.value = asset.mtl ? resolveUrl(asset.mtl) : "";
  zUpInput.checked = asset.up !== "Y";
  loadModel({ obj: asset.obj, mtl: asset.mtl, zUp: zUpInput.checked, name: asset.name, fallbackPreview: asset.fallbackPreview }).catch(showError);
});
downloadButton.addEventListener("click", () => {
  if (!currentReport) return;
  const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(modelName.textContent ?? "model").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-qa-report.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});
exposureInput.addEventListener("input", () => {
  exposureValue.value = Number(exposureInput.value).toFixed(2);
  if (renderer) renderer.toneMappingExposure = Number(exposureInput.value);
});
lightAngleInput.addEventListener("input", () => {
  const angle = THREE.MathUtils.degToRad(Number(lightAngleInput.value));
  keyLight.position.set(Math.cos(angle) * 9, 9, Math.sin(angle) * 9);
  lightValue.value = `${lightAngleInput.value}°`;
});
gridInput.addEventListener("change", () => { grid.visible = gridInput.checked; });
axesInput.addEventListener("change", () => { axes.visible = axesInput.checked; });
shadowInput.addEventListener("change", () => {
  if (renderer) renderer.shadowMap.enabled = shadowInput.checked;
  floor.visible = shadowInput.checked;
});
window.addEventListener("resize", resizeRenderer);
window.addEventListener("beforeunload", () => cancelAnimationFrame(animationFrame));

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus("Ошибка", "error");
  checksElement.innerHTML = `<div class="check bad"><strong>Загрузка</strong><span>${message}</span></div>`;
  fallbackMessage.textContent = message;
  if (!webglAvailable) fallback.hidden = false;
}

initializeRenderer();
resizeRenderer();
animate();
loadRegistry().catch(showError);
