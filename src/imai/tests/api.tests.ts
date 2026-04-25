import {
  getGenerationStatus,
  getMarketingLibrary,
  startEcommerceGeneration,
  startMarketingGeneration,
} from "../api";

const fetchMock = jest.fn();

const mockJsonResponse = (body: unknown, init?: ResponseInit) =>
  ({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: jest.fn(async () => body),
  }) as unknown as Response;

describe("IMAI API helpers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(mockJsonResponse({ success: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("starts marketing generation as an async generate action", async () => {
    await startMarketingGeneration("sk_test", {
      url: "https://assets.test/source.jpg",
      prompt: "Hero campaign",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.imai.studio/api/v1/generate/marketing",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer sk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://assets.test/source.jpg",
          prompt: "Hero campaign",
          async: true,
          action: "generate",
        }),
      }),
    );
  });

  it("starts catalogue generation through the marketing endpoint with catalogue action", async () => {
    await startEcommerceGeneration("sk_test", {
      url: "https://assets.test/source.jpg",
      prompt: "Catalogue copy",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.imai.studio/api/v1/generate/marketing",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://assets.test/source.jpg",
          prompt: "Catalogue copy",
          async: true,
          action: "catalogue",
        }),
      }),
    );
  });

  it("requests generation status using the job id query string", async () => {
    await getGenerationStatus("sk_test", "job_123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.imai.studio/api/v1/generate/status?jobId=job_123",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer sk_test",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("requests marketing library pages without making real network calls", async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        generations: [],
        pagination: { hasMore: false, nextCursor: null },
      }),
    );

    await getMarketingLibrary("sk_test", {
      cursor: "cursor_1",
      type: "image",
      numItems: 12,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.imai.studio/api/v1/library/marketing?cursor=cursor_1&type=image&numItems=12",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("turns browser fetch failures into a useful API host message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getGenerationStatus("sk_test", "job_123")).rejects.toThrow(
      "Unable to reach IMAI.Studio (www.imai.studio).",
    );
  });
});
