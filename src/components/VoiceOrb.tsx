"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

declare global {
  interface Window {
    THREE: any;
    gsap: any;
  }
}

export default function VoiceOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const agentName = "voice-agent";
  
  const roomRef = useRef<Room | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const localDataArrayRef = useRef<Uint8Array | null>(null);
  const remoteDataArrayRef = useRef<Uint8Array | null>(null);
  const smoothedAmplitudeRef = useRef(0);
  const materialRef = useRef<any>(null);
  const particlesRef = useRef<any>(null);
  const sceneInitializedRef = useRef(false);


  const getAmplitude = useCallback(() => {
    let localAmplitude = 0;
    let remoteAmplitude = 0;

    if (localAnalyserRef.current && localDataArrayRef.current) {
      localAnalyserRef.current.getByteFrequencyData(localDataArrayRef.current);
      const sum = localDataArrayRef.current.reduce((a, b) => a + b, 0);
      localAmplitude = sum / localDataArrayRef.current.length / 255;
    }

    if (remoteAnalyserRef.current && remoteDataArrayRef.current) {
      remoteAnalyserRef.current.getByteFrequencyData(remoteDataArrayRef.current);
      const sum = remoteDataArrayRef.current.reduce((a, b) => a + b, 0);
      remoteAmplitude = sum / remoteDataArrayRef.current.length / 255;
    }

    const targetAmplitude = Math.max(localAmplitude, remoteAmplitude);
    smoothedAmplitudeRef.current += (targetAmplitude - smoothedAmplitudeRef.current) * 0.25;
    return smoothedAmplitudeRef.current;
  }, []);

  const setupLocalAudioAnalyser = (track: any) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const mediaStream = new MediaStream([track.mediaStreamTrack]);
    const source = audioContextRef.current.createMediaStreamSource(mediaStream);
    localAnalyserRef.current = audioContextRef.current.createAnalyser();
    localAnalyserRef.current.fftSize = 256;
    source.connect(localAnalyserRef.current);
    localDataArrayRef.current = new Uint8Array(localAnalyserRef.current.frequencyBinCount);
  };

  const setupRemoteAudioAnalyser = async (track: any) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Resume audio context (required by Chrome autoplay policy)
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    const audioEl = track.attach() as HTMLAudioElement;
    audioEl.style.display = "none";
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    document.body.appendChild(audioEl);
    
    // Explicitly play (needed for Chrome)
    try {
      await audioEl.play();
    } catch (e) {
      console.log("Audio play failed, will retry on interaction");
    }

    const mediaStream = new MediaStream([track.mediaStreamTrack]);
    const source = audioContextRef.current.createMediaStreamSource(mediaStream);
    remoteAnalyserRef.current = audioContextRef.current.createAnalyser();
    remoteAnalyserRef.current.fftSize = 256;
    source.connect(remoteAnalyserRef.current);
    remoteDataArrayRef.current = new Uint8Array(remoteAnalyserRef.current.frequencyBinCount);
  };

  // Initialize Three.js scene
  useEffect(() => {
    if (sceneInitializedRef.current) return;

    const loadScript = (src: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (src.includes("three") && window.THREE) {
          resolve();
          return;
        }
        if (src.includes("gsap") && window.gsap) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => resolve();
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

    const initScene = async () => {
      try {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js");

        if (!containerRef.current || !window.THREE) return;

        sceneInitializedRef.current = true;
        const THREE = window.THREE;
        const container = containerRef.current;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        camera.position.z = 300;

        // Particle system
        const particleCount = 10000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const maxRadius = 100;
        for (let i = 0; i < particleCount; i++) {
          const radius = maxRadius * Math.cbrt(Math.random());
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(Math.random() * 2 - 1);

          positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
          positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
          positions[i * 3 + 2] = radius * Math.cos(phi);

          const brightness = 0.8 + Math.random() * 0.2;
          colors[i * 3] = brightness;
          colors[i * 3 + 1] = brightness;
          colors[i * 3 + 2] = brightness;

          sizes[i] = 1.6 + Math.random() * 1.2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            mouse: { value: new THREE.Vector3(9999, 9999, 0) },
            hoverRadius: { value: 35.0 },
            hoverStrength: { value: 30.0 },
            audioAmplitude: { value: 0.0 },
            audioExpansion: { value: 120.0 },
            isConnected: { value: 0.0 },
          },
          vertexShader: `
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            uniform float time;
            uniform vec3 mouse;
            uniform float hoverRadius;
            uniform float hoverStrength;
            uniform float audioAmplitude;
            uniform float audioExpansion;
            uniform float isConnected;
            
            float hash(vec3 p) {
              p = fract(p * 0.3183099 + 0.1);
              p *= 17.0;
              return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            
            float noise(vec3 p) {
              vec3 i = floor(p);
              vec3 f = fract(p);
              f = f * f * (3.0 - 2.0 * f);
              return mix(
                mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                    mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                    mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
            }
            
            void main() {
              // Color based on connection state
              // Not connected: Urinal cake blue (#8AB8BC), Connected: white
              vec3 disconnectedColor = vec3(0.7, 0.85, 0.87);
              vec3 connectedColor = color; // White
              vColor = mix(disconnectedColor, connectedColor, isConnected);
              
              vec3 pos = position;
              
              float distFromCenter = length(position);
              vec3 dirFromCenter = normalize(position);
              float audioNoise = noise(position * 0.02 + time * 2.0);
              float expansion = audioAmplitude * audioExpansion * (0.5 + audioNoise);
              pos += dirFromCenter * expansion;
              
              float turbulence = audioAmplitude * 40.0;
              pos.x += sin(time * 3.0 + position.y * 0.05) * turbulence * audioNoise;
              pos.y += cos(time * 3.0 + position.x * 0.05) * turbulence * audioNoise;
              pos.z += sin(time * 2.0 + position.z * 0.05) * turbulence * audioNoise;
              
              vec3 toMouse = pos - mouse;
              float dist = length(toMouse);
              
              float noiseVal = noise(position * 0.05 + time * 0.5);
              float featheredRadius = hoverRadius * (0.6 + noiseVal * 0.8);
              
              if (dist < featheredRadius && dist > 0.0) {
                vec3 pushDir = normalize(toMouse);
                float falloff = 1.0 - smoothstep(0.0, featheredRadius, dist);
                falloff = pow(falloff, 0.5);
                
                float angleNoise = noise(position * 0.1 + time) * 2.0 - 1.0;
                pushDir.x += angleNoise * 0.3;
                pushDir.y += noise(position * 0.1 - time) * 0.3 - 0.15;
                pushDir = normalize(pushDir);
                
                float pushAmount = falloff * hoverStrength * (0.7 + noiseVal * 0.6);
                pos += pushDir * pushAmount;
              }
              
              pos.x += sin(time * 0.5 + position.y * 0.01) * 2.0;
              pos.y += cos(time * 0.5 + position.x * 0.01) * 2.0;
              
              vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
              float sizeBoost = 1.0 + audioAmplitude * 0.5;
              gl_PointSize = size * sizeBoost * (200.0 / -mvPosition.z);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            varying vec3 vColor;
            
            void main() {
              float dist = length(gl_PointCoord - vec2(0.5));
              if (dist > 0.5) discard;
              
              float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
              gl_FragColor = vec4(vColor, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

        materialRef.current = material;

        const particles = new THREE.Points(geometry, material);
        particlesRef.current = particles;
        scene.add(particles);

        // Mouse tracking
        const mouse = new THREE.Vector2();
        const mouseWorld = new THREE.Vector3();
        const inverseMatrix = new THREE.Matrix4();

        const handleMouseMove = (event: MouseEvent) => {
          mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
          mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

          mouseWorld.set(mouse.x, mouse.y, 0.5);
          mouseWorld.unproject(camera);

          const dir = mouseWorld.sub(camera.position).normalize();
          const distance = -camera.position.z / dir.z;
          const pos = camera.position.clone().add(dir.multiplyScalar(distance));

          inverseMatrix.copy(particles.matrixWorld).invert();
          pos.applyMatrix4(inverseMatrix);

          material.uniforms.mouse.value.copy(pos);
        };

        const handleMouseLeave = () => {
          material.uniforms.mouse.value.set(9999, 9999, 0);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseleave", handleMouseLeave);

        const handleResize = () => {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", handleResize);

        let time = 0;
        const animate = () => {
          animationRef.current = requestAnimationFrame(animate);

          time += 0.01;
          material.uniforms.time.value = time;

          const amplitude = getAmplitude();
          material.uniforms.audioAmplitude.value = amplitude;

          const rotationSpeed = 0.002 * (1 - amplitude * 0.5);
          particles.rotation.y += rotationSpeed;
          particles.rotation.x += rotationSpeed * 0.5;

          particles.updateMatrixWorld();
          renderer.render(scene, camera);
        };

        animate();

        return () => {
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseleave", handleMouseLeave);
          window.removeEventListener("resize", handleResize);
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
          }
          renderer.dispose();
        };
      } catch (error) {
        console.error("Failed to initialize scene:", error);
      }
    };

    initScene();
  }, [getAmplitude]);

  const connect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    setStatus("");

    // Initialize and resume audio context on user interaction (required by Chrome)
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    try {
      const body: any = {};
      if (agentName && agentName.trim()) {
        body.room_config = {
          agents: [{ agentName: agentName.trim() }],
        };
      }

      const response = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        setStatus("");
        setIsConnected(true);
        setIsConnecting(false);
        if (materialRef.current) {
          materialRef.current.uniforms.isConnected.value = 1.0;
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setStatus("");
        setIsConnected(false);
        setIsConnecting(false);
        localAnalyserRef.current = null;
        remoteAnalyserRef.current = null;
        localDataArrayRef.current = null;
        remoteDataArrayRef.current = null;
        smoothedAmplitudeRef.current = 0;
        if (materialRef.current) {
          materialRef.current.uniforms.isConnected.value = 0.0;
        }
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        setStatus("");
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          setupRemoteAudioAnalyser(track);
          setStatus("");
        }
      });

      await room.connect(data.server_url, data.participant_token);
      await room.localParticipant.setMicrophoneEnabled(true);

      const localTracks = room.localParticipant.audioTrackPublications;
      localTracks.forEach((pub) => {
        if (pub.track) {
          setupLocalAudioAnalyser(pub.track);
        }
      });
    } catch (error: any) {
      console.error("Connection failed:", error);
      setStatus("Connection failed");
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setIsConnected(false);
    setStatus("");
    if (materialRef.current) {
      materialRef.current.uniforms.isConnected.value = 0.0;
    }
  };

  const handleOrbClick = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0a0a0f]">
      {/* Status */}
      {status && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 text-white/60 text-sm z-50">
          {status}
        </div>
      )}


      {/* Clickable overlay for orb */}
      <div
        ref={containerRef}
        className="w-full h-full cursor-pointer"
        onClick={handleOrbClick}
      />
    </div>
  );
}
