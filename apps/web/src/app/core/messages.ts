// What the match worker sends back, one message type at a time.
import type { Replay, ReplayEvent } from '../../../../../packages/sim/replay.js';
import type { BotMetadata } from '../../../../../packages/bot-catalog.js';
import type {
  GateVerdict,
  TournamentReport,
} from '../../../../../packages/tournament/exhibition.js';

export interface ProgressMessage {
  type: 'progress';
  progress: number;
  message?: string;
  completed?: number;
  total?: number;
  round?: number;
  rounds?: number;
  pairing?: BotMetadata[];
}
export interface ReplayMessage {
  type: 'replay';
  replay: Replay;
}
export interface LiveStartMessage {
  type: 'live-start';
  arenaCells: object[];
  initialFrame: number[];
  bots: Replay['bots'];
  seed: number;
  mirrored: boolean;
  player: number;
}
export interface LiveTickMessage {
  type: 'live-tick';
  tick: number;
  frame: Float32Array;
  extent: number;
  loads: number[];
  cells?: object[];
  events: ReplayEvent[];
  hashes: { tick: number; hash: string }[];
}
export interface LiveEndMessage {
  type: 'live-end';
  replay: Replay;
}
export interface LiveAbortedMessage {
  type: 'live-aborted';
}
export interface GateMessage {
  type: 'gate';
  gate: GateVerdict;
}
export interface TournamentGateMessage {
  type: 'tournament-gate';
  bot: BotMetadata;
  gate: GateVerdict;
}
export interface TournamentUpdateMessage {
  type: 'tournament-update';
  report: TournamentReport;
  replay?: Replay;
}
export interface TournamentMessage {
  type: 'tournament';
  report: TournamentReport;
}
export interface ErrorMessage {
  type: 'error';
  message: string;
}
export interface CancelledMessage {
  type: 'cancelled';
}
export type WorkerMessage =
  | ProgressMessage
  | ReplayMessage
  | LiveStartMessage
  | LiveTickMessage
  | LiveEndMessage
  | LiveAbortedMessage
  | GateMessage
  | TournamentGateMessage
  | TournamentUpdateMessage
  | TournamentMessage
  | ErrorMessage
  | CancelledMessage;
