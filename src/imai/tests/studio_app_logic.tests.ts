/* eslint-disable formatjs/no-literal-string-in-object */
import {
  buildMarketingPrompt,
  getCompletedJobResult,
  getGeneratedImagePlacements,
  mapEcommerceResultToAssets,
  mapLibraryResponseGenerations,
  mapMarketingResultToAssets,
  pollUntilCompleted,
} from "../studio_app_logic";
import type { GenerationAsset, GenerationJobStatusResponse } from "../types";

const createStatus = (
  status: GenerationJobStatusResponse["status"],
  result?: GenerationJobStatusResponse["result"],
): GenerationJobStatusResponse => ({
  success: true,
  jobId: "job_123",
  endpoint: "marketing",
  status,
  result,
});

describe("studio app logic", () => {
  it("appends the hidden marketing image count instruction", () => {
    expect(buildMarketingPrompt("Premium product shot", 3)).toBe(
      "Premium product shot\n\ngenerate me 3 images",
    );
    expect(buildMarketingPrompt("   ", 5)).toBe("generate me 5 images");
  });

  it("maps marketing generation urls into Canva image assets", () => {
    const assets = mapMarketingResultToAssets({
      success: true,
      urls: ["https://assets.test/one.jpg", "https://assets.test/two.jpg"],
    });

    expect(assets).toEqual([
      {
        id: "Generated asset-0-https://assets.test/one.jpg",
        type: "image",
        url: "https://assets.test/one.jpg",
        thumbnailUrl: "https://assets.test/one.jpg",
        label: "Generated asset 1",
      },
      {
        id: "Generated asset-1-https://assets.test/two.jpg",
        type: "image",
        url: "https://assets.test/two.jpg",
        thumbnailUrl: "https://assets.test/two.jpg",
        label: "Generated asset 2",
      },
    ]);
  });

  it("maps catalogue image urls from the nested API result first", () => {
    const assets = mapEcommerceResultToAssets({
      success: true,
      urls: ["https://assets.test/fallback.jpg"],
      images: {
        urls: ["https://assets.test/catalogue.jpg"],
        assetIds: ["asset_1"],
      },
    });

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      type: "image",
      url: "https://assets.test/catalogue.jpg",
      thumbnailUrl: "https://assets.test/catalogue.jpg",
      label: "Catalogue asset 1",
    });
  });

  it("normalizes library assets without overriding existing labels", () => {
    const generations: GenerationAsset[] = [
      {
        id: "with-label",
        type: "image",
        url: "https://assets.test/one.jpg",
        thumbnailUrl: "",
        label: "Saved label",
      },
      {
        id: "without-label",
        type: "image",
        url: "https://assets.test/two.jpg",
        thumbnailUrl: "",
        label: "",
        productName: "Sneaker",
      },
    ];

    expect(mapLibraryResponseGenerations(generations)).toEqual([
      {
        ...generations[0],
        thumbnailUrl: "https://assets.test/one.jpg",
      },
      {
        ...generations[1],
        thumbnailUrl: "https://assets.test/two.jpg",
        label: "Sneaker",
      },
    ]);
  });

  it("extracts completed job results and ignores incomplete statuses", () => {
    const completedResult = {
      success: true,
      urls: ["https://assets.test/one.jpg"],
    };

    expect(getCompletedJobResult(createStatus("processing"))).toBeNull();
    expect(
      getCompletedJobResult(createStatus("completed", completedResult)),
    ).toBe(completedResult);
  });

  it("creates non-overlapping generated image placements within the page", () => {
    const assets = mapMarketingResultToAssets({
      success: true,
      urls: [
        "https://assets.test/one.jpg",
        "https://assets.test/two.jpg",
        "https://assets.test/three.jpg",
        "https://assets.test/four.jpg",
        "https://assets.test/five.jpg",
      ],
    });

    const placements = getGeneratedImagePlacements(assets, {
      width: 1000,
      height: 800,
    });

    expect(placements).toHaveLength(5);
    for (const placement of placements) {
      expect(placement.top).toBeGreaterThanOrEqual(0);
      expect(placement.left).toBeGreaterThanOrEqual(0);
      expect(placement.left + placement.width).toBeLessThanOrEqual(1000);
      expect(placement.top + placement.height).toBeLessThanOrEqual(800);
    }
  });

  it("polls until a queued job completes without real timers", async () => {
    let currentTime = 0;
    const statuses: GenerationJobStatusResponse[] = [
      createStatus("queued"),
      createStatus("running"),
      createStatus("completed", {
        success: true,
        urls: ["https://assets.test/complete.jpg"],
      }),
    ];
    const waits: number[] = [];
    const getStatus = jest.fn(async () => {
      const status = statuses.shift();

      if (!status) {
        throw new Error("Unexpected extra poll.");
      }

      return status;
    });

    const result = await pollUntilCompleted({
      jobId: "job_123",
      getStatus,
      now: () => currentTime,
      waitFor: async (durationMs) => {
        waits.push(durationMs);
        currentTime += durationMs;
      },
      pollingIntervalMs: 1000,
      maxDurationMs: 5000,
    });

    expect(result.status).toBe("completed");
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it("throws API failure messages during polling", async () => {
    await expect(
      pollUntilCompleted({
        jobId: "job_123",
        getStatus: async () => ({
          ...createStatus("failed"),
          error: { message: "Render failed" },
        }),
        waitFor: async () => undefined,
        maxDurationMs: 1000,
      }),
    ).rejects.toThrow("Render failed");
  });

  it("times out polling after the configured duration", async () => {
    let currentTime = 0;

    await expect(
      pollUntilCompleted({
        jobId: "job_123",
        getStatus: async () => createStatus("processing"),
        now: () => currentTime,
        waitFor: async (durationMs) => {
          currentTime += durationMs;
        },
        pollingIntervalMs: 1000,
        maxDurationMs: 2500,
      }),
    ).rejects.toThrow("Generation is still processing after 5 minutes.");
  });
});
