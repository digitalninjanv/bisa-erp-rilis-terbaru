export type PosSyncEventKind = "open" | "movement" | "sale" | "close";

export type PosSyncEvent<T> = {
  kind: PosSyncEventKind;
  occurredAt: string;
  order: number;
  value: T;
};

const TIE_PRIORITY: Record<PosSyncEventKind, number> = {
  open: 0,
  movement: 1,
  sale: 2,
  close: 3,
};

/**
 * Preserve the device's event order while making the session lifecycle
 * safe when multiple intents arrive in one sync request. Opening must
 * precede activity, and closing must follow it, including equal timestamps.
 */
export function orderPosSyncEvents<T>(events: PosSyncEvent<T>[]): PosSyncEvent<T>[] {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    const timeOrder =
      (Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY) -
      (Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY);
    return timeOrder || TIE_PRIORITY[left.kind] - TIE_PRIORITY[right.kind] || left.order - right.order;
  });
}
