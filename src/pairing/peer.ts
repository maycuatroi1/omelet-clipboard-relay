export interface Peer {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}
