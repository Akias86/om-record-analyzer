export interface PlayerState {
  ready: boolean;
  busy: boolean;
  playing: boolean;
  cycle: number;
  fraction: number;
  stepping: number;
  speed: number;
  gpu: 'initializing' | 'ready' | 'unavailable' | 'error';
  playbackMode: string;
  victoryCycle: number | null;
  loopStart: number | null;
  loopEnd: number | null;
  loopIteration: number;
  analysisStatus: string;
  readonly loopReason: string | null;
  readonly cachedCycles: number;
  readonly liveAtoms: number;
  collision: unknown | null;
  error: {code: string; message: string} | null;
}
export interface PlayerError extends Error { code: string }
export interface PlayerOptions {
  /** HTTP(S) URL or host-relative player path; the player lives at its site root (/). */
  url: string;
  onState?: (state: PlayerState) => void;
  onError?: (error: PlayerError) => void;
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
}
export interface PlayerFile { name: string; bytes: ArrayBuffer | ArrayBufferView }
export interface PlayerRecord {
  puzzle: PlayerFile;
  solution: PlayerFile;
  title?: string;
  autoplay?: boolean;
  signal?: AbortSignal;
}
export interface PlayerResult { state: PlayerState }
export interface PlayerClient {
  readonly ready: Promise<{capabilities: string[]}>;
  readonly state: PlayerState | null;
  load(record: PlayerRecord): Promise<PlayerResult>;
  play(): Promise<PlayerResult>;
  pause(): Promise<PlayerResult>;
  step(direction: -1 | 1): Promise<PlayerResult>;
  seek(cycle: number): Promise<PlayerResult>;
  setSpeed(speed: number): Promise<PlayerResult>;
  setTitle(title: string): Promise<PlayerResult>;
  getState(): Promise<PlayerResult>;
  cancel(): Promise<PlayerResult>;
  dispose(): void;
}
export function createPlayerClient(iframe: HTMLIFrameElement, options: PlayerOptions): PlayerClient;
