import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { en, type I18nKey } from "./en";
import { zh } from "./zh";

export type Lang = "en" | "zh";
const DICTS = { en, zh } as const;

// 默认语言：跟随 navigator.language（zh* → 中文），用户切换后记 localStorage（设计稿 §4）。
function initialLang(): Lang {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("glaux.lang") : null;
  if (saved === "en" || saved === "zh") return saved;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

type Vars = Record<string, string | number>;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** 取译文并插值 {name}；键缺失回退到键名本身（开发期可见）。 */
  t: (key: I18nKey, vars?: Vars) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("glaux.lang", l);
    } catch {
      /* localStorage 不可用（隐私模式等）时静默 */
    }
    document.documentElement.lang = l;
  }, []);

  const toggle = useCallback(() => setLang(lang === "en" ? "zh" : "en"), [lang, setLang]);

  const t = useCallback(
    (key: I18nKey, vars?: Vars) => interpolate(DICTS[lang][key] ?? key, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, toggle, t }), [lang, setLang, toggle, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n 必须在 <I18nProvider> 内使用");
  return c;
}

/** 非 hook 取词面（CS3D 自定义工具等组件外场景）——lang 与 initialLang 同源。 */
export function getT(): (key: I18nKey, vars?: Vars) => string {
  const lang = initialLang();
  return (key, vars) => interpolate(DICTS[lang][key] ?? key, vars);
}

export type { I18nKey };
