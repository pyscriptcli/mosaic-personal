// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownMessage } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders GFM tables with headers and a keyboard-scrollable wrapper", () => {
    render(<MarkdownMessage content={'| Topic | Timing |\n| --- | --- |\n| Report | Thursday at 3 PM |'} />);

    expect(screen.getByRole("region", { name: "Scrollable table response" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Topic" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Thursday at 3 PM" })).toBeTruthy();
  });

  it("does not render raw HTML as executable markup", () => {
    const { container } = render(<MarkdownMessage content={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
