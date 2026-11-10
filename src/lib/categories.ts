// Pure helpers for nested categories (T5-3 / D-17). Categories form a
// forest via parentId; these helpers flatten it for display (parents
// before children, siblings alphabetical) and compute descendant sets
// for product filtering. They are defensive about bad data: a row whose
// parent is absent from the set is treated as a root, and cyclic rows
// (which the domain validation prevents, but imported/legacy data could
// in theory contain) are appended as roots instead of looping forever.

export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
};

export type CategoryTreeRow<T extends CategoryNode = CategoryNode> = T & {
  depth: number;
  /** Full ancestry path, e.g. "Makanan / Makanan Ringan / Cemilan". */
  path: string;
};

export function sortCategoryTree<T extends CategoryNode>(rows: T[]): CategoryTreeRow<T>[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const row of rows) {
    if (row.parentId && byId.has(row.parentId)) {
      const siblings = children.get(row.parentId) ?? [];
      siblings.push(row);
      children.set(row.parentId, siblings);
    } else {
      roots.push(row);
    }
  }
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "id");
  roots.sort(byName);
  for (const siblings of children.values()) siblings.sort(byName);

  const out: CategoryTreeRow<T>[] = [];
  const visited = new Set<string>();
  const walk = (row: T, depth: number, parentPath: string) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    const path = parentPath ? `${parentPath} / ${row.name}` : row.name;
    out.push({ ...row, depth, path });
    for (const child of children.get(row.id) ?? []) walk(child, depth + 1, path);
  };
  for (const root of roots) walk(root, 0, "");
  // Anything unreachable from a root participates in a cycle; surface it
  // as a root rather than hiding data.
  for (const row of [...rows].sort(byName)) {
    if (!visited.has(row.id)) walk(row, 0, "");
  }
  return out;
}

/** The category itself plus every descendant id, for product filtering. */
export function descendantIds(
  rows: Pick<CategoryNode, "id" | "parentId">[],
  rootId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row.id);
    children.set(row.parentId, siblings);
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of children.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}
