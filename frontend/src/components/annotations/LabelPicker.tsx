import { useEffect, useMemo, useRef, useState } from "react";

import type { Label } from "../../api/types";
import { useI18n } from "../../i18n";
import { useLabels, type LabelRequest } from "../../store/labels";

// 标签弹层（SDD 23 §4.1、§7.2）：搜索、选择或新建；可纯键盘完成（↑↓ 选择、回车确认、Esc 取消）。
// 由 useLabels.requestLabel 打开，绘制、改标签、确认未入目录的建议共用。

type Option = { kind: "label"; label: Label } | { kind: "create"; name: string };

export function LabelPickerHost() {
  const request = useLabels((s) => s.request);
  if (!request) return null;
  // key：每次请求重建，输入框与高亮项随之复位
  return <LabelPicker key={`${request.objectId}:${request.prefill}`} request={request} />;
}

export function LabelPicker({ request }: { request: LabelRequest }) {
  const { t } = useI18n();
  const labels = useLabels((s) => s.labels);
  const settle = useLabels((s) => s.settle);
  const createLabel = useLabels((s) => s.createLabel);
  const [query, setQuery] = useState(request.prefill);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLocaleLowerCase();
    const matched = labels.filter((l) => !q || l.name.toLocaleLowerCase().includes(q));
    const exact = labels.some((l) => l.name.toLocaleLowerCase() === q);
    const list: Option[] = matched.map((label) => ({ kind: "label", label }));
    if (q && !exact) list.push({ kind: "create", name: query.trim() });
    return list;
  }, [labels, query]);

  const choose = async (option: Option | undefined) => {
    if (!option || busy) return;
    if (option.kind === "label") return settle(option.label);
    setBusy(true);
    const created = await createLabel(request.objectId, option.name);
    setBusy(false);
    if (created) settle(created);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose(options[Math.min(active, options.length - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      settle(null);
    }
  };

  return (
    <div className="label-picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) settle(null); }}>
      <div className="label-picker" role="dialog" aria-label={t("label_picker_title")} data-testid="label-picker">
        <div className="label-picker-title">{t("label_picker_title")}</div>
        <input
          ref={inputRef}
          className="label-picker-input"
          value={query}
          placeholder={t("label_picker_placeholder")}
          aria-label={t("label_picker_placeholder")}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
        />
        <ul className="label-picker-list" role="listbox">
          {options.map((option, i) => (
            <li
              key={option.kind === "label" ? option.label.id : "create"}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); void choose(option); }}
            >
              {option.kind === "label" ? (
                <>
                  <span className="label-swatch" style={{ background: option.label.color }} />
                  <span className="label-name">{option.label.name}</span>
                </>
              ) : (
                <span className="label-create">{t("label_picker_create", { name: option.name })}</span>
              )}
            </li>
          ))}
          {options.length === 0 && <li className="label-picker-empty">{t("label_picker_empty")}</li>}
        </ul>
        <div className="label-picker-hint">{t("label_picker_hint")}</div>
      </div>
    </div>
  );
}
