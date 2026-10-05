import { useI18n, type I18nKey } from "../../i18n";
import { useContextSection, type ContextSection } from "../../store/contextSection";
import { CONTEXT_ICON } from "../iconMap";
import { SectionedPanel, type PanelSection } from "../SectionedPanel";
import { AgentsSection } from "./AgentsSection";
import { confirmLeave, useCurrentProjectId, usePreview, useResourceList } from "./shared";
import { SkillsSection } from "./SkillsSection";
import { SystemSection } from "./SystemSection";
import { TemplatesSection } from "./TemplatesSection";
import { ToolsSection } from "./ToolsSection";
import { TrajectorySection } from "./TrajectorySection";

// 上下文页（SDD 19）：与设置页同一竖向分区布局；记忆、MCP 暂未开放。「运行 → 轨迹」见 SDD 21。

type SectionId = ContextSection | "memory" | "mcp";

const SECTIONS: { id: SectionId; label: I18nKey; group: I18nKey; disabled?: true }[] = [
  { id: "system", label: "ctx_system", group: "ctx_group_instructions" },
  { id: "templates", label: "ctx_templates", group: "ctx_group_instructions" },
  { id: "tools", label: "ctx_tools", group: "ctx_group_capabilities" },
  { id: "agents", label: "ctx_agents", group: "ctx_group_capabilities" },
  { id: "skills", label: "ctx_skills", group: "ctx_group_capabilities" },
  { id: "trajectory", label: "ctx_trajectory", group: "ctx_group_runtime" },
  { id: "memory", label: "ctx_memory", group: "ctx_group_extensions", disabled: true },
  { id: "mcp", label: "ctx_mcp", group: "ctx_group_extensions", disabled: true },
];

const DESC: Partial<Record<SectionId, I18nKey>> = {
  system: "ctx_system_desc",
  templates: "ctx_templates_desc",
  tools: "ctx_tools_desc",
  agents: "ctx_agents_desc",
  skills: "ctx_skills_desc",
  trajectory: "ctx_trajectory_desc",
};

/** 离开上下文页前的确认（SDD 19 §7.3 规则 2）；左侧竖条与活动栏切走时调用。 */
export function confirmLeaveContext(message: string): boolean {
  return confirmLeave(message);
}

export function ContextPanel() {
  const { t } = useI18n();
  const section = useContextSection((s) => s.section);
  const setSection = useContextSection((s) => s.setSection);
  const projectId = useCurrentProjectId();
  const { list, error, reload } = useResourceList(projectId);
  const preview = usePreview(section === "system" || section === "tools");

  const sections: PanelSection<SectionId>[] = SECTIONS.map((s) => ({
    id: s.id,
    label: t(s.label),
    icon: CONTEXT_ICON[s.id],
    group: t(s.group),
    ...(s.disabled ? { disabled: true, hint: t("ctx_unavailable") } : {}),
  }));
  const select = (id: SectionId) => {
    if (id === "memory" || id === "mcp" || id === section) return;
    if (confirmLeave(t("res_unsaved_confirm"))) setSection(id);
  };
  const desc = DESC[section];

  return (
    <SectionedPanel
      title={t("ctx_title")}
      sections={sections}
      current={section}
      onSelect={select}
      desc={desc ? t(desc) : undefined}
      testId="context-panel"
    >
      {section === "system" && (
        <SystemSection projectId={projectId} preview={preview.state} onRefresh={() => void preview.refresh()} onChanged={preview.markStale} />
      )}
      {/* 资源清单失败只影响列表分区；系统提示词分区自取 GLAUX.md 与预览（SDD 19 §13） */}
      {error && section !== "system" && section !== "trajectory" && (
        <div className="res-error ctx-list-error" role="alert">
          {error}
          <button type="button" onClick={() => void reload()}>{t("exp_retry")}</button>
        </div>
      )}
      {section === "templates" && <TemplatesSection projectId={projectId} list={list} reload={reload} />}
      {section === "tools" && (
        <ToolsSection tools={list?.tools ?? []} preview={preview.state} onRefresh={() => void preview.refresh()} />
      )}
      {section === "agents" && <AgentsSection agents={list?.agents ?? []} />}
      {section === "skills" && (
        <SkillsSection projectId={projectId} list={list} reload={reload} onChanged={preview.markStale} />
      )}
      {section === "trajectory" && <TrajectorySection />}
    </SectionedPanel>
  );
}
