/**
 * 3D Blockchain Network Visualization for DecentraForce
 * Uses Three.js to create an interactive network of nodes and connections
 */

class BlockchainNetwork {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container with id "${containerId}" not found`);
            return;
        }

        // Scene setup
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.renderer.domElement);

        // Camera position
        this.camera.position.z = 12;
        this.camera.position.y = 5;
        this.camera.lookAt(0, 0, 0);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0x00e5ff, 0.8);
        directionalLight.position.set(10, 20, 5);
        this.scene.add(directionalLight);

        // Colors from CSS variables
        this.colors = {
            accent: 0x00e5ff,
            accent2: 0x7b5cff,
            accent3: 0xff4d8d,
            surface: 0x0d1630
        };

        // Nodes and edges
        this.nodes = [];
        this.edges = [];

        // Create network
        this.createNetwork();

        // Animation loop
        this.clock = new THREE.Clock();
        this.animate();

        // Handle resize
        window.addEventListener('resize', () => this.onResize());
    }

    createNetwork() {
        // Create 8 nodes in a spherical arrangement
        const nodeCount = 8;
        const radius = 5;

        for (let i = 0; i < nodeCount; i++) {
            const phi = Math.acos(-1 + (2 * i) / nodeCount);
            const theta = Math.sqrt(nodeCount * Math.PI) * phi;

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            // Node geometry
            const geometry = new THREE.SphereGeometry(0.4, 16, 16);
            const material = new THREE.MeshPhongMaterial({
                color: i % 2 === 0 ? this.colors.accent : this.colors.accent2,
                emissive: i % 3 === 0 ? this.colors.accent3 : 0x000000,
                emissiveIntensity: 0.2,
                shininess: 100
            });
            const node = new THREE.Mesh(geometry, material);
            node.position.set(x, y, z);
            this.scene.add(node);
            this.nodes.push({ mesh: node, originalPosition: { x, y, z } });

            // Add a glow effect (point light)
            const light = new THREE.PointLight(this.colors.accent, 0.5, 10);
            light.position.set(x, y, z);
            this.scene.add(light);
        }

        // Create edges between nodes (random connections)
        for (let i = 0; i < nodeCount; i++) {
            for (let j = i + 1; j < nodeCount; j++) {
                if (Math.random() > 0.6) continue; // sparse connections
                const start = this.nodes[i].mesh.position;
                const end = this.nodes[j].mesh.position;

                const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(start.x, start.y, start.z),
                    new THREE.Vector3(end.x, end.y, end.z)
                ]);
                const edgeMaterial = new THREE.LineBasicMaterial({
                    color: this.colors.accent,
                    transparent: true,
                    opacity: 0.3,
                    linewidth: 1
                });
                const edge = new THREE.Line(edgeGeometry, edgeMaterial);
                this.scene.add(edge);
                this.edges.push(edge);
            }
        }

        // Central node (larger)
        const centralGeometry = new THREE.IcosahedronGeometry(1.2, 2);
        const centralMaterial = new THREE.MeshPhongMaterial({
            color: this.colors.accent2,
            emissive: this.colors.accent,
            emissiveIntensity: 0.3,
            shininess: 120
        });
        this.centralNode = new THREE.Mesh(centralGeometry, centralMaterial);
        this.scene.add(this.centralNode);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        // Rotate central node
        if (this.centralNode) {
            this.centralNode.rotation.x += delta * 0.3;
            this.centralNode.rotation.y += delta * 0.5;
        }

        // Float nodes
        this.nodes.forEach((node, i) => {
            const offset = time * 0.5 + i;
            node.mesh.position.y = node.originalPosition.y + Math.sin(offset) * 0.2;
            node.mesh.position.x = node.originalPosition.x + Math.cos(offset * 0.7) * 0.1;
            node.mesh.rotation.x += delta * 0.2;
            node.mesh.rotation.y += delta * 0.3;
        });

        // Rotate camera slightly
        this.camera.position.x = Math.sin(time * 0.1) * 2;
        this.camera.lookAt(0, 0, 0);

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Check if Three.js is available
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded');
        showFallback();
        return;
    }

    // Check WebGL support
    if (!isWebGLAvailable()) {
        console.warn('WebGL not supported, falling back to static visualization');
        showFallback();
        return;
    }

    // Create network visualization in the hero 3d container
    try {
        const network = new BlockchainNetwork('hero-3d-container');
        // Hide loading indicator if any
        const container = document.getElementById('hero-3d-container');
        if (container) {
            const loading = container.querySelector('.loading-fallback');
            if (loading) loading.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to initialize 3D scene:', error);
        showFallback();
    }
});

function isWebGLAvailable() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext &&
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
        return false;
    }
}

function showFallback() {
    const container = document.getElementById('hero-3d-container');
    if (!container) return;
    // Remove any existing canvas
    const canvas = container.querySelector('canvas');
    if (canvas) canvas.remove();
    // Show fallback message
    let fallback = container.querySelector('.loading-fallback');
    if (!fallback) {
        fallback = document.createElement('div');
        fallback.className = 'loading-fallback';
        fallback.innerHTML = `
            <div style="text-align:center; padding: 20px; color: var(--muted);">
                <div style="font-size: 3rem;">⛓️</div>
                <p>Interactive 3D visualization unavailable.<br>Displaying static representation.</p>
            </div>
        `;
        container.appendChild(fallback);
    }
    fallback.style.display = 'block';
}