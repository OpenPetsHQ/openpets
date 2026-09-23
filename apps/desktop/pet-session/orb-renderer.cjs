// Session overlay orb: the WebGL night-sky sphere drawn behind the pet.
// Pure presentation — the session shell feeds it the breath value, tint,
// energy, and phase-change pulse every frame.

function createOrbRenderer(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) {
    // Graceful fallback: a layered radial gradient still reads as an orb.
    canvas.style.background = "radial-gradient(circle at 50% 42%, rgba(120,170,255,0.55), rgba(48,90,190,0.34) 42%, rgba(20,40,90,0.18) 58%, transparent 68%)";
    canvas.style.borderRadius = "50%";
    return null;
  }

  const vertexSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_radius;
    uniform float u_time;
    uniform float u_breath;
    uniform float u_energy;
    uniform float u_pulse;
    uniform vec3 u_tint;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.55;
      for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p = p * 2.03 + vec2(17.7, 9.2);
        amplitude *= 0.5;
      }
      return value;
    }

    vec2 rotate(vec2 p, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    void main() {
      vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_radius;
      p.y = -p.y;
      float breathScale = 0.84 + 0.13 * u_breath;
      float d = length(p) / breathScale;

      // Saturated galaxy palette: indigo base + violet nebula accent.
      // No near-black bases — dark desaturated colors read as gray fog
      // once composited at partial alpha over light desktops.
      vec3 deep = vec3(0.10, 0.16, 0.46);
      vec3 nebulaViolet = vec3(0.54, 0.32, 0.95);
      vec3 tint = u_tint;
      vec3 color = vec3(0.0);
      float alpha = 0.0;

      if (d < 1.0) {
        float z = sqrt(max(0.0, 1.0 - d * d));
        vec3 n = vec3(p / breathScale, z);

        // The galaxy's own night sky: a near-opaque deep-space disc fitted
        // exactly to the sphere (it breathes with it), so the nebula reads
        // the same on light and dark desktops.
        float discMask = smoothstep(1.0, 0.975, d);
        vec3 space = vec3(0.014, 0.028, 0.082);

        // Volumetric wisps: two drifting fbm layers, weighted toward depth.
        vec2 q = rotate(p, u_time * 0.05) * 1.9;
        float w1 = fbm(q + vec2(0.0, -u_time * 0.09));
        float w2 = fbm(rotate(p, -u_time * 0.03) * 3.1 + vec2(u_time * 0.05, 0.0));
        float wisps = (w1 * 0.72 + w2 * 0.45) * (0.35 + 0.65 * z);
        // Only the bright filaments render — the space between strands stays
        // fully transparent so the orb never fogs the desktop behind it.
        float strands = max(0.0, wisps - 0.42) * 1.9;

        // A compact luminous heart that swells with the breath.
        float core = exp(-d * d * 4.5) * (0.22 + 0.5 * u_breath);

        // Rim light (fresnel) sells the sphere.
        float fresnel = pow(1.0 - z, 2.4);

        // Soft glint from the top-left (p is y-down here).
        vec3 lightDir = normalize(vec3(-0.42, -0.58, 0.72));
        float spec = pow(max(dot(n, lightDir), 0.0), 34.0) * 0.7;

        // Sparse round motes drifting inside the volume.
        vec2 moteCoord = rotate(p, u_time * 0.02) * 7.0 + vec2(0.0, u_time * 0.12);
        vec2 moteCell = floor(moteCoord);
        vec2 moteLocal = fract(moteCoord) - 0.5;
        vec2 moteOffset = vec2(hash(moteCell) - 0.5, hash(moteCell + 19.7) - 0.5) * 0.6;
        float moteDist = length(moteLocal - moteOffset);
        float mote = smoothstep(0.11, 0.02, moteDist) * step(0.78, hash(moteCell + 7.3)) * z;
        float twinkle = mote * (0.30 + 0.70 * (0.5 + 0.5 * sin(u_time * 1.7 + hash(moteCell.yx) * 6.283)));

        // Broad colored galaxy volume: saturated, so it tints white
        // desktops instead of graying them (compositing is single-alpha).
        float bodyGlow = (0.30 + 0.38 * wisps) * z;

        vec3 body = mix(deep, tint, clamp(0.28 + 0.55 * wisps, 0.0, 1.0));
        body = mix(body, nebulaViolet, clamp(w2 * 0.65, 0.0, 0.65));
        color = space * discMask
          + body * (core * 1.5 + strands * 1.1 + bodyGlow)
          + tint * fresnel * 0.95
          + vec3(0.80, 0.88, 1.0) * spec * 0.5
          + vec3(0.85, 0.93, 1.0) * twinkle * 0.55;
        alpha = clamp(core * 1.2 + strands * 0.6 + bodyGlow * 0.85 + fresnel * 0.9 + spec * 0.5 + twinkle * 0.55, 0.0, 1.0);
        alpha = max(alpha, discMask * 0.96);
      }

      // Halo + crisp rim band. The halo is windowed to a hard outer edge so
      // the canvas never veils the desktop beyond the glow.
      float rim = exp(-abs(d - 1.0) * 26.0);
      float haloWindow = 1.0 - smoothstep(1.02, 1.42, d);
      float halo = d >= 1.0 ? exp(-(d - 1.0) * 4.2) * 0.28 * haloWindow : 0.0;
      color += tint * (rim * 0.85 + halo);
      alpha = clamp(alpha + rim * 0.75 + halo, 0.0, 1.0);

      // Expanding ripple on phase change: icy phase-tinted light.
      float pulseAge = u_time - u_pulse;
      if (pulseAge >= 0.0 && pulseAge < 1.6) {
        float rippleRadius = 1.0 + pulseAge * 0.30;
        float rippleFade = (1.0 - pulseAge / 1.6);
        float ripple = exp(-abs(d - rippleRadius) * 34.0) * rippleFade * rippleFade * 0.7;
        vec3 rippleColor = mix(tint, vec3(0.85, 0.93, 1.0), 0.35);
        color += rippleColor * ripple;
        alpha = clamp(alpha + ripple, 0.0, 1.0);
      }

      alpha *= u_energy;
      // Hard floor: fully transparent outside the visible glow.
      if (alpha < 0.006) alpha = 0.0;
      // Premultiplied output: color already carries the light energy — do
      // NOT multiply by alpha again, or every semi-transparent pixel
      // composites darker than its true color (black-fringed glows).
      gl_FragColor = vec4(min(color * u_energy, vec3(1.0)), alpha);
    }
  `;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Session orb shader failed to compile.", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Session orb shader failed to link.", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  return {
    gl,
    uniforms: {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      radius: gl.getUniformLocation(program, "u_radius"),
      time: gl.getUniformLocation(program, "u_time"),
      breath: gl.getUniformLocation(program, "u_breath"),
      energy: gl.getUniformLocation(program, "u_energy"),
      pulse: gl.getUniformLocation(program, "u_pulse"),
      tint: gl.getUniformLocation(program, "u_tint"),
    },
  };
}

/**
 * Wrap the orb canvas. `draw` resizes the backing store to the CSS size at
 * the current device pixel ratio and paints one frame; without WebGL the
 * canvas keeps a static gradient fallback and `draw` is a no-op.
 */
function createSessionOrb(canvas) {
  const renderer = createOrbRenderer(canvas);

  const resizeCanvas = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (renderer) renderer.gl.viewport(0, 0, canvas.width, canvas.height);
    }
    return dpr;
  };

  const draw = (frame) => {
    if (!renderer) return;
    const dpr = resizeCanvas();
    const { gl, uniforms } = renderer;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.radius, frame.radius * dpr);
    gl.uniform1f(uniforms.time, frame.time);
    gl.uniform1f(uniforms.breath, frame.breath);
    gl.uniform1f(uniforms.energy, frame.energy);
    gl.uniform1f(uniforms.pulse, frame.pulse);
    gl.uniform3f(uniforms.tint, frame.tint[0], frame.tint[1], frame.tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return { draw };
}

module.exports = { createSessionOrb };
