import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, QuadraticBezierLine, Html, useTexture } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { MISSIONS } from '../data/missions'
import { useShieldStore } from '../store/useShieldStore'

const R = 2
const BONE = '#edeae3'
const RED = '#ec1d24'

/**
 * Camera + framing, driven from outside (landing zoom).
 * z: camera distance. offset: 0..1 — how far the globe sits off-centre (1 = layout position, 0 = dead centre).
 */
export const camRig = {
  z: typeof sessionStorage !== 'undefined' && sessionStorage.getItem('shield-view') === 'console' ? 7 : 15,
  offset: 1,
}

function CameraRig() {
  useFrame(({ camera }) => {
    // keep the orbit direction the user dragged to, only change the distance
    camera.position.setLength(camRig.z)
  })
  return null
}

function toVec(lat: number, lng: number, r = R) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lng + 180) * Math.PI) / 180
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta))
}

/* ── Earth: NASA night-lights texture, city lights boosted, thin atmospheric rim ── */

const earthVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const earthFrag = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 c = texture2D(map, vUv).rgb;
    // city lights are warm (r > b) — lift them so they read like the photo
    float warm = c.r - c.b * 0.8;
    float lights = smoothstep(0.02, 0.22, warm);
    vec3 col = c * vec3(0.95, 1.1, 1.35);                      // lift the navy night side
    col += lights * vec3(1.0, 0.74, 0.4) * (0.9 + warm * 3.0);  // glowing sodium-orange cities
    // thin blue rim where the atmosphere sits
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    col += vec3(0.25, 0.5, 1.0) * fres * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`
const atmoVert = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const atmoFrag = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float i = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(0.3, 0.55, 1.0, 1.0) * i * 1.4;
  }
`

function Earth() {
  const map = useTexture('/textures/earth-night.jpg')
  const { gl } = useThree()
  useMemo(() => {
    // raw ShaderMaterial does no colour-space conversion: keep the texture's sRGB bytes as-is
    map.colorSpace = THREE.NoColorSpace
    map.anisotropy = gl.capabilities.getMaxAnisotropy()
  }, [map, gl])
  return (
    <>
      <mesh>
        <sphereGeometry args={[R, 128, 128]} />
        <shaderMaterial uniforms={{ map: { value: map } }} vertexShader={earthVert} fragmentShader={earthFrag} />
      </mesh>
      <mesh scale={1.12}>
        <sphereGeometry args={[R, 64, 64]} />
        <shaderMaterial vertexShader={atmoVert} fragmentShader={atmoFrag} side={THREE.BackSide} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </mesh>
    </>
  )
}

function Marker({ id, lat, lng, done, active, label, onSelect }: {
  id: string; lat: number; lng: number; done: boolean; active: boolean; label: string; onSelect: (id: string) => void
}) {
  const ring = useRef<THREE.Mesh>(null)
  const pos = useMemo(() => toVec(lat, lng, R * 1.004), [lat, lng])
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize()), [pos])
  const [hover, setHover] = useState(false)
  const color = done ? BONE : RED

  useFrame(({ clock }) => {
    if (!ring.current) return
    const t = (clock.getElapsedTime() * (active ? 1.2 : 0.7) + lat * 0.1) % 1
    ring.current.scale.setScalar(1 + t * 2.6)
    ;(ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9
  })

  return (
    <group position={pos} quaternion={quat}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onSelect(id) }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
        onPointerOut={() => setHover(false)}
      >
        <circleGeometry args={[0.045, 24]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      {!done && (
        <mesh ref={ring}>
          <ringGeometry args={[0.06, 0.072, 40]} />
          <meshBasicMaterial color={color} transparent side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.4, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
      {hover && (
        <Html position={[0, 0, 0.45]} center style={{ pointerEvents: 'none' }}>
          <div className="label whitespace-nowrap bg-marvel px-2 py-0.5 font-bold text-bone">{label}</div>
        </Html>
      )}
    </group>
  )
}

/** Small satellite on a tilted orbit. */
function Satellite() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime() * 0.3
    ref.current.position.set(Math.cos(t) * 3.1, Math.sin(t) * 1.0, Math.sin(t) * 3.1)
    ref.current.rotation.y = -t
  })
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.12, 0.12, 0.2]} />
        <meshBasicMaterial color={BONE} wireframe />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.27, 0, 0]}>
          <boxGeometry args={[0.36, 0.008, 0.14]} />
          <meshBasicMaterial color="#3a5a8c" />
        </mesh>
      ))}
    </group>
  )
}

/* ── Iron Man: tiny primitive-built armor flying a looping orbit with thruster trails ── */

const IM_RED = '#b3121b'
const IM_GOLD = '#e8b03a'
const IM_GLOW = '#bff3ff'
const TRAIL = 46

