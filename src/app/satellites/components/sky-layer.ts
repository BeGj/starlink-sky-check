import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform float u_pixel_ratio;
in vec3 a_pos;
in vec4 a_color;
in float a_size;
out vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  gl_PointSize = a_size * u_pixel_ratio;
  v_color = a_color;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform bool u_round;
in vec4 v_color;
out vec4 fragColor;
void main() {
  if (u_round) {
    vec2 d = gl_PointCoord - vec2(0.5);
    if (dot(d, d) > 0.25) discard;
  }
  fragColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

/** Per-vertex data: x, y, z, r, g, b, a, size. */
const STRIDE = 8;

/**
 * Draws satellites as round points (and reference rings as lines) at positions in MapLibre's mercator world
 * units, depth-tested against the terrain so ridges hide what's behind them.
 */
export class SkyLayer implements CustomLayerInterface {
  readonly id = 'sky-satellites';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MlMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private pointBuffer?: WebGLBuffer;
  private lineBuffer?: WebGLBuffer;
  private points: Float32Array = new Float32Array(0);
  private lines: Float32Array = new Float32Array(0);
  private dirty = true;
  /** The last matrix used, for projecting points to the screen (picking, labels). */
  matrix: Float64Array | Float32Array | null = null;
  /** Called after each frame, e.g. to move HTML labels. */
  onRender?: () => void;

  /** Points as x, y, z, r, g, b, a, size per satellite (NaN x hides it). */
  setPoints(points: Float32Array): void {
    this.points = points;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  /** Line strips as x, y, z, r, g, b, a, (unused) per vertex. */
  setLines(lines: Float32Array): void {
    this.lines = lines;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Sky layer shader failed');
    this.program = program;
    this.pointBuffer = gl.createBuffer();
    this.lineBuffer = gl.createBuffer();
  }

  onRemove(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.pointBuffer) gl.deleteBuffer(this.pointBuffer);
    if (this.lineBuffer) gl.deleteBuffer(this.lineBuffer);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const program = this.program;
    if (!program || !this.pointBuffer || !this.lineBuffer) return;
    const matrix = options.defaultProjectionData.mainMatrix;
    this.matrix = matrix;
    gl.useProgram(program);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, matrix as Float32Array);
    // Sizes are in CSS pixels; gl_PointSize counts device pixels.
    gl.uniform1f(gl.getUniformLocation(program, 'u_pixel_ratio'), window.devicePixelRatio || 1);
    if (this.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.points, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.lines, gl.DYNAMIC_DRAW);
      this.dirty = false;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);

    const round = gl.getUniformLocation(program, 'u_round');
    gl.uniform1i(round, 0);
    this.draw(gl, program, this.lineBuffer, gl.LINE_STRIP, this.lines.length / STRIDE);
    gl.uniform1i(round, 1);
    this.draw(gl, program, this.pointBuffer, gl.POINTS, this.points.length / STRIDE);

    gl.depthMask(true);
    this.onRender?.();
  }

  private draw(gl: WebGL2RenderingContext, program: WebGLProgram, buffer: WebGLBuffer, mode: number, count: number): void {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const bytes = STRIDE * 4;
    const pos = gl.getAttribLocation(program, 'a_pos');
    const color = gl.getAttribLocation(program, 'a_color');
    const size = gl.getAttribLocation(program, 'a_size');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 4, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(size);
    gl.vertexAttribPointer(size, 1, gl.FLOAT, false, bytes, 28);
    gl.drawArrays(mode, 0, count);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed');
  return shader;
}

/** Projects a mercator world position to CSS pixels on the map canvas, or null when it's behind the camera. */
export function projectToScreen(matrix: ArrayLike<number>, x: number, y: number, z: number, width: number, height: number): [number, number] | null {
  const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (cw <= 0) return null;
  return [((cx / cw + 1) / 2) * width, ((1 - cy / cw) / 2) * height];
}
