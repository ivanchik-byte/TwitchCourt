namespace Backdrop {
  const COUNT = 200;
  const SPREAD = 10;
  const SPEED = 0.1;
  const BASE_SIZE = 100;
  const CAMERA_DISTANCE = 20;

  const VERTEX = `
    attribute vec3 position;
    attribute vec4 random;
    attribute vec3 color;

    uniform mat4 modelMatrix;
    uniform mat4 viewMatrix;
    uniform mat4 projectionMatrix;
    uniform float uTime;
    uniform float uSpread;
    uniform float uBaseSize;
    uniform float uSizeRandomness;

    varying vec4 vRandom;
    varying vec3 vColor;

    void main() {
      vRandom = random;
      vColor = color;

      vec3 pos = position * uSpread;
      pos.z *= 10.0;

      vec4 mPos = modelMatrix * vec4(pos, 1.0);
      float t = uTime;
      mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
      mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
      mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

      vec4 mvPos = viewMatrix * mPos;

      if (uSizeRandomness == 0.0) {
        gl_PointSize = uBaseSize;
      } else {
        gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
      }

      gl_Position = projectionMatrix * mvPos;
    }
  `;

  const FRAGMENT = `
    precision highp float;

    uniform float uTime;
    uniform float uAlphaParticles;
    varying vec4 vRandom;
    varying vec3 vColor;

    void main() {
      vec2 uv = gl_PointCoord.xy;
      float d = length(uv - vec2(0.5));

      if (uAlphaParticles < 0.5) {
        if (d > 0.5) {
          discard;
        }
        gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
      } else {
        float circle = smoothstep(0.5, 0.4, d) * 0.8;
        gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
      }
    }
  `;

  function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }

  function multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[row] * b[col * 4] +
          a[4 + row] * b[col * 4 + 1] +
          a[8 + row] * b[col * 4 + 2] +
          a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function rotationX(angle: number): Float32Array {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }

  function rotationY(angle: number): Float32Array {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function rotationZ(angle: number): Float32Array {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function translation(x: number, y: number, z: number): Float32Array {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  }

  function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("no shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error("shader: " + gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  export function mount(canvas: HTMLCanvasElement): void {
    const maybe = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!maybe) return;
    const gl: WebGLRenderingContext = maybe;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener("resize", resize);
    resize();

    const positions = new Float32Array(COUNT * 3);
    const randoms = new Float32Array(COUNT * 4);
    const colors = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      let len = 0;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        len = x * x + y * y + z * z;
      } while (len > 1 || len === 0);
      const r = Math.cbrt(Math.random());
      positions.set([x * r, y * r, z * r], i * 3);
      randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      colors.set([1, 1, 1], i * 3);
    }

    const bindAttribute = (name: string, size: number, data: Float32Array) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bindAttribute("position", 3, positions);
    bindAttribute("random", 4, randoms);
    bindAttribute("color", 3, colors);

    const uniform = (name: string): WebGLUniformLocation | null =>
      gl.getUniformLocation(program, name);
    const uModel = uniform("modelMatrix");
    const uView = uniform("viewMatrix");
    const uProj = uniform("projectionMatrix");
    const uTime = uniform("uTime");
    const uSpread = uniform("uSpread");
    const uBaseSize = uniform("uBaseSize");
    const uSizeRandomness = uniform("uSizeRandomness");
    const uAlpha = uniform("uAlphaParticles");

    gl.uniform1f(uSpread, SPREAD);
    gl.uniform1f(uBaseSize, BASE_SIZE * dpr);
    gl.uniform1f(uSizeRandomness, 1);
    gl.uniform1f(uAlpha, 0);

    const mouse = { x: 0, y: 0 };
    window.addEventListener("mousemove", (event) => {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -((event.clientY / window.innerHeight) * 2 - 1);
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0x03 / 255, 0x04 / 255, 0x07 / 255, 1);

    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;
    let last = performance.now();
    let elapsed = 0;
    let rotZ = 0;

    function frame(now: number): void {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const delta = now - last;
      last = now;
      elapsed += delta * SPEED;

      const aspect = canvas.width / canvas.height;
      gl.uniformMatrix4fv(uProj, false, perspective(15, aspect, 0.1, 100));
      gl.uniformMatrix4fv(uView, false, translation(0, 0, -CAMERA_DISTANCE));

      const rx = Math.sin(elapsed * 0.0002) * 0.1;
      const ry = Math.cos(elapsed * 0.0005) * 0.15;
      rotZ += 0.01 * SPEED;
      let model = multiply(rotationZ(rotZ), rotationY(ry));
      model = multiply(model, rotationX(rx));
      model[12] = -mouse.x;
      model[13] = -mouse.y;
      gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform1f(uTime, elapsed * 0.001);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, COUNT);
    }

    function renderOnce(): void {
      const aspect = canvas.width / canvas.height;
      gl.uniformMatrix4fv(uProj, false, perspective(15, aspect, 0.1, 100));
      gl.uniformMatrix4fv(uView, false, translation(0, 0, -CAMERA_DISTANCE));
      gl.uniformMatrix4fv(
        uModel,
        false,
        multiply(multiply(rotationZ(0), rotationY(0.15)), rotationX(0))
      );
      gl.uniform1f(uTime, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, COUNT);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (animate && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });

    if (animate) {
      raf = requestAnimationFrame(frame);
    } else {
      renderOnce();
    }
  }
}