/** Where Iron Man is at time t — a tilted, gently bobbing figure-of-eight-ish loop. */
function flightPath(t: number, out: THREE.Vector3) {
  const a = t * 0.42
  const r = 2.75 + Math.sin(a * 3) * 0.18
  return out.set(Math.cos(a) * r, Math.sin(a * 2) * 0.55 + 0.35, Math.sin(a) * r)
}

function IronMan() {
  const body = useRef<THREE.Group>(null)
  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3))
    const fade = new Float32Array(TRAIL * 3)
    for (let i = 0; i < TRAIL; i++) {
      const k = 1 - i / TRAIL
      fade.set([0.75 * k + 0.1, 0.95 * k + 0.05, 1.0 * k + 0.1], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(fade, 3))
    return g
  }, [])
  const trailLine = useMemo(
    () => new THREE.Line(trail, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })),
    [trail],
  )
  const history = useRef<THREE.Vector3[]>([])
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Vector3(), up: new THREE.Vector3(), m: new THREE.Matrix4() }), [])
  const flame = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const g = body.current
    if (!g) return
    const t = clock.getElapsedTime()
    const p = flightPath(t, tmp.p)
    const ahead = flightPath(t + 0.08, tmp.q)
    g.position.copy(p)
    // face along velocity, head forward (superman pose), bank into the turn
    const fwd = ahead.clone().sub(p).normalize()
    const outward = p.clone().normalize()
    tmp.up.copy(outward).addScaledVector(fwd, -outward.dot(fwd)).normalize().negate()
    const right = new THREE.Vector3().crossVectors(fwd, tmp.up).normalize()
    // body +Y points along travel, chest (+Z) faces the Earth below
    tmp.m.makeBasis(right, fwd, tmp.up)
    g.quaternion.setFromRotationMatrix(tmp.m)
    // slow barrel roll so the armor shows its front and back, not just a side profile
    g.rotateY(t * 0.9)
    if (flame.current) flame.current.scale.y = 0.8 + Math.sin(t * 40) * 0.2 + Math.random() * 0.15

    // thruster trail
    const h = history.current
    h.unshift(p.clone().addScaledVector(fwd, -0.09))
    if (h.length > TRAIL) h.length = TRAIL
    const arr = trail.attributes.position.array as Float32Array
    for (let i = 0; i < TRAIL; i++) {
      const v = h[Math.min(i, h.length - 1)]
      arr[i * 3] = v.x
      arr[i * 3 + 1] = v.y
      arr[i * 3 + 2] = v.z
    }
    trail.attributes.position.needsUpdate = true
    trail.computeBoundingSphere()
  })

  const red = <meshStandardMaterial color={IM_RED} emissive={IM_RED} emissiveIntensity={0.45} metalness={0.5} roughness={0.35} />
  const gold = <meshStandardMaterial color={IM_GOLD} emissive={IM_GOLD} emissiveIntensity={0.35} metalness={0.6} roughness={0.3} />
  const glow = <meshBasicMaterial color={IM_GLOW} toneMapped={false} />

  return (
    <>
      <primitive object={trailLine} />
      <group ref={body} scale={0.14}>
        {/* torso */}
        <mesh position={[0, 0.15, 0]}>
          <boxGeometry args={[0.62, 0.8, 0.34]} />
          {red}
        </mesh>
        <mesh position={[0, -0.32, 0]}>
          <boxGeometry args={[0.5, 0.25, 0.3]} />
          {gold}
        </mesh>
        {/* arc reactor */}
        <mesh position={[0, 0.28, 0.18]}>
          <circleGeometry args={[0.1, 20]} />
          {glow}
        </mesh>
        {/* head + gold faceplate + eye slits */}
        <mesh position={[0, 0.8, 0]}>
          <boxGeometry args={[0.34, 0.4, 0.34]} />
          {red}
        </mesh>
        <mesh position={[0, 0.78, 0.175]}>
          <planeGeometry args={[0.26, 0.32]} />
          {gold}
        </mesh>
        {[-0.065, 0.065].map((x) => (
          <mesh key={x} position={[x, 0.84, 0.18]}>
            <planeGeometry args={[0.08, 0.025]} />
            {glow}
          </mesh>
        ))}
        {/* arms forward, fists leading (flight pose) */}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * 0.42, 0.75, 0]}>
              <boxGeometry args={[0.18, 0.95, 0.18]} />
              {red}
            </mesh>
            <mesh position={[s * 0.42, 1.25, 0]}>
              <boxGeometry args={[0.2, 0.18, 0.2]} />
              {gold}
            </mesh>
          </group>
        ))}
        {/* legs, boots and thrusters */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.15, 0, 0]}>
            <mesh position={[0, -0.85, 0]}>
              <boxGeometry args={[0.22, 0.9, 0.24]} />
              {red}
            </mesh>
            <mesh position={[0, -1.36, 0]}>
              <boxGeometry args={[0.24, 0.16, 0.26]} />
              {gold}
            </mesh>
          </group>
        ))}
        <group ref={flame} position={[0, -1.45, 0]}>
          {[-0.15, 0.15].map((x) => (
            <mesh key={x} position={[x, -0.3, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.09, 0.6, 12]} />
              <meshBasicMaterial color={IM_GLOW} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
    </>
  )
}

function Orbit() {
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * 3.1, Math.sin(a) * 1.0, Math.sin(a) * 3.1))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])
  return (
    <lineLoop geometry={geo}>
      <lineBasicMaterial color={BONE} transparent opacity={0.12} />
    </lineLoop>
  )
}

