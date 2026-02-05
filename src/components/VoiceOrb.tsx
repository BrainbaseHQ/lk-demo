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
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [showOrb, setShowOrb] = useState(false);
  const [agentName, setAgentName] = useState("voice-agent");
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  
  // Fade in orb after 1 second
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowOrb(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);
  
  const roomRef = useRef<Room | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const localDataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const remoteDataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothedAmplitudeRef = useRef(0);
  const materialRef = useRef<any>(null);
  const particlesRef = useRef<any>(null);
  const sceneInitializedRef = useRef(false);
  const morphTargetRef = useRef(0); // 0 = torus, 1 = sphere
  const currentMorphRef = useRef(0);


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

  const setupLocalAudioAnalyser = async (track: any) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Resume audio context if suspended
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    try {
      const mediaStream = new MediaStream([track.mediaStreamTrack]);
      const source = audioContextRef.current.createMediaStreamSource(mediaStream);
      localAnalyserRef.current = audioContextRef.current.createAnalyser();
      localAnalyserRef.current.fftSize = 256;
      source.connect(localAnalyserRef.current);
      localDataArrayRef.current = new Uint8Array(localAnalyserRef.current.frequencyBinCount);
    } catch (e) {
      console.error("Failed to set up local audio analyser:", e);
    }
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
    audioEl.setAttribute("playsinline", "true");
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

        // Particle system - Torus (donut) shape
        const particleCount = 5000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        // Store both torus and sphere positions for morphing
        const torusPositions = new Float32Array(particleCount * 3);
        const spherePositions = new Float32Array(particleCount * 3);
        
        // Torus parameters (smaller size)
        const torusRadius = 45;
        const tubeRadius = 18;
        const sphereRadius = 50;
        
        for (let i = 0; i < particleCount; i++) {
          // Torus position
          const u = Math.random() * Math.PI * 2;
          const v = Math.random() * Math.PI * 2;
          const r = tubeRadius * Math.sqrt(Math.random());
          
          torusPositions[i * 3] = (torusRadius + r * Math.cos(v)) * Math.cos(u);
          torusPositions[i * 3 + 1] = (torusRadius + r * Math.cos(v)) * Math.sin(u);
          torusPositions[i * 3 + 2] = r * Math.sin(v);
          
          // Sphere position (same particle, different shape)
          const sRadius = sphereRadius * Math.cbrt(Math.random());
          const sTheta = Math.random() * Math.PI * 2;
          const sPhi = Math.acos(Math.random() * 2 - 1);
          
          spherePositions[i * 3] = sRadius * Math.sin(sPhi) * Math.cos(sTheta);
          spherePositions[i * 3 + 1] = sRadius * Math.sin(sPhi) * Math.sin(sTheta);
          spherePositions[i * 3 + 2] = sRadius * Math.cos(sPhi);
          
          // Start with torus
          positions[i * 3] = torusPositions[i * 3];
          positions[i * 3 + 1] = torusPositions[i * 3 + 1];
          positions[i * 3 + 2] = torusPositions[i * 3 + 2];

          const brightness = 0.8 + Math.random() * 0.2;
          colors[i * 3] = brightness;
          colors[i * 3 + 1] = brightness;
          colors[i * 3 + 2] = brightness;

          sizes[i] = 1.6 + Math.random() * 1.2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("torusPos", new THREE.BufferAttribute(torusPositions, 3));
        geometry.setAttribute("spherePos", new THREE.BufferAttribute(spherePositions, 3));
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
            attribute vec3 torusPos;
            attribute vec3 spherePos;
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
              
              // Morph between torus (disconnected) and sphere (connected)
              vec3 basePos = mix(torusPos, spherePos, isConnected);
              vec3 pos = basePos;
              
              float distFromCenter = length(basePos);
              vec3 dirFromCenter = normalize(basePos);
              float audioNoise = noise(basePos * 0.02 + time * 2.0);
              float expansion = audioAmplitude * audioExpansion * (0.5 + audioNoise);
              pos += dirFromCenter * expansion;
              
              float turbulence = audioAmplitude * 40.0;
              pos.x += sin(time * 3.0 + position.y * 0.05) * turbulence * audioNoise;
              pos.y += cos(time * 3.0 + position.x * 0.05) * turbulence * audioNoise;
              pos.z += sin(time * 2.0 + position.z * 0.05) * turbulence * audioNoise;
              
              vec3 toMouse = pos - mouse;
              float dist = length(toMouse);
              
              float noiseVal = noise(basePos * 0.05 + time * 0.5);
              float featheredRadius = hoverRadius * (0.6 + noiseVal * 0.8);
              
              if (dist < featheredRadius && dist > 0.0) {
                vec3 pushDir = normalize(toMouse);
                float falloff = 1.0 - smoothstep(0.0, featheredRadius, dist);
                falloff = pow(falloff, 0.5);
                
                float angleNoise = noise(basePos * 0.1 + time) * 2.0 - 1.0;
                pushDir.x += angleNoise * 0.3;
                pushDir.y += noise(basePos * 0.1 - time) * 0.3 - 0.15;
                pushDir = normalize(pushDir);
                
                float pushAmount = falloff * hoverStrength * (0.7 + noiseVal * 0.6);
                pos += pushDir * pushAmount;
              }
              
              // Flowing movement - different for torus vs sphere
              float flowSpeed = 0.3;
              float swirl = time * flowSpeed;
              
              // Calculate angle for flow
              float angle = atan(basePos.z, basePos.x);
              float flowOffset = sin(swirl + angle * 2.0) * 4.0;
              
              // Torus: particles flow around the ring
              // Sphere: particles have gentle ambient motion
              float torusFlow = 1.0 - isConnected;
              
              pos.x += sin(time * 0.5 + basePos.y * 0.02 + angle) * 3.0 * torusFlow;
              pos.z += cos(time * 0.5 + basePos.y * 0.02 + angle) * 3.0 * torusFlow;
              pos.y += flowOffset * torusFlow;
              
              // Add turbulent motion (both states)
              pos.x += sin(time * 0.8 + basePos.y * 0.05) * 2.0;
              pos.y += cos(time * 0.6 + basePos.x * 0.03) * 2.0;
              pos.z += sin(time * 0.7 + basePos.z * 0.04) * 2.0;
              
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

          // Smooth morph transition
          currentMorphRef.current += (morphTargetRef.current - currentMorphRef.current) * 0.05;
          material.uniforms.isConnected.value = currentMorphRef.current;

          // No rotation - particles move internally via shader

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
        morphTargetRef.current = 1.0; // Morph to sphere
      });

      room.on(RoomEvent.Disconnected, () => {
        // Clean up audio elements
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(el => {
          el.pause();
          el.srcObject = null;
          el.remove();
        });
        
        setStatus("");
        setIsConnected(false);
        setIsConnecting(false);
        localAnalyserRef.current = null;
        remoteAnalyserRef.current = null;
        localDataArrayRef.current = null;
        remoteDataArrayRef.current = null;
        smoothedAmplitudeRef.current = 0;
        morphTargetRef.current = 0.0; // Morph back to torus
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

      // Listen for local track published to set up analyser
      room.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.track && publication.track.kind === Track.Kind.Audio) {
          setupLocalAudioAnalyser(publication.track);
        }
      });

      await room.connect(data.server_url, data.participant_token);
      
      // Try to enable mic, but don't fail if permission denied
      room.localParticipant.setMicrophoneEnabled(true).catch((micError: any) => {
        console.warn("Microphone not available:", micError.message);
        // Don't show error - just continue without mic
      });

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

  const disconnect = async () => {
    if (roomRef.current) {
      // Disable mic first
      try {
        await roomRef.current.localParticipant.setMicrophoneEnabled(false);
      } catch (e) {
        // Ignore errors
      }
      // Properly disconnect and clean up
      roomRef.current.disconnect(true); // true = stop all tracks
      roomRef.current = null;
    }
    
    // Clean up audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(el => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    
    // Reset analysers
    localAnalyserRef.current = null;
    remoteAnalyserRef.current = null;
    localDataArrayRef.current = null;
    remoteDataArrayRef.current = null;
    smoothedAmplitudeRef.current = 0;
    
    setIsConnected(false);
    setIsMicMuted(false);
    setStatus("");
    morphTargetRef.current = 0.0; // Morph back to torus
  };

  const handleOrbClick = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  const toggleMic = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent orb click
    if (roomRef.current) {
      try {
        const newMutedState = !isMicMuted;
        await roomRef.current.localParticipant.setMicrophoneEnabled(!newMutedState);
        setIsMicMuted(newMutedState);
        
        // Re-setup local analyser when unmuting (track might have changed)
        if (!newMutedState) {
          // Small delay to let the track initialize
          setTimeout(() => {
            if (roomRef.current) {
              const localTracks = roomRef.current.localParticipant.audioTrackPublications;
              localTracks.forEach((pub) => {
                if (pub.track) {
                  setupLocalAudioAnalyser(pub.track);
                }
              });
            }
          }, 100);
        }
      } catch (error: any) {
        console.error("Mic toggle error:", error);
        if (error.name === 'NotAllowedError') {
          setStatus("Microphone access denied");
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0a0a0f]">
      {/* Spline 3D Background - lazy loaded */}
      <iframe
        src="https://my.spline.design/nexbotrobotcharacterconcept-QZcZ4Aa8MdtIGPDRiz3fvy6E/"
        frameBorder="0"
        loading="lazy"
        className="fixed inset-0 w-full h-full"
        style={{ zIndex: -1 }}
      />
      
      {/* Agent selector - invisible button top right */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => !isConnected && setShowAgentDropdown(!showAgentDropdown)}
          className="w-8 h-8 rounded opacity-0 hover:opacity-10 hover:bg-white transition-opacity"
          disabled={isConnected}
        />
        {showAgentDropdown && !isConnected && (
          <div className="absolute top-10 right-0 bg-black/80 border border-white/20 rounded-full overflow-hidden flex">
            {["voice-agent", "voice-agent-dev"].map((name) => (
              <button
                key={name}
                onClick={() => {
                  setAgentName(name);
                  setShowAgentDropdown(false);
                }}
                className={`px-4 py-2 text-xs whitespace-nowrap hover:bg-white/10 transition-colors ${
                  agentName === name ? "text-white bg-white/10" : "text-white/60"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      {status && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 text-white/60 text-sm z-50">
          {status}
        </div>
      )}

      {/* Mic toggle button - only show when connected */}
      {isConnected && (
        <button
          onClick={toggleMic}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 p-4 rounded-full transition-all ${
            isMicMuted 
              ? 'bg-red-500/80 hover:bg-red-500' 
              : 'bg-white/10 hover:bg-white/20'
          }`}
          title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMicMuted ? (
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          )}
        </button>
      )}

      {/* Particles canvas - above Spline but doesn't block mouse */}
      <div
        ref={containerRef}
        className="w-full h-full transition-opacity duration-1000 ease-out"
        style={{ 
          pointerEvents: 'none', 
          zIndex: 10,
          opacity: showOrb ? 1 : 0
        }}
      />
      
      {/* Clickable orb area in center */}
      <div
        onClick={handleOrbClick}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full cursor-pointer z-20"
        title={isConnected ? 'Click to disconnect' : 'Click to connect'}
      />
      
    </div>
  );
}
