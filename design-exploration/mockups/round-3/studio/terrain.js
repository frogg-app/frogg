/* Ported verbatim from frogg-app/website src/scripts/facets.ts (low-poly WebGL2 terrain). */
var Terrain = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if ((from && typeof from === "object") || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, {
            get: () => from[key],
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
          });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var facets_exports = {};
  __export(facets_exports, {
    mountFacets: () => mountFacets,
  });
  const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
uniform float uTime;
uniform vec2 uPointer;
uniform float uLift;
uniform mat4 uProj;
out vec3 vWorld;
out float vHeight;

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;vec3 h=abs(x)-.5;vec3 ox=floor(x+.5);vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}

void main(){
  vec2 p=aPos;
  float n=snoise(p*.18+vec2(uTime*.05,uTime*.03))*1.1
         +snoise(p*.45-vec2(uTime*.04,0.))*.35;
  float d=distance(p,uPointer);
  float bump=exp(-d*d*.08)*uLift;
  float z=n+bump;
  vHeight=z;
  vWorld=vec3(p.x,z,p.y);
  gl_Position=uProj*vec4(vWorld,1.);
}`;
  const FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
in float vHeight;
uniform vec3 uFog;
out vec4 outColor;
void main(){
  vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  if(N.y<0.)N=-N;
  vec3 L=normalize(vec3(-.4,.8,.5));
  float diff=clamp(dot(N,L),0.,1.);
  vec3 deep=vec3(.016,.357,.616);   // #045b9d
  vec3 cyan=vec3(.145,.71,.784);    // #25b5c8
  vec3 mint=vec3(.247,.812,.557);   // #3fcf8e
  vec3 base=mix(deep,cyan,smoothstep(-.8,1.4,vHeight+diff*.6));
  base=mix(base,mint,smoothstep(1.3,2.4,vHeight)*.5);
  vec3 col=base*(.25+diff*.95);
  float spec=pow(max(dot(reflect(-L,N),vec3(0.,.6,.8)),0.),24.);
  col+=spec*.35;
  float depth=clamp((-vWorld.z+6.)/30.,0.,1.);
  col=mix(col,uFog,smoothstep(.15,1.,depth));
  outColor=vec4(col,1.);
}`;
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  }
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2),
      nf = 1 / (near - far);
    return [
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) * nf,
      -1,
      0,
      0,
      2 * far * near * nf,
      0,
    ];
  }
  function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function view(pitch, y, z) {
    const c = Math.cos(pitch),
      s = Math.sin(pitch);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, -y * c + z * s, -y * s - z * c, 1];
  }
  function mesh(cols, rows, w, d) {
    const pts = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const edge = i === 0 || j === 0 || i === cols || j === rows;
        pts.push([
          (i / cols - 0.5) * w + (edge ? 0 : rnd() * (w / cols) * 0.7),
          -(j / rows) * d + 4 + (edge ? 0 : rnd() * (d / rows) * 0.7),
        ]);
      }
    const out = [];
    const at = (i, j) => pts[j * (cols + 1) + i];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = at(i, j),
          b = at(i + 1, j),
          c = at(i, j + 1),
          e = at(i + 1, j + 1);
        if ((i + j) % 2) out.push(...a, ...b, ...e, ...a, ...e, ...c);
        else out.push(...a, ...b, ...c, ...b, ...e, ...c);
      }
    return new Float32Array(out);
  }
  function mountFacets(canvas) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const small = innerWidth < 720;
    const verts = mesh(small ? 26 : 44, small ? 22 : 34, 44, 36);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = (n) => gl.getUniformLocation(prog, n);
    const uTime = u("uTime"),
      uPointer = u("uPointer"),
      uLift = u("uLift"),
      uProj = u("uProj");
    gl.uniform3f(u("uFog"), 0.031, 0.043, 0.051);
    gl.enable(gl.DEPTH_TEST);
    let proj = [];
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      proj = mul(perspective(0.9, canvas.width / canvas.height, 0.1, 80), view(0.42, 6.5, 9));
    };
    resize();
    addEventListener("resize", resize);
    const target = { x: 0, z: -4, lift: 0 };
    const cur = { x: 0, z: -4, lift: 0 };
    addEventListener(
      "pointermove",
      (e) => {
        const r = canvas.getBoundingClientRect();
        if (e.clientY > r.bottom) {
          target.lift = 0;
          return;
        }
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
        const depth = 9 + (1 - ny) * 2 + Math.max(0, ny) * 22;
        target.x = nx * depth * 0.62;
        target.z = 9 - depth;
        target.lift = 1.8;
      },
      { passive: true },
    );
    let visible = true;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
    const start = performance.now();
    const frame = (now) => {
      if (visible) {
        for (const k of ["x", "z", "lift"]) cur[k] += (target[k] - cur[k]) * 0.06;
        gl.clearColor(0.031, 0.043, 0.051, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(uTime, reduce ? 0 : (now - start) / 1e3);
        gl.uniform2f(uPointer, cur.x, cur.z);
        gl.uniform1f(uLift, cur.lift);
        gl.uniformMatrix4fv(uProj, false, proj);
        gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
      }
      if (!reduce) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    canvas.classList.add("is-live");
  }
  return __toCommonJS(facets_exports);
})();
