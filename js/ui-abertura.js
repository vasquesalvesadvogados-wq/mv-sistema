/* ============================================================
   ABERTURA — tela de entrada do sistema (v6.8)

   Duas etapas dentro do #auth-gate:
     1. "abertura" — seda em grafite (WebGL) + a marca se montando + "Entrar no sistema"
     2. "form"     — o mesmo fundo, a marca sobe e o cartão de login entra

   Este arquivo NÃO mexe na autenticação. O cloud.js continua dono do gate
   (mostra, esconde, erros, redefinição de senha). Aqui só se observa:
     · #auth-gate ficou visível  → liga a seda
     · #auth-gate foi escondido  → desliga e libera a GPU (o app roda horas depois)
     · apareceu erro ou a tela de nova senha → pula direto para o formulário

   Exceção documentada ao Design System (DESIGN.md §7): esta é a ÚNICA
   superfície do sistema com gradiente. Só aqui, só em grafite e aço.
   ============================================================

   O shader abaixo é um porte do componente "Animated Gradient" do Spell UI
   (https://spell.sh), sem React/TypeScript/next-themes. Licença original:

   MIT License

   Copyright (c) 2025 Spell UI

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
   ============================================================ */

const Abertura = (function () {
  'use strict';

  /* As cores da seda saem dos tokens --abertura-seda-1..3 (css/tokens.css: grafite-950,
     grafite-600, aço-400), lidas em iniciarGL(); aqui não há cor nenhuma.
     Os parâmetros são os que foram aprovados no protótipo C. */
  const SEDA = {
    rotation: -50, proportion: .30, scale: .10, speed: 18, distortion: .04,
    swirl: .8, swirlIterations: 10, softness: 1.0, shape: 0, shapeScale: .30
  };

  /* Meia resolução: a seda é macia, a diferença não aparece e a GPU faz 1/4 do trabalho. */
  const ESCALA_RENDER = 0.5;

  const VS = `#version 300 es
in vec4 a_position;
void main(){ gl_Position = a_position; }`;

  const FS = `#version 300 es
precision highp float;
uniform float u_time; uniform float u_pixelRatio; uniform vec2 u_resolution;
uniform float u_scale; uniform float u_rotation;
uniform vec4 u_color1; uniform vec4 u_color2; uniform vec4 u_color3;
uniform float u_proportion; uniform float u_softness; uniform float u_shape;
uniform float u_shapeScale; uniform float u_distortion; uniform float u_swirl;
uniform float u_swirlIterations;
out vec4 fragColor;
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846
vec2 rotate(vec2 uv, float th){ return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float random(vec2 st){ return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
float noise(vec2 st){
  vec2 i = floor(st); vec2 f = fract(st);
  float a = random(i), b = random(i+vec2(1.,0.)), c = random(i+vec2(0.,1.)), d = random(i+vec2(1.,1.));
  vec2 u = f*f*(3.-2.*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
vec4 blend_colors(vec4 c1, vec4 c2, vec4 c3, float mixer, float edgesWidth, float edge_blur){
  vec3 color1 = c1.rgb*c1.a, color2 = c2.rgb*c2.a, color3 = c3.rgb*c3.a;
  float r1 = smoothstep(.0+.35*edgesWidth, .7-.35*edgesWidth+.5*edge_blur, mixer);
  float r2 = smoothstep(.3+.35*edgesWidth, 1.-.35*edgesWidth+edge_blur, mixer);
  vec3 b2 = mix(color1,color2,r1); float o2 = mix(c1.a,c2.a,r1);
  return vec4(mix(b2,color3,r2), mix(o2,c3.a,r2));
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = .5 * u_time;
  float noise_scale = .0005 + .006 * u_scale;
  uv -= .5; uv *= (noise_scale * u_resolution); uv = rotate(uv, u_rotation*.5*PI);
  uv /= u_pixelRatio; uv += .5;
  float n1 = noise(uv*1.+t), n2 = noise(uv*2.-t);
  float angle = n1*TWO_PI;
  uv.x += 4.*u_distortion*n2*cos(angle);
  uv.y += 4.*u_distortion*n2*sin(angle);
  float it = ceil(clamp(u_swirlIterations,1.,30.));
  for(float i=1.; i<=it; i++){
    uv.x += clamp(u_swirl,0.,2.)/i * cos(t + i*1.5*uv.y);
    uv.y += clamp(u_swirl,0.,2.)/i * cos(t + i*1.*uv.x);
  }
  float proportion = clamp(u_proportion,0.,1.);
  float shape=0., mixer=0.;
  if(u_shape < .5){
    vec2 c = uv*(.5+3.5*u_shapeScale);
    shape = .5+.5*sin(c.x)*cos(c.y);
    mixer = shape + .48*sign(proportion-.5)*pow(abs(proportion-.5),.5);
  } else if(u_shape < 1.5){
    vec2 s = uv*(.25+3.*u_shapeScale);
    float f = fract(s.y);
    shape = smoothstep(.0,.55,f)*smoothstep(1.,.45,f);
    mixer = shape + .48*sign(proportion-.5)*pow(abs(proportion-.5),.5);
  } else {
    float sh = 1.-uv.y; sh -= .5; sh /= (noise_scale*u_resolution.y); sh += .5;
    float ss = .2*(1.-u_shapeScale);
    shape = smoothstep(.45-ss, .55+ss, sh + .3*(proportion-.5));
    mixer = shape;
  }
  vec4 cm = blend_colors(u_color1,u_color2,u_color3, mixer, 1.-clamp(u_softness,0.,1.), .01+.01*u_scale);
  fragColor = vec4(cm.rgb, cm.a);
}`;

  const semMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let gate, palco, canvas, gl = null, U = {}, raf = 0, t0 = 0;
  let aberto = false, abertoEm = 0, etapa = 'abertura';

  /* ---------------- WebGL ---------------- */

  function hexParaVec4(h) {
    const n = parseInt(h.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }

  function compilar(tipo, fonte) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fonte);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function iniciarGL() {
    try {
      // cores da seda: só dos tokens; sem hex válido, fica o caminho sem WebGL (nenhuma cor de reserva aqui)
      const css = getComputedStyle(document.documentElement);
      const cores = [1, 2, 3].map(n => css.getPropertyValue('--abertura-seda-' + n).trim());
      if (cores.some(c => !/^#[0-9a-f]{6}$/i.test(c))) return false;

      gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
      if (!gl || gl.isContextLost()) { gl = null; return false; }

      const prog = gl.createProgram();
      gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      ['u_time', 'u_resolution', 'u_pixelRatio', 'u_scale', 'u_rotation', 'u_color1', 'u_color2', 'u_color3',
       'u_proportion', 'u_softness', 'u_shape', 'u_shapeScale', 'u_distortion', 'u_swirl', 'u_swirlIterations']
        .forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

      gl.uniform4fv(U.u_color1, hexParaVec4(cores[0]));
      gl.uniform4fv(U.u_color2, hexParaVec4(cores[1]));
      gl.uniform4fv(U.u_color3, hexParaVec4(cores[2]));
      gl.uniform1f(U.u_rotation, SEDA.rotation / 90);
      gl.uniform1f(U.u_proportion, SEDA.proportion);
      gl.uniform1f(U.u_scale, SEDA.scale);
      gl.uniform1f(U.u_distortion, SEDA.distortion);
      gl.uniform1f(U.u_swirl, SEDA.swirl);
      gl.uniform1f(U.u_swirlIterations, SEDA.swirlIterations);
      gl.uniform1f(U.u_softness, SEDA.softness);
      gl.uniform1f(U.u_shape, SEDA.shape);
      gl.uniform1f(U.u_shapeScale, SEDA.shapeScale);
      return true;
    } catch (e) {
      console.warn('[Abertura] WebGL indisponível, usando o fundo estático:', e.message);
      gl = null;
      return false;
    }
  }

  function medir() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * ESCALA_RENDER));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * ESCALA_RENDER));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.u_resolution, w, h);
    gl.uniform1f(U.u_pixelRatio, dpr * ESCALA_RENDER); // mantém a escala do desenho em px de CSS
  }

  function desenhar(agora) {
    gl.uniform1f(U.u_time, ((agora - t0) / 1000) * (SEDA.speed / 100));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function quadro(agora) {
    if (!gl || !aberto) return;
    desenhar(agora);
    raf = requestAnimationFrame(quadro);
  }

  function ligar() {
    if (!gl && !iniciarGL()) { gate.classList.remove('com-seda'); return; } // fica o grafismo de hoje
    gate.classList.add('com-seda');
    t0 = performance.now();
    medir();
    if (semMovimento) { desenhar(t0); return; } // um quadro parado
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(quadro);
  }

  function desligar() {
    cancelAnimationFrame(raf);
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      gl = null;
      // canvas novo: um contexto perdido não volta, e o gate pode reabrir na mesma sessão
      const novo = canvas.cloneNode(false);
      canvas.replaceWith(novo);
      canvas = novo;
    }
  }

  /* ---------------- etapas ---------------- */

  function irParaForm() {
    if (etapa === 'form') return;
    const marca = palco.querySelector('.abertura-marca');
    const antes = marca.getBoundingClientRect();
    // chegou direto (erro ao abrir, link de nova senha): o cartão espera a marca montar
    const direto = performance.now() - abertoEm < 200;
    palco.classList.toggle('direto', direto);
    palco.dataset.etapa = etapa = 'form';

    if (!direto && !semMovimento) {
      const depois = marca.getBoundingClientRect();
      marca.animate([
        { transform: `translateY(${antes.top - depois.top}px) scale(${antes.width / depois.width})` },
        { transform: 'none' }
      ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    }

    setTimeout(() => {
      const email = document.getElementById('auth-email');
      const senha = document.getElementById('auth-senha');
      if (!email || !senha) return; // tela de nova senha: o cloud.js cuida do foco
      (email.value ? senha : email).focus();
    }, direto ? 900 : 120);
  }

  function verificar() {
    const visivel = !gate.hidden;
    if (visivel && !aberto) {
      aberto = true;
      abertoEm = performance.now();
      ligar();
      setTimeout(() => { if (etapa === 'abertura') palco.querySelector('.abertura-entrar').focus({ preventScroll: true }); },
        semMovimento ? 0 : 1300);
    } else if (!visivel && aberto) {
      aberto = false;
      desligar();
    }
    if (!visivel) return;
    const erro = document.getElementById('auth-error');
    const temErro = erro && !erro.hidden && erro.textContent.trim();
    if (temErro || document.getElementById('ns-senha')) irParaForm();
  }

  function init() {
    gate = document.getElementById('auth-gate');
    palco = gate && gate.querySelector('.abertura');
    canvas = gate && gate.querySelector('.abertura-seda');
    if (!gate || !palco || !canvas) return;

    palco.querySelector('.abertura-entrar').addEventListener('click', irParaForm);

    new MutationObserver(verificar).observe(gate, {
      attributes: true, attributeFilter: ['hidden'], subtree: true, childList: true
    });

    window.addEventListener('resize', () => { if (aberto) medir(); });

    // aba em segundo plano: para de desenhar; voltou, retoma
    document.addEventListener('visibilitychange', () => {
      if (!aberto || !gl || semMovimento) return;
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(quadro);
    });

    verificar(); // o gate pode já estar aberto quando este script roda
  }

  return { init, irParaForm };
})();

Abertura.init();
