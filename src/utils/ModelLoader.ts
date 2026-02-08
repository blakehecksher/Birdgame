import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PlayerRole } from '../config/constants';

const loader = new GLTFLoader();

export interface ModelManifestEntry {
  key: string;
  path: string;
  optional?: boolean;
}

const modelCache = new Map<string, THREE.Group>();

function enableShadows(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function loadModel(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        enableShadows(model);
        resolve(model);
      },
      undefined,
      (error) => {
        reject(error);
      }
    );
  });
}

export async function preloadModelManifest(entries: ModelManifestEntry[]): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const loadTasks = entries.map(async (entry) => {
    try {
      const model = await loadModel(`${base}${entry.path}`);
      modelCache.set(entry.key, model);
    } catch (error) {
      if (!entry.optional) {
        throw error;
      }
      console.warn(`Optional model failed to load: ${entry.path}`);
    }
  });
  await Promise.all(loadTasks);
}

const CORE_MANIFEST: ModelManifestEntry[] = [
  { key: 'birds/hawk', path: 'models/birds/hawk.glb' },
  { key: 'birds/pigeon', path: 'models/birds/pigeon.glb' },
  { key: 'npcs/pigeon', path: 'models/npcs/npc_pigeon.glb', optional: true },
  { key: 'npcs/rat', path: 'models/npcs/npc_rat.glb', optional: true },
  { key: 'npcs/squirrel', path: 'models/npcs/npc_squirrel.glb', optional: true },
  { key: 'food/crumb', path: 'models/food/breadcrumb.glb', optional: true },
  { key: 'food/bagel', path: 'models/food/bagel.glb', optional: true },
  { key: 'food/pizza', path: 'models/food/pizza.glb', optional: true },
  { key: 'food/rat', path: 'models/food/rat.glb', optional: true },
  { key: 'environment/building', path: 'models/environment/building.glb', optional: true },
];

export async function preloadModels(): Promise<void> {
  await preloadModelManifest(CORE_MANIFEST);
}

export function getModelByKey(key: string): THREE.Group | null {
  const source = modelCache.get(key);
  if (!source) return null;
  const clone = source.clone();
  // Mark clone roots as cache-derived/shared so swap code does not dispose
  // resources that may be referenced by other active instances.
  clone.userData.fromModelCache = true;
  return clone;
}

export function getModel(role: PlayerRole): THREE.Group | null {
  return getModelByKey(role === PlayerRole.HAWK ? 'birds/hawk' : 'birds/pigeon');
}
