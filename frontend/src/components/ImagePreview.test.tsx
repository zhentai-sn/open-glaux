import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { useSession } from "../store/session";
import { ImagePreview } from "./ImagePreview";

const SRC = "data:image/png;base64,AAAA";

function renderPreview() {
  render(
    <I18nProvider>
      <ImagePreview />
    </I18nProvider>,
  );
}

describe("ImagePreview", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ imagePreview: null });
  });

  it("renders nothing until an image is selected", () => {
    renderPreview();
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      useSession.setState({ imagePreview: { src: SRC, alt: "shot.png" } });
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByAltText("shot.png").getAttribute("src")).toBe(SRC);
  });

  it("closes on backdrop click and on the close button", () => {
    useSession.setState({ imagePreview: { src: SRC, alt: "shot.png" } });
    renderPreview();

    fireEvent.click(screen.getByRole("dialog"));
    expect(useSession.getState().imagePreview).toBeNull();

    act(() => {
      useSession.setState({ imagePreview: { src: SRC, alt: "shot.png" } });
    });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(useSession.getState().imagePreview).toBeNull();
  });

  it("keeps the overlay open when the image itself is clicked", () => {
    useSession.setState({ imagePreview: { src: SRC, alt: "shot.png" } });
    renderPreview();

    fireEvent.click(screen.getByAltText("shot.png"));
    expect(useSession.getState().imagePreview).not.toBeNull();
  });
});