function Globe({ onSelect }: { onSelect: (id: string) => void }) {
  const frame = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const status = useShieldStore((s) => s.status)
  const threat = useShieldStore((s) => s.threat)
  const carrier = useMemo(() => toVec(38, -40, R * 1.55), [])
  const { viewport } = useThree()
  const wide = viewport.aspect > 1.1
  const scroll = useRef(0)
  const smooth = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const on = () => { scroll.current = window.scrollY }
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  useFrame((_, dt) => {
    if (!frame.current || !spin.current) return
    spin.current.rotation.y += dt * 0.04
    // layout position: right side on wide screens, higher on narrow; drifts as the panel slides over
    const p = Math.min(1, scroll.current / window.innerHeight)
    const far = Math.max(0, camRig.z - 7)
    const tx = (wide ? 1.9 - p * 1.9 + far * 0.3 : 0) * camRig.offset
    const ty = (p * 1.2 + (wide ? 0 : 0.9 + far * 0.32)) * camRig.offset
    if (!smooth.current) smooth.current = { x: tx, y: ty }
    // exponential follow so scroll/zoom never jitter
    const k = 1 - Math.exp(-dt * 8)
    smooth.current.x += (tx - smooth.current.x) * k
    smooth.current.y += (ty - smooth.current.y) * k
    frame.current.position.set(smooth.current.x, smooth.current.y, 0)
  })

  return (
    <group ref={frame} scale={wide ? 1 : 0.8}>
      <group rotation={[0.3, 0, 0.08]}>
        <group ref={spin} rotation={[0, -1.4, 0]}>
          <Earth />
          {MISSIONS.map((m) => (
            <Marker
              key={m.id}
              id={m.id}
              lat={m.lat}
              lng={m.lng}
              label={`${m.codename} / ${threat[m.id] ?? m.threat}`}
              done={status[m.id] === 'Completed'}
              active={status[m.id] === 'In Progress'}
              onSelect={onSelect}
            />
          ))}
          {MISSIONS.filter((m) => status[m.id] === 'In Progress').map((m) => {
            const end = toVec(m.lat, m.lng, R * 1.01)
            const mid = carrier.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(R * 1.7)
            return <QuadraticBezierLine key={m.id} start={carrier} end={end} mid={mid} color={RED} lineWidth={1.5} dashed dashScale={24} />
          })}
          <mesh position={carrier}>
            <octahedronGeometry args={[0.07]} />
            <meshBasicMaterial color={BONE} wireframe />
          </mesh>
        </group>
        <Orbit />
        <Satellite />
        <IronMan />
      </group>
    </group>
  )
}

function Stars() {
  const geo = useMemo(() => {
    const n = 1500
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40)
      arr.set([v.x, v.y, v.z], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.12} color={BONE} transparent opacity={0.55} sizeAttenuation />
    </points>
  )
}

export default function ThreatGlobe() {
  const setFocus = useShieldStore((s) => s.setFocusMission)
  const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
  const select = (id: string) => {
    setFocus(id)
    const lenis = (window as unknown as { __lenis?: { scrollTo: (t: string, o?: object) => void } }).__lenis
    if (lenis) lenis.scrollTo('#missions', { offset: -64, duration: 1.4 })
    else document.getElementById('missions')?.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <Canvas
      camera={{ position: [0, 0, camRig.z], fov: 45, near: 0.05, far: 300 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ pointerEvents: canHover ? 'auto' : 'none' }}
      data-cursor="Drag to rotate"
    >
      <CameraRig />
      <ambientLight intensity={0.6} />
      <directionalLight position={[-5, 3, 6]} intensity={2.2} />
      <Stars />
      <Globe onSelect={select} />
      <OrbitControls enableZoom={false} enablePan={false} enableRotate={canHover} rotateSpeed={0.4} enableDamping dampingFactor={0.08} />
    </Canvas>
  )
}
