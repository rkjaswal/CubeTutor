import type { ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';

type GlExtras = ExpoWebGLRenderingContext & {
  canvas?: HTMLCanvasElement;
};

export function createGlRenderer(gl: ExpoWebGLRenderingContext): THREE.WebGLRenderer {
  const width = gl.drawingBufferWidth || 1;
  const height = gl.drawingBufferHeight || 1;
  const glExtras = gl as GlExtras;
  const browserContext =
    typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  const canvas =
    glExtras.canvas ??
    ({
      width,
      height,
      clientWidth: width,
      clientHeight: height,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      getContext: () => gl,
    } as unknown as HTMLCanvasElement);

  if (!glExtras.canvas) glExtras.canvas = canvas;

  if (!browserContext) {
    const pixelStorei = gl.pixelStorei.bind(gl);
    gl.pixelStorei = ((pname: number, param: number | boolean) => {
      if (pname !== gl.UNPACK_FLIP_Y_WEBGL && pname !== gl.UNPACK_ALIGNMENT) return;
      pixelStorei(pname, param as number);
    }) as typeof gl.pixelStorei;
  }

  const renderer = createThreeRenderer(gl, canvas);
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x08090d, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function createThreeRenderer(gl: ExpoWebGLRenderingContext, canvas: HTMLCanvasElement) {
  const parameters: THREE.WebGLRendererParameters = {
    canvas,
    context: gl as unknown as WebGL2RenderingContext,
    antialias: true,
    alpha: false,
  };

  // expo-gl 56.0.5 through 58.0.3 puts WebGLRenderingContext on the prototype
  // chain of a WebGL 2 context. Browsers do not. three.js r163+ treats that
  // inheritance as WebGL 1 and throws. Hide the constructor for this one check.
  const isWebGL2 =
    typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const reportedAsWebGL1 =
    typeof WebGLRenderingContext !== 'undefined' && gl instanceof WebGLRenderingContext;
  if (!isWebGL2 || !reportedAsWebGL1) return new THREE.WebGLRenderer(parameters);

  const scope = globalThis as { WebGLRenderingContext?: typeof WebGLRenderingContext };
  const saved = scope.WebGLRenderingContext;
  scope.WebGLRenderingContext = undefined;
  try {
    return new THREE.WebGLRenderer(parameters);
  } finally {
    scope.WebGLRenderingContext = saved;
  }
}
