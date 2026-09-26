// SDD 14 §7.3 规则 8、D-7：document 与 focus 并存；打开视觉对象即关闭文档视图。
import { beforeEach, describe, expect, it } from "vitest";

import type { Focus } from "../api/types";
import { closeDocument, openObject, openProjectDocument } from "../data/actions";
import { objectMeta } from "../test/fixtures";
import { useSession } from "./session";

const focusOf = (id: string): Focus => ({ object_id: id, kind: "image", index: {}, region: null });

describe("session document", () => {
  beforeEach(() => {
    useSession.setState({
      modality: "natural_image",
      focus: focusOf("x"),
      document: { path: "notes/a.md" },
      documentError: null,
      documentLoading: false,
      tasks: [],
      objects: {
        natural_image: [
          objectMeta({ id: "x", modality: "natural_image" }),
          objectMeta({ id: "y", modality: "natural_image" }),
        ],
      },
    });
  });

  it("设置新的非空焦点时清空 document", () => {
    useSession.getState().setFocus(focusOf("y"));
    expect(useSession.getState().document).toBeNull();
  });

  it("setFocus(null) 与同一对象的焦点不清空 document", () => {
    useSession.getState().setFocus({ ...focusOf("x"), index: { z: 3 } });
    expect(useSession.getState().document).toEqual({ path: "notes/a.md" });
    useSession.getState().setFocus(null);
    expect(useSession.getState().document).toEqual({ path: "notes/a.md" });
  });

  it("打开文档不改 focus；关闭后 focus 仍在", () => {
    useSession.setState({ document: null, documentError: { path: "c.zip", code: "binary" } });
    openProjectDocument("src/b.py");
    expect(useSession.getState().document).toEqual({ path: "src/b.py" });
    expect(useSession.getState().documentError).toBeNull();
    expect(useSession.getState().focus?.object_id).toBe("x");
    closeDocument();
    expect(useSession.getState().document).toBeNull();
    expect(useSession.getState().focus?.object_id).toBe("x");
  });

  it("同一文件加载中时不重复发起；加载完成后重新打开即重新读取", () => {
    const loading = useSession.getState().document;
    useSession.setState({ documentLoading: true });
    openProjectDocument("notes/a.md");
    expect(useSession.getState().document).toBe(loading);
    useSession.setState({ documentLoading: false });
    openProjectDocument("notes/a.md");
    expect(useSession.getState().document).not.toBe(loading);
    expect(useSession.getState().document).toEqual({ path: "notes/a.md" });
  });

  it("重新打开当前焦点对象同样关闭文档视图", async () => {
    await openObject("x");
    expect(useSession.getState().document).toBeNull();
    expect(useSession.getState().focus?.object_id).toBe("x");
  });
});
