export type RecordId = string; // `${deviceId}:${seq}`

export interface Envelope {
  sessionId: string;
  deviceId: string;
  seq: number;
  employee: string;
  at: number;
}

export type RecordBody =
  | { type: "session-created"; name: string }
  | { type: "patron-started"; patron: string }
  | { type: "item-scanned"; visitId: RecordId; item: string }
  | { type: "patron-ended"; visitId: RecordId }
  | { type: "voided"; target: RecordId }
  | { type: "session-closed" };

export type LogRecord = Envelope & RecordBody;

export interface ItemState {
  id: RecordId;
  barcode: string;
  visitId: RecordId;
  voided: boolean;
  at: number;
  employee: string;
}

export interface VisitState {
  id: RecordId;
  patron: string;
  deviceId: string;
  employee: string;
  at: number;
  ended: boolean;
  voided: boolean;
  items: ItemState[];
}

export interface SessionState {
  sessionId: string | null;
  name: string | null;
  closed: boolean;
  /** Sorted by (at, deviceId, seq). */
  visits: VisitState[];
  /** Patron barcode to visit ids (including voided visits). */
  patronIndex: Map<string, RecordId[]>;
  /**
   * Distinct patrons with at least one non-voided visit; distinct (patron, item) pairs among
   * non-voided items in non-voided visits — the PDF's blocks and lines.
   */
  totals: { patrons: number; items: number };
  /** By employee: distinct patrons they started a non-voided visit for; non-voided items. */
  perClerk: Record<string, { patrons: number; items: number }>;
}

export type VersionVector = Record<string, number>;
