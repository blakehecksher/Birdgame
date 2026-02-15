import * as THREE from 'three';
import { GAME_CONFIG } from '../config/constants';
import { getQualityTier, QualityTier } from '../input/mobileDetect';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private qualityTier: QualityTier;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.qualityTier = getQualityTier();

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 20);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const maxRatio = this.qualityTier === 'low' ? GAME_CONFIG.MOBILE_PIXEL_RATIO_CAP : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    if (this.qualityTier === 'low' && !GAME_CONFIG.MOBILE_SHADOWS_ENABLED) {
      this.renderer.shadowMap.enabled = false;
    } else {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Set up lighting
    this.setupLighting();

    // Create ground
    this.createGround();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  private setupLighting(): void {
    // Ambient light for general illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;

    // Configure shadow properties
    const shadowSize = this.qualityTier === 'low' ? GAME_CONFIG.MOBILE_SHADOW_MAP_SIZE : 2048;
    directionalLight.shadow.mapSize.width = shadowSize;
    directionalLight.shadow.mapSize.height = shadowSize;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;

    this.scene.add(directionalLight);

    // Add hemisphere light for better outdoor lighting
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    this.scene.add(hemisphereLight);
  }

  private createGround(): void {
    const groundSize = GAME_CONFIG.GROUND_SIZE;

    // Ground geometry
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMaterial = new THREE.MeshLambertMaterial({
      color: 0x555555, // Dark gray pavement
    });

    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    ground.position.y = 0;
    ground.receiveShadow = true;

    this.scene.add(ground);

    if (GAME_CONFIG.SHOW_DEBUG_GRID) {
      const gridHelper = new THREE.GridHelper(groundSize, 20, 0x888888, 0x444444);
      this.scene.add(gridHelper);
    }
  }

  private onWindowResize(): void {
    // Update camera aspect ratio
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    // Update renderer size
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    window.removeEventListener('resize', () => this.onWindowResize());
    this.renderer.dispose();
  }
}
