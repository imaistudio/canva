export type StudioTab = "media" | "catalogue" | "library" | "settings";

export type AssetKind = "image" | "video" | "3d";

export interface CreditBalance {
  balance: number;
  totalCredits: number;
  usedCredits: number;
  grantsCount: number;
  nextExpiry: {
    amount: number;
    expiresAt: number;
    daysUntilExpiry: number;
  } | null;
}

export interface GenerationAsset {
  id: string;
  type: AssetKind;
  url: string;
  thumbnailUrl: string;
  label: string;
  prompt?: string;
  createdAt?: number;
  metadata?: {
    width?: number;
    height?: number;
    mimeType?: string;
  };
  productName?: string;
  versionName?: string;
}

export interface LibraryResponse {
  generations: GenerationAsset[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface MarketingGenerationResponse {
  success: boolean;
  accepted?: boolean;
  jobId?: string;
  status?: string;
  statusEndpoint?: string;
  versionId?: string;
  urls?: string[];
  assetIds?: string[];
  catalogueUpdated?: boolean;
  failedIds?: string[];
  pendingIds?: string[];
  text?: string;
}

export interface EcommerceGenerationResponse {
  success: boolean;
  accepted?: boolean;
  jobId?: string;
  status?: string;
  statusEndpoint?: string;
  versionId?: string;
  urls?: string[];
  assetIds?: string[];
  images?: {
    urls: string[];
    assetIds: string[];
    failedIds?: string[];
    pendingIds?: string[];
  };
  details?: {
    title?: string;
    description?: string;
    features?: string[];
    specifications?: Record<string, string>;
    platforms?: Record<
      string,
      {
        title?: string;
        description?: string;
        bulletPoints?: string[];
        tags?: string[];
        handle?: string;
        metadata?: Record<string, string>;
      }
    >;
  };
}

export interface GenerationJobStatusResponse {
  success: boolean;
  jobId: string;
  endpoint: string;
  status: "queued" | "running" | "processing" | "completed" | "failed";
  result?: MarketingGenerationResponse | EcommerceGenerationResponse;
  error?: {
    error?: string;
    message?: string;
  } | null;
}
