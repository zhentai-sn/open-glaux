// 模态标签（SDD 10 D-22、§9.3）：顺序固定为 DataSource.label_key（i18n 键，命中即用）→
// label（服务端兜底文案）→ modality 原文。标签属数据源展示属性，不取自 /tasks。
import { useCallback } from "react";

import type { DataSource } from "../api/types";
import { useSession } from "../store/session";
import { lookup, useI18n, type Lang } from "./index";

export function modalityLabel(lang: Lang, datasources: DataSource[], modality: string): string {
  const ds = datasources.find((d) => d.modality === modality);
  return (ds?.label_key && lookup(lang, ds.label_key)) || ds?.label || modality;
}

export function useModalityLabel(): (modality: string) => string {
  const { lang } = useI18n();
  const datasources = useSession((s) => s.datasources);
  return useCallback((m: string) => modalityLabel(lang, datasources, m), [lang, datasources]);
}
