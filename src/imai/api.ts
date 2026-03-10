import type {
  CreditBalance,
  EcommerceGenerationResponse,
  GenerationJobStatusResponse,
  LibraryResponse,
  MarketingGenerationResponse,
} from "./types";

type HttpMethod = "GET" | "POST";

interface RequestOptions {
  method?: HttpMethod;
  apiKey: string;
  body?: Record<string, unknown>;
}

const BASE_URL = IMAI_API_BASE_URL;

const createHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

const parseErrorResponse = async (response: Response) => {
  try {
    const errorBody = (await response.json()) as {
      error?: string;
      message?: string;
      required?: string[];
    };

    if (errorBody.message) {
      return errorBody.message;
    }

    if (errorBody.error) {
      return errorBody.error;
    }
  } catch {
    // Ignore parsing errors and fall back to status text.
  }

  return `Request failed with status ${response.status}`;
};

const sendRequest = async <T>(
  path: string,
  { method = "GET", apiKey, body }: RequestOptions,
): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: createHeaders(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  return (await response.json()) as T;
};

export const getCredits = (apiKey: string) =>
  sendRequest<CreditBalance>("/api/v1/credits", {
    apiKey,
  });

export const getMarketingLibrary = (
  apiKey: string,
  options?: {
    cursor?: string | null;
    type?: "image" | "all";
    numItems?: number;
  },
) => {
  const url = new URL("/api/v1/library/marketing", BASE_URL);
  if (options?.cursor) {
    url.searchParams.set("cursor", options.cursor);
  }
  if (options?.type && options.type !== "all") {
    url.searchParams.set("type", options.type);
  }
  if (options?.numItems) {
    url.searchParams.set("numItems", String(options.numItems));
  }

  return sendRequest<LibraryResponse>(`${url.pathname}${url.search}`, {
    apiKey,
  });
};

export const verifyApiKey = async (
  apiKey: string,
  options?: {
    libraryNumItems?: number;
  },
) => {
  const [credits, library] = await Promise.all([
    getCredits(apiKey),
    getMarketingLibrary(apiKey, {
      numItems: options?.libraryNumItems ?? 1,
      type: "image",
    }),
  ]);

  return { credits, library };
};

export const startMarketingGeneration = (
  apiKey: string,
  body: {
    url: string;
    prompt?: string;
  },
) =>
  sendRequest<MarketingGenerationResponse>("/api/v1/generate/marketing", {
    method: "POST",
    apiKey,
    body: {
      ...body,
      async: true,
      action: "generate",
    },
  });

export const startEcommerceGeneration = (
  apiKey: string,
  body: {
    url: string;
    prompt?: string;
  },
) =>
  sendRequest<EcommerceGenerationResponse>("/api/v1/generate/ecommerce", {
    method: "POST",
    apiKey,
    body: {
      ...body,
      async: true,
      platforms: ["generic"],
      includeImages: true,
      includeDetails: true,
      includeTitles: true,
      includeSpecs: true,
    },
  });

export const getGenerationStatus = (apiKey: string, jobId: string) => {
  const url = new URL("/api/v1/generate/status", BASE_URL);
  url.searchParams.set("jobId", jobId);

  return sendRequest<GenerationJobStatusResponse>(`${url.pathname}${url.search}`, {
    apiKey,
  });
};
