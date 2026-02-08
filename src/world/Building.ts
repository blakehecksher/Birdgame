import * as THREE from 'three';

/**
 * A city building with AABB collision bounds
 */
export class Building {
  public mesh: THREE.Object3D;
  public min: THREE.Vector3;
  public max: THREE.Vector3;

  constructor(
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    model?: THREE.Group | null
  ) {
    if (model) {
      this.mesh = model;
      this.mesh.position.set(x, height / 2, z);
    } else {
      // Procedural fallback
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshLambertMaterial({
        color: this.getDeterministicBuildingColor(x, z),
      });

      const body = new THREE.Mesh(geometry, material);
      body.castShadow = true;
      body.receiveShadow = true;

      const root = new THREE.Group();
      root.position.set(x, height / 2, z); // Y is half-height so base sits on ground
      root.add(body);

      this.mesh = root;

      // Add window details
      this.addWindows(body, width, height, depth);
    }

    // Set AABB bounds
    this.min = new THREE.Vector3(
      x - width / 2,
      0,
      z - depth / 2
    );
    this.max = new THREE.Vector3(
      x + width / 2,
      height,
      z + depth / 2
    );
  }

  /**
   * Add simple window pattern to building using a second mesh overlay
   */
  private addWindows(target: THREE.Object3D, width: number, height: number, depth: number): void {
    // Create a slightly larger mesh with window texture effect
    // Simple approach: add darker strips to simulate window rows
    const windowColor = 0x88bbdd;
    const windowMat = new THREE.MeshLambertMaterial({
      color: windowColor,
      transparent: true,
      opacity: 0.4,
    });

    const floors = Math.floor(height / 3);
    for (let i = 0; i < floors; i++) {
      const y = (i + 0.5) * 3 + 0.5;
      if (y > height - 1) break;

      // Windows on front face (z+)
      const windowFront = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.8, 1.2),
        windowMat
      );
      // Position relative to mesh center (mesh is at y=height/2)
      windowFront.position.set(0, y - height / 2, depth / 2 + 0.01);
      target.add(windowFront);

      // Windows on back face (z-)
      const windowBack = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.8, 1.2),
        windowMat
      );
      windowBack.position.set(0, y - height / 2, -depth / 2 - 0.01);
      windowBack.rotation.y = Math.PI;
      target.add(windowBack);
    }
  }

  /**
   * Deterministic muted building color based on position.
   */
  private getDeterministicBuildingColor(x: number, z: number): number {
    const colors = [
      0x8a8a8a, // Gray
      0x9a8a7a, // Tan
      0x7a7a8a, // Blue-gray
      0x8a7a7a, // Reddish gray
      0xa09080, // Warm gray
      0x808890, // Cool gray
      0x9a9080, // Olive gray
      0x887878, // Mauve gray
    ];
    const hash = Math.abs(Math.floor((x * 73.0) + (z * 97.0)));
    return colors[hash % colors.length];
  }

  /**
   * Check if a point + radius intersects this building's AABB
   */
  public intersectsSphere(position: THREE.Vector3, radius: number): boolean {
    const closestX = Math.max(this.min.x, Math.min(position.x, this.max.x));
    const closestY = Math.max(this.min.y, Math.min(position.y, this.max.y));
    const closestZ = Math.max(this.min.z, Math.min(position.z, this.max.z));

    const dx = position.x - closestX;
    const dy = position.y - closestY;
    const dz = position.z - closestZ;

    return (dx * dx + dy * dy + dz * dz) < (radius * radius);
  }

  /**
   * Push a sphere out of this building's AABB
   */
  public pushOut(position: THREE.Vector3, radius: number, velocity: THREE.Vector3): void {
    // Find the center of the AABB
    const cx = (this.min.x + this.max.x) / 2;
    const cy = (this.min.y + this.max.y) / 2;
    const cz = (this.min.z + this.max.z) / 2;

    // Half-extents
    const hx = (this.max.x - this.min.x) / 2;
    const hy = (this.max.y - this.min.y) / 2;
    const hz = (this.max.z - this.min.z) / 2;

    // Vector from AABB center to sphere center
    const dx = position.x - cx;
    const dy = position.y - cy;
    const dz = position.z - cz;

    // Find overlap on each axis
    const overlapX = hx + radius - Math.abs(dx);
    const overlapY = hy + radius - Math.abs(dy);
    const overlapZ = hz + radius - Math.abs(dz);

    // Push out along the axis with minimum overlap (minimum penetration)
    if (overlapX < overlapY && overlapX < overlapZ) {
      position.x += dx > 0 ? overlapX : -overlapX;
      velocity.x = 0;
    } else if (overlapY < overlapZ) {
      position.y += dy > 0 ? overlapY : -overlapY;
      velocity.y = 0;
    } else {
      position.z += dz > 0 ? overlapZ : -overlapZ;
      velocity.z = 0;
    }
  }

  public dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
