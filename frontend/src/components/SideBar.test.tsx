import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ImageMeta } from "../api/types";
import { I18nProvider } from "../i18n";
import { useSession } from "../store/session";
import { ExplorerView } from "./SideBar";

const NATURAL: ImageMeta[] = [
  { id: "natural_cat", center: "Natural images", cf: null, methods: [], modality: "natural_image" },
  { id: "natural_coffee", center: "Natural images", cf: null, methods: [], modality: "natural_image" },
];

describe("Explorer natural images", () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.setState({
      modality: "carotid_imt",
      tasks: [],
      images: [],
      naturalImages: NATURAL,
      volumes: [],
      slides: [],
      activeImage: null,
      activeVolume: null,
      activeSlide: null,
      imageMeta: null,
      metrics: null,
      primitives: [],
      annotations: [],
      modelVersion: "",
    });
  });

  it("always shows the natural-images folder and selects a photo without a medical task", () => {
    render(
      <I18nProvider>
        <ExplorerView />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: /natural-images/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /natural_cat/ }));

    expect(useSession.getState().modality).toBe("natural_image");
    expect(useSession.getState().activeImage).toBe("natural_cat");
    expect(screen.getByText("Natural images")).toBeTruthy();
  });
});
