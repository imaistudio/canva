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
const TEMPFILE_BASE_URL = "https://tempfile.org";

const logApiEvent = (
  stage: "request" | "response" | "error",
  label: string,
  details: Record<string, unknown>,
) => {
  console.log(`[imai-api] ${stage.toUpperCase()} ${label}`, details);
};

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
  const url = `${BASE_URL}${path}`;

  logApiEvent("request", path, {
    method,
    url,
    hasApiKey: Boolean(apiKey),
    body: body ?? null,
  });

  try {
    const response = await fetch(url, {
      method,
      headers: createHeaders(apiKey),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const message = await parseErrorResponse(response);
      logApiEvent("error", path, {
        method,
        url,
        status: response.status,
        message,
      });
      throw new Error(message);
    }

    const result = (await response.json()) as T;
    logApiEvent("response", path, {
      method,
      url,
      status: response.status,
      result,
    });
    return result;
  } catch (error) {
    if (!(error instanceof Error)) {
      logApiEvent("error", path, {
        method,
        url,
        error,
      });
    }
    throw error;
  }
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

interface TempfileUploadFromUrlResponse {
  success: boolean;
  file?: {
    id: string;
    name: string;
    size: number;
    url: string;
    expiryTime: number;
  };
  error?: string;
}

interface TempfileUploadLocalResponse {
  success: boolean;
  files?: Array<{
    id: string;
    name: string;
    size: number;
    url: string;
    expiryTime: number;
  }>;
  error?: string;
}

const createTempfilePreviewUrl = (fileUrl: string) => {
  const normalizedBaseUrl = fileUrl.endsWith("/") ? fileUrl : `${fileUrl}/`;
  return new URL("preview", normalizedBaseUrl).toString();
};

export const uploadUrlToTempfile = async (
  sourceUrl: string,
  options?: {
    customName?: string;
    expiryHours?: 1 | 6 | 24 | 48;
  },
) => {
  const url = `${TEMPFILE_BASE_URL}/api/upload/url`;
  const payload = {
    url: sourceUrl,
    customName: options?.customName,
    expiryHours: options?.expiryHours ?? 24,
  };

  logApiEvent("request", "tempfile.uploadUrl", {
    method: "POST",
    url,
    body: payload,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let result: TempfileUploadFromUrlResponse | null = null;

  try {
    result = (await response.json()) as TempfileUploadFromUrlResponse;
  } catch {
    result = null;
  }

  if (!response.ok || !result?.success || !result.file?.url) {
    const message =
      result?.error || `Tempfile upload failed with status ${response.status}.`;
    logApiEvent("error", "tempfile.uploadUrl", {
      method: "POST",
      url,
      status: response.status,
      result,
      message,
    });
    throw new Error(message);
  }

  const uploadResult = {
    fileId: result.file.id,
    fileUrl: result.file.url,
    previewUrl: createTempfilePreviewUrl(result.file.url),
    expiryTime: result.file.expiryTime,
  };

  logApiEvent("response", "tempfile.uploadUrl", {
    method: "POST",
    url,
    status: response.status,
    result: uploadResult,
  });

  return uploadResult;
};

export const uploadFileToTempfile = async (
  file: File,
  options?: {
    expiryHours?: 1 | 6 | 24 | 48;
  },
) => {
  const formData = new FormData();
  formData.append("files", file);
  formData.append("expiryHours", String(options?.expiryHours ?? 24));

  const url = `${TEMPFILE_BASE_URL}/api/upload/local`;
  logApiEvent("request", "tempfile.uploadFile", {
    method: "POST",
    url,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    expiryHours: options?.expiryHours ?? 24,
  });

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  let result: TempfileUploadLocalResponse | null = null;

  try {
    result = (await response.json()) as TempfileUploadLocalResponse;
  } catch {
    result = null;
  }

  const uploadedFile = result?.files?.[0];

  if (!response.ok || !result?.success || !uploadedFile?.url) {
    const message =
      result?.error || `Tempfile upload failed with status ${response.status}.`;
    logApiEvent("error", "tempfile.uploadFile", {
      method: "POST",
      url,
      status: response.status,
      result,
      message,
    });
    throw new Error(message);
  }

  const uploadResult = {
    fileId: uploadedFile.id,
    fileUrl: uploadedFile.url,
    previewUrl: createTempfilePreviewUrl(uploadedFile.url),
    expiryTime: uploadedFile.expiryTime,
  };

  logApiEvent("response", "tempfile.uploadFile", {
    method: "POST",
    url,
    status: response.status,
    result: uploadResult,
  });

  return uploadResult;
};
