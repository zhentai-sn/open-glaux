import { useMemo, useState } from "react";

import type { CollectionCount } from "../../api/atlas";
import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 图册树（SDD feats/03 v1.1 D-20 / §7.5a）：由 GET /collections 的"路径 + 直属计数"拼树，
// 子树计数前端累加；点节点 = 按前缀筛选（该图册及子图册），"全部" / "未分册" 两个固定入口。
// 树是从案例路径派生的，不需要预建目录；没有案例的图册自然不出现。

export interface CollectionNode {
  /** 显示名（本段原文） */
  name: string;
  /** 完整路径原文 */
  path: string;
  /** 归一键（casefold 路径） */
  key: string;
  /** 直属计数 */
  own: number;
  /** 含子树计数 */
  total: number;
  children: CollectionNode[];
}

/** 把 `[{collection, key, count}]` 拼成森林（根目录 "" 不进树，单独作"未分册"）。 */
export function buildCollectionTree(counts: CollectionCount[]): { roots: CollectionNode[]; unfiled: number; total: number } {
  const byKey = new Map<string, CollectionNode>();
  const roots: CollectionNode[] = [];
  let unfiled = 0;
  let total = 0;
  const ensure = (path: string, key: string): CollectionNode => {
    const hit = byKey.get(key);
    if (hit) return hit;
    const pSegs = path.split("/");
    const kSegs = key.split("/");
    const node: CollectionNode = { name: pSegs[pSegs.length - 1] ?? path, path, key, own: 0, total: 0, children: [] };
    byKey.set(key, node);
    if (kSegs.length > 1) {
      const parent = ensure(pSegs.slice(0, -1).join("/"), kSegs.slice(0, -1).join("/"));
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    return node;
  };
  for (const c of counts) {
    total += c.count;
    if (!c.key) {
      unfiled += c.count;
      continue;
    }
    ensure(c.collection, c.key).own += c.count;
  }
  const sum = (n: CollectionNode): number => {
    n.children.sort((a, b) => a.key.localeCompare(b.key));
    n.total = n.own + n.children.reduce((s, ch) => s + sum(ch), 0);
    return n.total;
  };
  roots.sort((a, b) => a.key.localeCompare(b.key)).forEach(sum);
  return { roots, unfiled, total };
}

/** 当前筛选：null = 全部；{path:"", exact:true} = 未分册；{path} = 该图册及子图册。 */
export type CollectionFilter = { path: string; exact: boolean } | null;

function Node({ node, depth, selected, onSelect }: { node: CollectionNode; depth: number; selected: string | null; onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const on = selected === node.key;
  return (
    <>
      <div className={"atlas-coll-row" + (on ? " on" : "")} style={{ paddingLeft: depth * 12 + 6 }}>
        {node.children.length ? (
          <button type="button" className="atlas-coll-tw" aria-label={open ? "collapse" : "expand"} onClick={() => setOpen((o) => !o)}>
            <Icon icon={open ? ICONS.chevronDown : ICONS.chevronRight} size="sm" />
          </button>
        ) : (
          <span className="atlas-coll-tw" aria-hidden="true">
            ·
          </span>
        )}
        <button type="button" className="atlas-coll-name" onClick={() => onSelect(node.path)} title={node.path}>
          {node.name}
          <i>{node.total}</i>
        </button>
      </div>
      {open && node.children.map((ch) => <Node key={ch.key} node={ch} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
    </>
  );
}

export function CollectionTree({
  counts,
  filter,
  onChange,
}: {
  counts: CollectionCount[];
  filter: CollectionFilter;
  onChange: (f: CollectionFilter) => void;
}) {
  const { t } = useI18n();
  const tree = useMemo(() => buildCollectionTree(counts), [counts]);
  const selectedKey = filter === null ? null : filter.exact ? "" : normalizeKey(filter.path);
  return (
    <nav className="atlas-coll" aria-label={t("atlas_collections")} data-testid="collection-tree">
      <div className={"atlas-coll-row" + (filter === null ? " on" : "")}>
        <span className="atlas-coll-tw"><Icon icon={ICONS.atlas} size="sm" /></span>
        <button type="button" className="atlas-coll-name" onClick={() => onChange(null)}>
          {t("atlas_coll_all")}
          <i>{tree.total}</i>
        </button>
      </div>
      {tree.roots.map((n) => (
        <Node key={n.key} node={n} depth={0} selected={selectedKey} onSelect={(path) => onChange({ path, exact: false })} />
      ))}
      {tree.unfiled > 0 && (
        <div className={"atlas-coll-row" + (selectedKey === "" ? " on" : "")}>
          <span className="atlas-coll-tw">·</span>
          <button type="button" className="atlas-coll-name unfiled" onClick={() => onChange({ path: "", exact: true })}>
            {t("atlas_coll_unfiled")}
            <i>{tree.unfiled}</i>
          </button>
        </div>
      )}
    </nav>
  );
}

/** 与后端 normalize_collection 一致的键（NFKC → 段 trim → 去空段 → casefold）；只用于选中态比对。 */
export function normalizeKey(path: string): string {
  return path
    .normalize("NFKC")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase())
    .join("/");
}
