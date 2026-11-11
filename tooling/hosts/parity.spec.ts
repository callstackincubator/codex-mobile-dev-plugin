import { recordingWithFramesFixture } from "../../packages/test-support/recording-fixtures.ts";
import { expect, test } from "./fixtures.ts";

// Run the same saved-data workflows against both shipped servers and pages.
// Device helpers are absent; every recording lives in the server's temporary home.
test.describe("Product parity", () => {
  for (const action of ["ask", "open"] as const) {
    test(`a saved chart can ${action} with its exact recording and range`, async ({ server, openView, page, pageErrors, target }) => {
      const recording = recordingWithFramesFixture();
      await server.saveRecording(recording);
      const { view, result } = await openView("mobile_render_performance_recording", {
        arguments: { recordingId: recording.id, range: { start: 12, end: 18 } }, displayMode: "inline",
      });
      expect(result.isError).not.toBe(true);
      await expect(view.getByRole("heading", { name: recording.title })).toBeVisible();
      for (const label of ["CPU", "Memory (MiB)", "Display FPS"]) {
        await expect(view.getByRole("heading", { name: label, exact: true })).toBeVisible();
      }
      // Thread and frame detail prove that the card read the original samples.
      await expect(view.getByRole("region", { name: "Thread CPU usage" }).getByText("main", { exact: true })).toBeVisible();
      await expect(view.getByRole("region", { name: "Display statistics" }).getByText("Jank rate", { exact: true })).toBeVisible();
      await expect(view.getByRole("button", { name: "Download JSON" })).toHaveCount(0);
      await view.getByRole("button", { name: action === "ask" ? "Ask about this range" : "Open in Mobile Dev" }).click();
      await expect.poll(() => page.evaluate(() => window.harness.events.filter(event => event.method === "message").length)).toBe(1);
      const events = await page.evaluate(() => window.harness.events.filter(event => event.method === "message" || event.method === "modelContext"));
      const message = events.find(event => event.method === "message")!.params;
      const context = target === "codex" ? events.find(event => event.method === "modelContext")!.params : message;
      const reference = (context.content ?? []).flatMap(item => item.type === "text" ? [item.text] : []).join("\n");
      expect(reference).toContain(recording.id);
      expect(reference).toContain('"start":12,"end":18');
      expect(reference).toContain(action === "ask" ? "mobile_read_performance_recording" : "mobile_open_performance_recording");
      const route = message._meta?.["openai/message"];
      expect(route).toEqual(target === "codex" ? { target: "active", send: true } : undefined);
      expect(pageErrors).toEqual([]);
    });
  }

  test("a comparison keeps both runs, visibility controls, frame detail and its question", async ({ server, openView, page, pageErrors, target }) => {
    const first = recordingWithFramesFixture();
    const second = { ...recordingWithFramesFixture(), id: "701a3e78-5aeb-4141-a8a5-21ae92b05127", title: "Checkout scroll · Run 2" };
    await server.saveRecording(first);
    await server.saveRecording(second);
    const { view, result } = await openView("mobile_compare_performance_recordings", {
      arguments: { recordingIds: [first.id, second.id], title: "Before / after", range: { start: 12, end: 18 } }, displayMode: "inline",
    });
    expect(result.isError).not.toBe(true);
    await expect(view.getByRole("heading", { name: "Before / after" })).toBeVisible();
    // Jank is absent from previews, so wait for both complete recordings to load.
    await expect(view.getByText("Jank rate", { exact: true })).toBeVisible();
    const toggle = view.getByRole("button", { name: new RegExp(second.title) });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await view.getByRole("button", { name: "Ask about this range" }).click();
    await expect.poll(() => page.evaluate(() => window.harness.events.filter(event => event.method === "message").length)).toBe(1);
    const events = await page.evaluate(() => window.harness.events.filter(event => event.method === "message" || event.method === "modelContext"));
    const context = target === "codex" ? events.find(event => event.method === "modelContext")!.params : events.find(event => event.method === "message")!.params;
    const reference = (context.content ?? []).flatMap(item => item.type === "text" ? [item.text] : []).join("\n");
    expect(reference).toContain(first.id);
    expect(reference).toContain(second.id);
    expect(reference).toContain('"start":12,"end":18');
    expect(reference).toContain("mobile_compare_performance_recordings");
    expect(pageErrors).toEqual([]);
  });

  test("the workspace downloads the full original recording when the host supports it", async ({ server, openView, page, pageErrors }) => {
    const recording = recordingWithFramesFixture();
    await server.saveRecording(recording);
    const { view, result } = await openView("mobile_open_performance_recording", {
      arguments: { recordingId: recording.id, range: { start: 12, end: 18 } },
      capabilities: { downloadFile: {} },
    });
    expect(result.isError).not.toBe(true);
    await expect(view.getByRole("heading", { name: recording.title })).toBeVisible();
    await expect(view.getByText("31 CPU/memory samples", { exact: false })).toBeVisible();
    const download = view.getByRole("button", { name: "Download JSON" });
    await expect(download).toBeEnabled();
    await download.click();
    await expect(view.getByText("Download started.", { exact: true })).toBeVisible();
    const downloads = await page.evaluate(() => window.harness.events.filter(event => event.method === "downloadFile"));
    expect(downloads).toHaveLength(1);
    const contents = downloads[0].params.contents;
    expect(contents).toHaveLength(1);
    expect(contents[0].type).toBe("resource");
    if (contents[0].type !== "resource" || !("text" in contents[0].resource)) throw new Error("Expected an embedded JSON recording.");
    expect(contents[0].resource.uri).toBe(`file:///mobile-dev-recording-${recording.id}.json`);
    expect(contents[0].resource.mimeType).toBe("application/json");
    expect(JSON.parse(contents[0].resource.text)).toEqual(recording);
    expect(pageErrors).toEqual([]);
  });
});
