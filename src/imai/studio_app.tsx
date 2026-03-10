import {
  Alert,
  Button,
  Carousel,
  Column,
  Columns,
  FormField,
  Grid,
  HorizontalCard,
  ImageCard,
  Placeholder,
  ReloadIcon,
  Rows,
  SearchIcon,
  SegmentedControl,
  LockClosedIcon,
  PlusIcon,
  ArrowDownIcon,
  SurfaceHeader,
  Text,
  TextInput,
  TrashIcon,
  VideoCard,
} from "@canva/app-ui-kit";
import type { ImageMimeType, VideoMimeType } from "@canva/asset";
import { upload } from "@canva/asset";
import { addElementAtPoint } from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { getCredits, getGenerationStatus, getMarketingLibrary, startEcommerceGeneration, startMarketingGeneration, verifyApiKey } from "./api";
import {
  getHasSeenSetup,
  getStoredApiKey,
  removeStoredApiKey,
  setStoredApiKey,
} from "./storage";
import type {
  CreditBalance,
  EcommerceGenerationResponse,
  GenerationAsset,
  GenerationJobStatusResponse,
  LibraryResponse,
  MarketingGenerationResponse,
  StudioTab,
} from "./types";
import * as styles from "styles/imai.css";

const LIBRARY_PAGE_SIZE = 24;
const INITIAL_LIBRARY_PAGE_SIZE = 36;
const POLLING_INTERVAL_MS = 2 * 60 * 1000;
const MAX_POLLING_ATTEMPTS = 5;

const showcaseSlides = [
  {
    id: "media",
    title: "Media Studio",
    description: "Generate marketing visuals from a product image and prompt.",
    imageUrl: "",
  },
  {
    id: "catalogue",
    title: "Product Catalogue",
    description:
      "Create marketplace-ready product details and supporting visuals.",
    imageUrl: "",
  },
  {
    id: "library",
    title: "Marketing Library",
    description: "Reuse past marketing generations directly inside Canva.",
    imageUrl: "",
  },
] as const;

type AppStage = "booting" | "showcase" | "setup" | "verifying" | "ready";
type GenerationState = "idle" | "submitting" | "polling";

type GenerationJobResult =
  | MarketingGenerationResponse
  | EcommerceGenerationResponse;

interface EcommerceDetailsView {
  title?: string;
  description?: string;
  features: string[];
  specifications: Record<string, string>;
}

const maskApiKey = (value: string) => {
  if (value.length <= 8) {
    return "•".repeat(value.length);
  }

  return `${value.slice(0, 7)}${"•".repeat(Math.max(4, value.length - 11))}${value.slice(-4)}`;
};

const buildAssetLabel = (asset: Partial<GenerationAsset>, index: number) =>
  asset.productName ||
  asset.versionName ||
  asset.prompt ||
  `Asset ${index + 1}`;

