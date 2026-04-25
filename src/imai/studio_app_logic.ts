/* eslint-disable formatjs/no-literal-string-in-object */
import type {
  EcommerceGenerationResponse,
  GenerationAsset,
  GenerationJobStatusResponse,
  MarketingGenerationResponse,
} from "./types";

export const POLLING_INTERVAL_MS = 60 * 1000;
export const MAX_POLLING_DURATION_MS = 5 * 60 * 1000;

type GenerationJobResult =
  | MarketingGenerationResponse
  | EcommerceGenerationResponse;

interface ImagePlacement {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PollUntilCompletedOptions {
  jobId: string;
  getStatus: (jobId: string) => Promise<GenerationJobStatusResponse>;
  waitFor?: (durationMs: number) => Promise<void>;
  now?: () => number;
  pollingIntervalMs?: number;
  maxDurationMs?: number;
}

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const buildAssetLabel = (asset: Partial<GenerationAsset>, index: number) =>
  asset.productName ||
  asset.versionName ||
  asset.prompt ||
  `Asset ${index + 1}`;

export const createImageAsset = (
  url: string,
  index: number,
  labelPrefix: string,
): GenerationAsset => ({
  id: `${labelPrefix}-${index}-${url}`,
  type: "image",
  url,
  thumbnailUrl: url,
  label: `${labelPrefix} ${index + 1}`,
});

export const mapMarketingResultToAssets = (
  result: MarketingGenerationResponse,
): GenerationAsset[] => {
  return (result.urls || []).map((url, index) =>
    createImageAsset(url, index, "Generated asset"),
  );
};

export const mapEcommerceResultToAssets = (
  result: EcommerceGenerationResponse,
): GenerationAsset[] => {
  const urls = result.images?.urls || result.urls || [];

  return urls.map((url, index) =>
    createImageAsset(url, index, "Catalogue asset"),
  );
};

export const mapLibraryResponseGenerations = (
  generations: GenerationAsset[],
): GenerationAsset[] =>
  generations.map((generation, index) => ({
    ...generation,
    thumbnailUrl: generation.thumbnailUrl || generation.url,
    label: generation.label || buildAssetLabel(generation, index),
  }));

export const isCompletedJobResponse = (
  value: GenerationJobResult | GenerationJobStatusResponse,
): value is GenerationJobStatusResponse =>
  "status" in value && value.status === "completed";

export const getCompletedJobResult = (
  value: GenerationJobResult | GenerationJobStatusResponse,
): GenerationJobResult | null => {
  if (!isCompletedJobResponse(value)) {
    return null;
  }

  return value.result ?? null;
};

export const buildMarketingPrompt = (
  promptInput: string,
  imageCount: number,
) => {
  const prompt = promptInput.trim();
  const countInstruction = `generate me ${imageCount} images`;

  return prompt ? `${prompt}\n\n${countInstruction}` : countInstruction;
};

export const getAssetAspectRatio = (asset: GenerationAsset) => {
  const width = asset.metadata?.width;
  const height = asset.metadata?.height;

  if (width && height && width > 0 && height > 0) {
    return width / height;
  }

  return 1;
};

export const getGeneratedImagePlacements = (
  assets: GenerationAsset[],
  dimensions: { width: number; height: number },
): ImagePlacement[] => {
  const gap = Math.min(32, Math.max(16, dimensions.width * 0.025));
  const columns = assets.length === 1 ? 1 : assets.length <= 4 ? 2 : 3;
  const rows = Math.ceil(assets.length / columns);
  const maxGridWidth = dimensions.width * 0.82;
  const maxGridHeight = dimensions.height * 0.82;
  const cellWidth = (maxGridWidth - gap * (columns - 1)) / columns;
  const cellHeight = (maxGridHeight - gap * (rows - 1)) / rows;

  const placements = assets.map((asset) => {
    const aspectRatio = getAssetAspectRatio(asset);
    const width = Math.min(cellWidth, cellHeight * aspectRatio);
    const height = width / aspectRatio;

    return { width, height };
  });

  const rowHeights = Array.from({ length: rows }, (_, rowIndex) =>
    Math.max(
      ...placements
        .slice(rowIndex * columns, rowIndex * columns + columns)
        .map((placement) => placement.height),
    ),
  );
  const gridHeight =
    rowHeights.reduce((total, height) => total + height, 0) + gap * (rows - 1);
  const top = (dimensions.height - gridHeight) / 2;

  return placements.map((placement, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rowTop =
      top +
      rowHeights.slice(0, row).reduce((total, height) => total + height, 0) +
      gap * row;
    const rowAssets = placements.slice(row * columns, row * columns + columns);
    const rowWidth =
      rowAssets.reduce((total, item) => total + item.width, 0) +
      gap * (rowAssets.length - 1);
    const left =
      (dimensions.width - rowWidth) / 2 +
      rowAssets
        .slice(0, column)
        .reduce((total, item) => total + item.width, 0) +
      gap * column;

    const rowHeight = rowHeights[row] ?? placement.height;

    return {
      top: rowTop + (rowHeight - placement.height) / 2,
      left,
      width: placement.width,
      height: placement.height,
    };
  });
};

export const pollUntilCompleted = async ({
  jobId,
  getStatus,
  waitFor = wait,
  now = Date.now,
  pollingIntervalMs = POLLING_INTERVAL_MS,
  maxDurationMs = MAX_POLLING_DURATION_MS,
}: PollUntilCompletedOptions): Promise<GenerationJobStatusResponse> => {
  let latestStatus: GenerationJobStatusResponse | null = null;
  const deadline = now() + maxDurationMs;

  while (now() <= deadline) {
    latestStatus = await getStatus(jobId);

    if (latestStatus.status === "completed") {
      return latestStatus;
    }

    if (latestStatus.status === "failed") {
      throw new Error(
        latestStatus.error?.message || "Generation failed before completion.",
      );
    }

    const remainingTime = deadline - now();
    if (remainingTime <= 0) {
      break;
    }

    await waitFor(Math.min(pollingIntervalMs, remainingTime));
  }

  throw new Error(
    latestStatus?.error?.message ||
      "Generation is still processing after 5 minutes. Check your library in a moment or try again.",
  );
};
