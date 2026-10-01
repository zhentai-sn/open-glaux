import { useState, type DragEvent } from "react";

import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { DescribeConfirm } from "./DescribeConfirm";
import { ExemplarDetail } from "./ExemplarDetail";
import { ExemplarList } from "./ExemplarList";
import { UploadBar, useAtlasUpload } from "./UploadBar";

// 图谱页面根组件（SDD feats/03 §8）：同一组件挂在 Workbench 左侧栏与 Focus 右侧工作区，
// 按 useAtlasUi.screen 在列表 / 详情间切换；列表屏整体接受拖放上传（§5.1）。
export function AtlasView({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const screen = useAtlasUi((s) => s.screen);
  const selectedId = useAtlasUi((s) => s.selectedId);
  const upload = useAtlasUpload();
  const [dragOver, setDragOver] = useState(false);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dropProps =
    screen === "list"
      ? {
          onDragOver: (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragOver(true);
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
          },
          onDrop: (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragOver(false);
            void upload.uploadFiles(Array.from(e.dataTransfer.files));
          },
        }
      : {};

  return (
    <div
      className={"atlas-view" + (compact ? " compact" : "") + (dragOver ? " drop" : "")}
      data-testid="atlas-view"
      {...dropProps}
    >
      {screen === "list" && (
        <>
          <div className="atlas-head">
            <div>
              <b>{t("atlas_title")}</b>
              <span className="atlas-sub">{t("atlas_subtitle")}</span>
            </div>
          </div>
          <UploadBar upload={upload} />
          <DescribeConfirm />
          <ExemplarList />
        </>
      )}
      {screen === "detail" && selectedId && <ExemplarDetail id={selectedId} />}
    </div>
  );
}