const createImageAsset = (
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

const mapMarketingResultToAssets = (
  result: MarketingGenerationResponse,
): GenerationAsset[] => {
  return (result.urls || []).map((url, index) =>
    createImageAsset(url, index, "Generated asset"),
  );
};

const mapEcommerceResultToAssets = (
  result: EcommerceGenerationResponse,
): GenerationAsset[] => {
  return (result.images?.urls || []).map((url, index) =>
    createImageAsset(url, index, "Catalogue asset"),
  );
};

const mapLibraryResponse = (response: LibraryResponse): GenerationAsset[] =>
  response.generations.map((generation, index) => ({
    ...generation,
    thumbnailUrl: generation.thumbnailUrl || generation.url,
    label: generation.label || buildAssetLabel(generation, index),
  }));

type VideoCardMimeType =
  | "video/avi"
  | "video/x-msvideo"
  | "image/gif"
  | "video/x-m4v"
  | "video/x-matroska"
  | "video/quicktime"
  | "video/mp4"
  | "video/mpeg"
  | "video/webm";

const inferImageMimeType = (asset: GenerationAsset) => {
  if (asset.metadata?.mimeType?.startsWith("image/")) {
    return asset.metadata.mimeType as ImageMimeType;
  }

  return "image/jpeg";
};

const inferVideoMimeType = (asset: GenerationAsset) => {
  if (asset.metadata?.mimeType?.startsWith("video/")) {
    return asset.metadata.mimeType as VideoMimeType;
  }

  return "video/mp4";
};

const inferVideoCardMimeType = (asset: GenerationAsset): VideoCardMimeType => {
  switch (asset.metadata?.mimeType) {
    case "video/avi":
    case "video/x-msvideo":
    case "image/gif":
    case "video/x-m4v":
    case "video/x-matroska":
    case "video/quicktime":
    case "video/mp4":
    case "video/mpeg":
    case "video/webm":
      return asset.metadata.mimeType;
    default:
      return "video/mp4";
  }
};

const wait = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const openExternalUrl = async (url: string) => {
  await requestOpenExternalUrl({ url });
};

const addAssetToDesign = async (asset: GenerationAsset) => {
  if (asset.type === "image") {
    const imageUploadOptions = {
      type: "image",
      name: asset.label,
      mimeType: inferImageMimeType(asset),
      url: asset.url,
      thumbnailUrl: asset.thumbnailUrl || asset.url,
      aiDisclosure: "app_generated",
    } as const;

    const queuedImage = await upload(
      asset.metadata?.width && asset.metadata?.height
        ? {
            ...imageUploadOptions,
            width: asset.metadata.width,
            height: asset.metadata.height,
          }
        : imageUploadOptions,
    );

    await addElementAtPoint({
      type: "image",
      ref: queuedImage.ref,
      altText: {
        text: asset.label,
        decorative: false,
      },
    });
    return;
  }

  if (asset.type === "video") {
    const queuedVideo = await upload({
      type: "video",
      name: asset.label,
      mimeType: inferVideoMimeType(asset),
      url: asset.url,
      thumbnailImageUrl: asset.thumbnailUrl || asset.url,
      aiDisclosure: "app_generated",
    });

    await addElementAtPoint({
      type: "video",
      ref: queuedVideo.ref,
      altText: {
        text: asset.label,
        decorative: false,
      },
    });
  }
};

const AssetCard = ({
  asset,
  onAdd,
  onDownload,
}: {
  asset: GenerationAsset;
  onAdd: (asset: GenerationAsset) => Promise<void>;
  onDownload: (asset: GenerationAsset) => Promise<void>;
}) => {
  const [isWorking, setIsWorking] = useState(false);

  const handleAdd = async () => {
    setIsWorking(true);
    try {
      await onAdd(asset);
    } finally {
      setIsWorking(false);
    }
  };

  const handleDownload = async () => {
    setIsWorking(true);
    try {
      await onDownload(asset);
    } finally {
      setIsWorking(false);
    }
  };

  if (asset.type === "video") {
    const videoMimeType = inferVideoCardMimeType(asset);

    return (
      <Rows spacing="1u">
        {videoMimeType === "image/gif" ? (
          <VideoCard
            thumbnailUrl={asset.thumbnailUrl}
            mimeType="image/gif"
            alt={asset.label}
            ariaLabel="Add video to design"
            borderRadius="standard"
            thumbnailHeight={168}
            onClick={handleAdd}
          />
        ) : (
          <VideoCard
            thumbnailUrl={asset.thumbnailUrl}
            videoPreviewUrl={asset.url}
            mimeType={videoMimeType}
            ariaLabel="Add video to design"
            borderRadius="standard"
            thumbnailHeight={168}
            onClick={handleAdd}
          />
        )}
        <Rows spacing="0.5u">
          <Text size="small" variant="bold">
            {asset.label}
          </Text>
          <Button
            variant="secondary"
            onClick={handleAdd}
            loading={isWorking}
          >
            Add to design
          </Button>
          <Button variant="tertiary" onClick={handleDownload}>
            Download
          </Button>
        </Rows>
      </Rows>
    );
  }

  if (asset.type === "3d") {
    return (
      <Rows spacing="1u">
        <HorizontalCard
          title={asset.label}
          description="3D asset"
          thumbnail={{
            url: asset.thumbnailUrl || asset.url,
            alt: asset.label,
          }}
        />
        <Button variant="secondary" onClick={handleDownload} loading={isWorking}>
          Download
        </Button>
      </Rows>
    );
  }

  return (
    <Rows spacing="1u">
      <ImageCard
        thumbnailUrl={asset.thumbnailUrl || asset.url}
        alt={asset.label}
        ariaLabel="Add image to design"
        borderRadius="standard"
        thumbnailHeight={168}
        onClick={handleAdd}
      />
      <Rows spacing="0.5u">
        <Text size="small" variant="bold">
          {asset.label}
        </Text>
        <Button variant="secondary" onClick={handleAdd} loading={isWorking}>
          Add to design
        </Button>
        <Button variant="tertiary" onClick={handleDownload}>
          Download
        </Button>
      </Rows>
    </Rows>
  );
};

const LibraryImageCard = ({
  asset,
  onAdd,
  onDownload,
  onBroken,
}: {
  asset: GenerationAsset;
  onAdd: (asset: GenerationAsset) => Promise<void>;
  onDownload: (asset: GenerationAsset) => Promise<void>;
  onBroken: (assetId: string) => void;
}) => {
  const [workingAction, setWorkingAction] = useState<"add" | "download" | null>(
    null,
  );
  const [isBroken, setIsBroken] = useState(false);

  const handleAdd = async () => {
    setWorkingAction("add");
    try {
      await onAdd(asset);
    } finally {
      setWorkingAction(null);
    }
  };

  const handleDownload = async () => {
    setWorkingAction("download");
    try {
      await onDownload(asset);
    } finally {
      setWorkingAction(null);
    }
  };

  if (isBroken) {
    return null;
  }

  return (
    <Rows spacing="0.5u">
      <div className={styles.libraryAssetPreview}>
        <ImageCard
          thumbnailUrl={asset.thumbnailUrl || asset.url}
          alt={asset.label}
          ariaLabel="Add image to design"
          borderRadius="standard"
          thumbnailHeight={168}
          onClick={handleAdd}
          onImageLoad={(loadingState) => {
            if (loadingState === "error") {
              setIsBroken(true);
              onBroken(asset.id);
            }
          }}
        />
        <div className={styles.libraryAssetActions}>
          <Button
            variant="secondary"
            icon={PlusIcon}
            ariaLabel={`Add ${asset.label} to design`}
            loading={workingAction === "add"}
            onClick={handleAdd}
          />
          <Button
            variant="secondary"
            icon={ArrowDownIcon}
            ariaLabel={`Download ${asset.label}`}
            loading={workingAction === "download"}
            onClick={handleDownload}
          />
        </div>
      </div>
    </Rows>
  );
};

const ShowcaseSlide = ({
  title,
  description,
  imageUrl,
}: {
  title: string;
  description: string;
  imageUrl: string;
}) => (
  <button
    type="button"
    className={styles.showcaseSlide}
    aria-label={`${title}. ${description}`}
  >
    <div className={styles.showcaseVisual}>
      {imageUrl ? (
        <img src={imageUrl} alt="" className={styles.showcaseImage} />
      ) : (
        <div className={styles.showcasePlaceholder}>
          <Placeholder shape="rectangle" />
        </div>
      )}
    </div>
    <div className={styles.showcaseCopy}>
      <Text variant="bold">{title}</Text>
      <Text size="small">{description}</Text>
    </div>
  </button>
);

type AppButtonProps = ComponentProps<typeof Button>;
const DestructiveButton = Button as unknown as (
  props: Omit<AppButtonProps, "variant"> & {
    variant?: AppButtonProps["variant"] | "critical";
  },
) => ReturnType<typeof Button>;

const KeySetupPanel = ({
  title,
  description,
  instructions,
  apiKeyInput,
  savedApiKey,
  onApiKeyInputChange,
  onSubmit,
  onRemove,
  isBusy,
  verificationError,
  showRemove,
}: {
  title: string;
  description: string;
  instructions?: ReactNode;
  apiKeyInput: string;
  savedApiKey?: string | null;
  onApiKeyInputChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onRemove?: () => void;
  isBusy: boolean;
  verificationError: string;
  showRemove: boolean;
}) => (
  <Rows spacing="2u">
    {title.trim() || description.trim() ? (
      <Rows spacing="0.5u">
        {title.trim() ? <Text variant="bold">{title}</Text> : null}
        {description.trim() ? <Text size="small">{description}</Text> : null}
      </Rows>
    ) : null}
    {instructions ? <Rows spacing="0.5u">{instructions}</Rows> : null}
    {verificationError ? (
      <Alert tone="critical" title="Verification failed">
        {verificationError}
      </Alert>
    ) : null}
    {savedApiKey ? (
      <div className={styles.savedKeyCard}>
        <div className={styles.savedKeyIcon}>
          <LockClosedIcon />
        </div>
        <Text size="small" alignment="center">
          API key connected
        </Text>
        <div className={styles.savedKeyValue}>
          <Text alignment="center">{maskApiKey(savedApiKey)}</Text>
        </div>
        {showRemove && onRemove ? (
          <div className={styles.savedKeyActions}>
            <DestructiveButton
              variant="critical"
              onClick={onRemove}
              icon={TrashIcon}
            >
              Remove key
            </DestructiveButton>
          </div>
        ) : null}
      </div>
    ) : null}
    {!savedApiKey ? (
      <>
        <FormField
          label="IMAI Studio API key"
          value={apiKeyInput}
          control={(props) => (
            <TextInput
              {...props}
              placeholder="sk_live_..."
              onChange={onApiKeyInputChange}
            />
          )}
        />
        <Button variant="primary" onClick={onSubmit} loading={isBusy}>
          Next
        </Button>
      </>
    ) : null}
    {!savedApiKey && showRemove && onRemove ? (
      <DestructiveButton variant="critical" onClick={onRemove} icon={TrashIcon}>
        Remove key
      </DestructiveButton>
    ) : null}
  </Rows>
);

const CreditsRemainingInline = ({
  credits,
}: {
  credits: CreditBalance | null;
}) => {
  if (!credits) {
    return null;
  }

  const roundedBalance = Math.round(credits.balance);

  return (
    <div className={styles.creditsInline}>
      <Text size="small" variant="bold" alignment="center">
        Credits remaining: {roundedBalance}
      </Text>
    </div>
  );
};

const EcommerceDetailsSection = ({
  details,
}: {
  details: EcommerceDetailsView | null;
}) => {
  if (!details) {
    return null;
  }

  return (
    <Rows spacing="1u">
      <Text variant="bold">Catalogue details</Text>
      {details.title ? (
        <div className={styles.detailCard}>
          <Text size="small">Title</Text>
          <Text>{details.title}</Text>
        </div>
      ) : null}
      {details.description ? (
        <div className={styles.detailCard}>
          <Text size="small">Description</Text>
          <Text>{details.description}</Text>
        </div>
      ) : null}
      {details.features.length ? (
        <div className={styles.detailCard}>
          <Text size="small">Features</Text>
          <ul className={styles.detailList}>
            {details.features.map((feature) => (
              <li key={feature}>
                <Text>{feature}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Object.keys(details.specifications).length ? (
        <div className={styles.detailCard}>
          <Text size="small">Specifications</Text>
          <dl className={styles.specList}>
            {Object.entries(details.specifications).map(([key, value]) => (
              <div key={key} className={styles.specRow}>
                <dt>
                  <Text variant="bold">{key}</Text>
                </dt>
                <dd>
                  <Text>{value}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Rows>
  );
};

const AppErrorFallback = () => (
  <Alert tone="critical" title="App error">
    Something went wrong while rendering IMAI Studio.
  </Alert>
);

export const StudioApp = () => {
  const [stage, setStage] = useState<AppStage>("booting");
  const [activeTab, setActiveTab] = useState<StudioTab>("media");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [generationState, setGenerationState] =
    useState<GenerationState>("idle");
  const [generationMessage, setGenerationMessage] = useState("");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [cataloguePrompt, setCataloguePrompt] = useState("");
  const [catalogueUrl, setCatalogueUrl] = useState("");
  const [mediaAssets, setMediaAssets] = useState<GenerationAsset[]>([]);
  const [catalogueAssets, setCatalogueAssets] = useState<GenerationAsset[]>([]);
  const [catalogueDetails, setCatalogueDetails] =
    useState<EcommerceDetailsView | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<GenerationAsset[]>([]);
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const [libraryHasMore, setLibraryHasMore] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");

  const isVerifying = stage === "verifying";
  const isCompactPanelView =
    (stage === "setup" || stage === "verifying") && !apiKey
      ? true
      : stage === "ready" && activeTab === "settings";
  const studioTabOptions = useMemo(
    () => [
      { label: "Media", value: "media" as StudioTab },
      { label: "Catalogue", value: "catalogue" as StudioTab },
      { label: "Library", value: "library" as StudioTab },
      { label: "Settings", value: "settings" as StudioTab },
    ],
    [],
  );

  useEffect(() => {
    let isMounted = true;

    const initializeApp = async () => {
      const storedApiKey = await getStoredApiKey();
      if (!isMounted) {
        return;
      }

      if (storedApiKey) {
        setApiKey(storedApiKey);
        setStage("verifying");
        setVerificationError("");
        try {
          const verification = await verifyApiKey(storedApiKey, {
            libraryNumItems: INITIAL_LIBRARY_PAGE_SIZE,
          });
          if (!isMounted) {
            return;
          }

          setCredits(verification.credits);
          setLibraryAssets(
            mapLibraryResponse(verification.library).filter(
              (asset) => asset.type === "image",
            ),
          );
          setLibraryHasMore(verification.library.pagination.hasMore);
          setLibraryCursor(verification.library.pagination.nextCursor);
          setStage("ready");
          return;
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setVerificationError(
            error instanceof Error ? error.message : "Unable to verify API key.",
          );
          removeStoredApiKey();
          setApiKey(null);
          setStage("setup");
          return;
        }
      }

      setStage(getHasSeenSetup() ? "setup" : "showcase");
    };

    void initializeApp();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (stage !== "ready" || activeTab !== "library" || !apiKey) {
      return;
    }

    if (libraryAssets.length || libraryLoading) {
      return;
    }

    void refreshLibrary();
  }, [activeTab, apiKey, libraryAssets.length, libraryLoading, stage]);

  useEffect(() => {
    if (stage !== "ready" || !apiKey) {
      return;
    }

    if (libraryAssets.length > 0) {
      return;
    }

    void refreshLibrary();
  }, [apiKey, libraryAssets.length, stage]);

  const refreshLibrary = async () => {
    if (!apiKey) {
      return;
    }

    setLibraryLoading(true);
    setLibraryError("");
    try {
      const response = await getMarketingLibrary(apiKey, {
        numItems: INITIAL_LIBRARY_PAGE_SIZE,
        type: "image",
      });

      setLibraryAssets(
        mapLibraryResponse(response).filter((asset) => asset.type === "image"),
      );
      setLibraryHasMore(response.pagination.hasMore);
      setLibraryCursor(response.pagination.nextCursor);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "Unable to load the library.",
      );
    } finally {
      setLibraryLoading(false);
    }
  };

  const loadMoreLibraryAssets = async () => {
    if (!apiKey || !libraryCursor) {
      return;
    }

    setLibraryLoading(true);
    setLibraryError("");
    try {
      const response = await getMarketingLibrary(apiKey, {
        cursor: libraryCursor,
        numItems: LIBRARY_PAGE_SIZE,
        type: "image",
      });

      setLibraryAssets((currentAssets) => [
        ...currentAssets,
        ...mapLibraryResponse(response).filter((asset) => asset.type === "image"),
      ]);
      setLibraryHasMore(response.pagination.hasMore);
      setLibraryCursor(response.pagination.nextCursor);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "Unable to load more assets.",
      );
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleVerifyApiKey = async () => {
    if (!apiKeyInput.trim()) {
      setVerificationError("Enter a valid IMAI Studio API key first.");
      return;
    }

    setStage("verifying");
    setVerificationError("");
    try {
      const verification = await verifyApiKey(apiKeyInput.trim(), {
        libraryNumItems: INITIAL_LIBRARY_PAGE_SIZE,
      });
      await setStoredApiKey(apiKeyInput.trim());
      setApiKey(apiKeyInput.trim());
      setCredits(verification.credits);
      setLibraryAssets(
        mapLibraryResponse(verification.library).filter(
          (asset) => asset.type === "image",
        ),
      );
      setLibraryHasMore(verification.library.pagination.hasMore);
      setLibraryCursor(verification.library.pagination.nextCursor);
      setApiKeyInput("");
      setStage("ready");
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : "Unable to verify API key.",
      );
      setStage("setup");
    }
  };

  const handleRemoveApiKey = () => {
    removeStoredApiKey();
    setApiKey(null);
    setApiKeyInput("");
    setCredits(null);
    setLibraryAssets([]);
    setLibraryCursor(null);
    setLibraryHasMore(false);
    setMediaAssets([]);
    setCatalogueAssets([]);
    setCatalogueDetails(null);
    setStage("setup");
  };

  const handleDownloadAsset = async (asset: GenerationAsset) => {
    await openExternalUrl(asset.url);
  };

  const handleBrokenLibraryAsset = (assetId: string) => {
    setLibraryAssets((currentAssets) =>
      currentAssets.filter((asset) => asset.id !== assetId),
    );
  };

  const pollUntilCompleted = async (
    jobId: string,
  ): Promise<GenerationJobStatusResponse> => {
    let latestStatus: GenerationJobStatusResponse | null = null;

    for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await wait(POLLING_INTERVAL_MS);
      }

      latestStatus = await getGenerationStatus(apiKey as string, jobId);

      if (latestStatus.status === "completed") {
        return latestStatus;
      }

      if (latestStatus.status === "failed") {
        throw new Error(
          latestStatus.error?.message || "Generation failed before completion.",
        );
      }
    }

    throw new Error(
      latestStatus?.error?.message ||
        "Generation is still processing after the polling window.",
    );
  };

  const syncCredits = async () => {
    if (!apiKey) {
      return;
    }

    try {
      const latestCredits = await getCredits(apiKey);
      setCredits(latestCredits);
    } catch {
      // Ignore a credit refresh failure and keep the existing snapshot.
    }
  };

  const extractEcommerceDetails = (
    result: EcommerceGenerationResponse,
  ): EcommerceDetailsView | null => {
    if (!result.details) {
      return null;
    }

    const genericPlatform = result.details.platforms?.generic;
    return {
      title: result.details.title || genericPlatform?.title,
      description:
        result.details.description || genericPlatform?.description,
      features: result.details.features || genericPlatform?.bulletPoints || [],
      specifications: result.details.specifications || {},
    };
  };

  const runJob = async (
    runner: () => Promise<GenerationJobResult>,
    onCompleted: (result: GenerationJobResult) => void,
  ) => {
    if (!apiKey) {
      return;
    }

    setGenerationState("submitting");
    setGenerationMessage("Submitting request to IMAI Studio...");
    setActiveJobId(null);

    try {
      const initialResponse = await runner();
      if (initialResponse.accepted && initialResponse.jobId) {
        setActiveJobId(initialResponse.jobId);
        setGenerationState("polling");
        setGenerationMessage(
          "Generation queued. Checking status every 2 minutes for up to 5 attempts.",
        );

        const statusResponse = await pollUntilCompleted(initialResponse.jobId);
        if (!statusResponse.result) {
          throw new Error("Generation completed without a result payload.");
        }

        onCompleted(statusResponse.result);
      } else {
        onCompleted(initialResponse);
      }

      await syncCredits();
      setGenerationMessage("Generation completed.");
    } catch (error) {
      setGenerationMessage(
        error instanceof Error ? error.message : "Generation failed.",
      );
    } finally {
      setGenerationState("idle");
      setActiveJobId(null);
    }
  };

  const handleMediaGeneration = async () => {
    if (!apiKey) {
      return;
    }

    if (!mediaUrl.trim()) {
      setGenerationMessage("Add a product image URL before generating media.");
      return;
    }

    await runJob(
      () =>
        startMarketingGeneration(apiKey, {
          url: mediaUrl.trim(),
          prompt: mediaPrompt.trim() || undefined,
        }),
      (result) => {
        setMediaAssets(mapMarketingResultToAssets(result as MarketingGenerationResponse));
      },
    );
  };

  const handleCatalogueGeneration = async () => {
    if (!apiKey) {
      return;
    }

    if (!catalogueUrl.trim()) {
      setGenerationMessage("Add a product image URL before generating catalogue data.");
      return;
    }

    await runJob(
      () =>
        startEcommerceGeneration(apiKey, {
          url: catalogueUrl.trim(),
          prompt: cataloguePrompt.trim() || undefined,
        }),
      (result) => {
        const ecommerceResult = result as EcommerceGenerationResponse;
        setCatalogueAssets(mapEcommerceResultToAssets(ecommerceResult));
        setCatalogueDetails(extractEcommerceDetails(ecommerceResult));
      },
    );
  };

  return (
    <ErrorBoundary fallback={<AppErrorFallback />}>
      <div
        className={`${styles.scrollContainer} ${isCompactPanelView ? styles.scrollContainerLocked : ""}`}
      >
        <Rows spacing="2u">
          <SurfaceHeader
            title="IMAI Studio"
            description="Marketing generation, ecommerce content, and library access inside Canva."
          />

          {stage === "booting" ? (
            <Rows spacing="1u">
              <Text variant="bold">Loading IMAI Studio...</Text>
              <Text size="small">
                Restoring saved configuration and verifying your API key.
              </Text>
            </Rows>
          ) : null}

          {stage === "showcase" ? (
            <Rows spacing="2u">
              <Rows spacing="0.5u">
                <Text variant="bold">Preview the workflow first</Text>
                <Text size="small">
                  These slides are placeholders for your showcase URLs. Once an
                  API key is verified, this onboarding screen stays hidden.
                </Text>
              </Rows>
              <Carousel>
                {showcaseSlides.map((slide) => (
                  <ShowcaseSlide
                    key={slide.id}
                    title={slide.title}
                    description={slide.description}
                    imageUrl={slide.imageUrl}
                  />
                ))}
              </Carousel>
              <Button variant="primary" onClick={() => setStage("setup")}>
                Get started
              </Button>
            </Rows>
          ) : null}

          {(stage === "setup" || stage === "verifying") && !apiKey ? (
            <div className={styles.stageCenter}>
              <div className={styles.stageCenterInner}>
                <KeySetupPanel
                  title="Get Started"
                  description=""
                  instructions={
                    <>
                      <Text alignment="start" size="medium">
                        1. Log in to imai.studio
                      </Text>
                      <Text alignment="start" size="medium">
                        2. Go to Extensions
                      </Text>
                      <Text alignment="start" size="medium">
                        3. Select Canva
                      </Text>
                      <Text alignment="start" size="medium">
                        4. Copy your API key
                      </Text>
                    </>
                  }
                  apiKeyInput={apiKeyInput}
                  savedApiKey={null}
                  onApiKeyInputChange={setApiKeyInput}
                  onSubmit={handleVerifyApiKey}
                  isBusy={isVerifying}
                  verificationError={verificationError}
                  showRemove={false}
                />
              </div>
            </div>
          ) : null}

          {stage === "ready" && apiKey ? (
            <Rows spacing="2u">
              {generationMessage ? (
                <Alert tone={generationState === "idle" ? "positive" : "info"}>
                  {generationMessage}
                  {activeJobId ? ` Job: ${activeJobId}` : ""}
                </Alert>
              ) : null}
              <div className={styles.tabSwitcher}>
                <SegmentedControl
                  options={studioTabOptions}
                  value={activeTab}
                  onChange={setActiveTab}
                />
              </div>

              {activeTab === "media" ? (
                <div className={styles.sectionShell}>
                  <Rows spacing="2u">
                    <Rows spacing="0.5u">
                      <Text variant="bold">Generate marketing media</Text>
                    </Rows>
                    <FormField
                      label="Product image URL"
                      value={mediaUrl}
                      control={(props) => (
                        <TextInput
                          {...props}
                          type="url"
                          placeholder="https://example.com/product-image.jpg"
                          onChange={setMediaUrl}
                        />
                      )}
                    />
                    <FormField
                      label="Prompt"
                      value={mediaPrompt}
                      control={(props) => (
                        <TextInput
                          {...props}
                          placeholder="Generate 4 listing shots and 2 lifestyle images"
                          onChange={setMediaPrompt}
                        />
                      )}
                    />
                    <Button
                      variant="primary"
                      onClick={handleMediaGeneration}
                      loading={generationState !== "idle"}
                    >
                      Generate media
                    </Button>
                    <Rows spacing="0.5u">
                      <CreditsRemainingInline credits={credits} />
                    </Rows>
                    {mediaAssets.length ? (
                      <Grid columns={2} spacing="2u">
                        {mediaAssets.map((asset) => (
                          <AssetCard
                            key={asset.id}
                            asset={asset}
                            onAdd={addAssetToDesign}
                            onDownload={handleDownloadAsset}
                          />
                        ))}
                      </Grid>
                    ) : null}
                  </Rows>
                </div>
              ) : null}

              {activeTab === "catalogue" ? (
                <div className={styles.sectionShell}>
                  <Rows spacing="2u">
                    <Rows spacing="0.5u">
                      <Text variant="bold">Generate product catalogue content</Text>
                    </Rows>
                    <FormField
                      label="Product image URL"
                      value={catalogueUrl}
                      control={(props) => (
                        <TextInput
                          {...props}
                          type="url"
                          placeholder="https://example.com/product-image.jpg"
                          onChange={setCatalogueUrl}
                        />
                      )}
                    />
                    <FormField
                      label="Prompt"
                      value={cataloguePrompt}
                      control={(props) => (
                        <TextInput
                          {...props}
                          placeholder="Focus on premium materials and ecommerce-ready copy"
                          onChange={setCataloguePrompt}
                        />
                      )}
                    />
                    <Button
                      variant="primary"
                      onClick={handleCatalogueGeneration}
                      loading={generationState !== "idle"}
                    >
                      Generate catalogue
                    </Button>
                    <EcommerceDetailsSection details={catalogueDetails} />
                    {catalogueAssets.length ? (
                      <Grid columns={2} spacing="2u">
                        {catalogueAssets.map((asset) => (
                          <AssetCard
                            key={asset.id}
                            asset={asset}
                            onAdd={addAssetToDesign}
                            onDownload={handleDownloadAsset}
                          />
                        ))}
                      </Grid>
                    ) : null}
                  </Rows>
                </div>
              ) : null}

              {activeTab === "library" ? (
                <div className={styles.sectionShell}>
                  <Rows spacing="2u">
                    {libraryError ? (
                      <Alert tone="critical" title="Library error">
                        {libraryError}
                      </Alert>
                    ) : null}

                    {libraryLoading && !libraryAssets.length ? (
                      <Rows spacing="1u">
                        <Text variant="bold">Loading library...</Text>
                        <Text size="small">
                          Pulling your marketing generations from IMAI Studio.
                        </Text>
                      </Rows>
                    ) : null}

                    {!libraryLoading && !libraryAssets.length ? (
                      <HorizontalCard
                        title="No library assets yet"
                        description="Once marketing generations are created, they will appear here."
                        thumbnail={{ icon: SearchIcon }}
                      />
                    ) : null}

                    {libraryAssets.length ? (
                      <Grid columns={2} spacing="2u">
                        {libraryAssets.map((asset) =>
                          asset.type === "image" ? (
                            <LibraryImageCard
                              key={asset.id}
                              asset={asset}
                              onAdd={addAssetToDesign}
                              onDownload={handleDownloadAsset}
                              onBroken={handleBrokenLibraryAsset}
                            />
                          ) : (
                            <AssetCard
                              key={asset.id}
                              asset={asset}
                              onAdd={addAssetToDesign}
                              onDownload={handleDownloadAsset}
                            />
                          ),
                        )}
                      </Grid>
                    ) : null}

                    <Button
                      variant="tertiary"
                      icon={ReloadIcon}
                      onClick={() => void refreshLibrary()}
                      loading={libraryLoading}
                    >
                      Refresh library
                    </Button>

                    {libraryHasMore ? (
                      <Button
                        variant="secondary"
                        onClick={() => void loadMoreLibraryAssets()}
                        loading={libraryLoading}
                      >
                        Load more
                      </Button>
                    ) : null}
                  </Rows>
                </div>
              ) : null}

              {activeTab === "settings" ? (
                <div className={styles.stageCenter}>
                  <div className={styles.stageCenterInner}>
                    <div className={styles.settingsPanel}>
                      <KeySetupPanel
                        title=""
                        description=""
                        apiKeyInput={apiKeyInput}
                        savedApiKey={apiKey}
                        onApiKeyInputChange={setApiKeyInput}
                        onSubmit={handleVerifyApiKey}
                        onRemove={handleRemoveApiKey}
                        isBusy={isVerifying}
                        verificationError={verificationError}
                        showRemove={true}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </Rows>
          ) : null}
        </Rows>
      </div>
    </ErrorBoundary>
  );
};
