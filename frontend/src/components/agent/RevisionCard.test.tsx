// SDD 22 §5.1：修订记录卡片只记录生效的修订。
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { RevisionCard, parseAnnotationRevised } from "./RevisionCard";

describe("RevisionCard", () => {
  beforeEach(() => localStorage.setItem("glaux.lang", "en"));

  it("parses effective revisions only", () => {
    const base = { kind: "glaux.annotation_revised", annotation_id: "ann-1", image_id: "img" };
    expect(parseAnnotationRevised({ ...base, action: "update", annotation: { label: "plaque" }, note: "edge was off" }))
      .toEqual({ annotation_id: "ann-1", action: "update", label: "plaque", note: "edge was off" });
    expect(parseAnnotationRevised({ ...base, action: "withdraw" })).toEqual({ annotation_id: "ann-1", action: "withdraw" });
    expect(parseAnnotationRevised({ ...base, action: "withdraw", reason: "conflict" })).toBeNull();
    expect(parseAnnotationRevised({ ...base, kind: "glaux.annotation_proposed", action: "update" })).toBeNull();
  });

  it("shows what happened to which suggestion", () => {
    render(<I18nProvider><RevisionCard payload={{ annotation_id: "ann-1", action: "update", label: "plaque", note: "edge was off" }} /></I18nProvider>);
    expect(screen.getByTestId("revision-card")).toHaveTextContent("Revised suggestion");
    expect(screen.getByTestId("revision-card")).toHaveTextContent("plaque");
    expect(screen.getByTestId("revision-card")).toHaveTextContent("edge was off");
  });
});
